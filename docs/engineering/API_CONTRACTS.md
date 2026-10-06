# API and component contracts

The typed boundaries of the system as built. The persistence-operation and HTTP tables are maintained in [`../api-contracts.md`](../api-contracts.md); this document adds the boundary map, authorization, and the agent contracts. Only contracts that exist are listed.

```text
Browser (gateway) ↔ HTTP API (/api) ↔ Application operations ↔ PostgreSQL
                                    ↕
                         LangGraph workflow ↔ Agents ↔ Validation ↔ Persistence
```

There is **no Momen API** in this chain: PostgreSQL-direct is the approved backend and Momen is deferred ([ADR-010](../adr/ADR-010-postgresql-direct-backend.md), which supersedes [ADR-005](../adr/ADR-005-momen-backend-platform.md)). The HTTP API is served by `frontend/src/server/http.ts` and exposed through the Vercel Function `api/[...path].ts`.

## Common behavior

- **Result shape:** operations return `{ ok: true, data }` or `{ ok: false, error: { code, message, field? } }`. HTTP wraps these as `{ "data": … }` or `{ "error": … }`.
- **Error codes:** `VALIDATION_FAILED` (400), `NOT_FOUND` (404, also for records you do not own), `CONFLICT` and `IDEMPOTENCY_CONFLICT` (409), `REFERENCE_INVALID` and `CONSTRAINT_VIOLATION` (422), `INTERNAL_ERROR` (500/503). No SQL or internals are returned.
- **Authorization:** identity is an anonymous HttpOnly `eos_uid` cookie. Every operation takes the owner id and scopes its queries by it. There are no accounts or roles. Writes require a same-origin `Origin` header (or none).
- **Pagination:** `limit` 1–100 (default 25), `offset` ≥ 0 on all list operations.
- **Idempotency:** operations accept a client `idempotencyKey` where noted; an identical replay returns the stored record, different content returns `IDEMPOTENCY_CONFLICT`. Body size limit 16 KB.

## Investigation

| Contract | Input | Output | Validation and errors | Idempotency |
| --- | --- | --- | --- | --- |
| `POST /api/investigations` (`createInvestigation`) | `{ question, idempotencyKey? }` | `201` investigation (`status` starts `CREATED`) | Question non-empty and within the length limit; `503` when research keys are not configured | A replay returns the same investigation and does **not** start a second run |
| `GET /api/investigations/:id` (`getInvestigation`) | id | Investigation with `status` (`CREATED`, `RESEARCHING`, `ANALYZING`, `READY`, `REVIEW_REQUIRED`, `ERROR`) | Foreign or unknown id → `404` | Read-only |
| `listInvestigations` | page | Owner's investigations | Page bounds | Read-only; **not exposed over HTTP** |
| `POST /api/investigations/:id/refresh` | none | `202` investigation | `409` while a live run exists; takes over a run with no progress for 10 minutes | An atomic claim allows one run at a time |

## Claims, sources, evidence

| Contract | Notes |
| --- | --- |
| `GET …/claims`, `…/sources`, `…/evidence` | Owner-scoped, paginated lists. Claims carry `state` (null until assessed), `confidence`, assessment reason. Evidence carries `relationship`, `strength`, `excerpt`, `reasoning`, and its claim and source ids |
| `addClaim`, `addSource`, `addEvidence` | **Server-side operations only; not exposed over HTTP.** `addClaim`: positive unique `ordinal`. `addSource`: http(s) URL without credentials, `sourceType` enum, unique per investigation by URL. `addEvidence`: the claim and source must belong to the same investigation; excerpt required; relationship and strength must be valid enums. All support idempotency keys |

Enums: relationship `SUPPORTS`, `PARTIALLY_SUPPORTS`, `CONTRADICTS`, `INSUFFICIENT`; strength `STRONG`, `MODERATE`, `WEAK`; state `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONFLICTING`, `INSUFFICIENT`; confidence `HIGH`, `MEDIUM`, `LOW`.

## State and history

- **Reading state:** it is a field on the claim; the UI never computes it.
- **Changing state:** only through `recordStateChange` (server-side, not exposed over HTTP). The first assessment of a claim stores its initial state directly; every later change needs an `evidence_changes` record with: a previous state equal to the stored state, a different new state, a reason, a triggering evidence item belonging to the claim and new in the run, and a required idempotency key. A trigger applies the change atomically and rejects stale previous states, direct state edits and updates or deletes of history (`CONSTRAINT_VIOLATION`).
- **Reading history:** `GET …/changes` (`listEvidenceChanges`), paginated, ordered by time.

## Workflow

A run starts from `POST /api/investigations` (new) or `…/refresh` (re-run) after an atomic status claim. The LangGraph nodes are: load, decompose, validateClaims, persistClaims, research, validateEvidence, analyze, validateAssessment, evaluate, decide, persistState, detectChange, summarize. Inputs are the investigation and owner ids; the question is loaded from the database. Retries: at most 2, transient failures only. Outcome: investigation status `READY` (all claims resolved), `REVIEW_REQUIRED` (some claim failed or is unresolved) or `ERROR` (authentication/authorization failure or crash). Re-running is idempotent via deterministic idempotency keys. There is no endpoint that exposes workflow internals.

## Health

`GET /api/health`: `200 {"status":"ok"}` after `SELECT 1`, else `503 {"status":"unavailable"}`. No authorization, no data.

## Agent contracts

Every agent output is untrusted JSON: schema-checked, unknown fields rejected, then deterministically validated before it can affect state. Failures retry at most twice with the errors fed back, then fail explicitly.

| Agent | Input | Output (closed schema) | Must not |
| --- | --- | --- | --- |
| Claim Decomposer | Question (≤ 2,000 chars) | `{ claims: [{ statement }], ambiguityNotes? }`, at most 6 claims, each ≤ 300 chars, non-empty, de-duplicated, atomic where checkable | Research, cite, assign state or confidence |
| Research Agent | A claim plus documents returned by the search provider (≤ 8, ≤ 6,000 chars each) | `{ candidates: [{ documentIndex, excerpt, relationship, strength }] }`; the excerpt must be a verbatim quote (≤ 1,000 chars); source metadata is copied from the provider by code | Invent URL, title, publisher, date or quote; assign claim state |
| Evidence Analyst | A claim plus all validated evidence for it | `{ proposedState, confidence, rationale, evidenceIds, causalStatus, scopeNotes?, uncertainties? }`; cited ids must exist, every `CONTRADICTS` item must be cited, a non-`INSUFFICIENT` state must cite evidence | Add evidence, cite unknown ids, drop contradictions |
| Evaluator | A hard-rule-valid assessment plus its evidence | `{ scores: { evidenceQuality, grounding, contradictionHandling, stateJustification, uncertaintyHandling }, criticalFailures, findings }`, each score 0–2 | Research, add or alter evidence; its accept/reject is computed in code and cannot override a hard-rule failure |

Hard rules live in `frontend/src/validation/rules.ts` with stable rule ids, for example `EVIDENCE_CLAIM_MISMATCH`, `PROVENANCE_MISSING`, `FABRICATED_SOURCE`, `FABRICATED_EXCERPT`, `SUPPORTED_WITHOUT_SUPPORT`, `SUPPORTED_DESPITE_CONTRADICTION`, `CONFLICT_WITHOUT_BOTH_SIDES`, `CONTRADICTION_OMITTED`, `CITED_EVIDENCE_FOREIGN_CLAIM`, `CONFIDENCE_UNSUPPORTED`, `CAUSATION_UNSUPPORTED`, `CHANGE_TRIGGER_NOT_NEW`, `CHANGE_NO_DIFFERENCE`.

## Provider boundaries

`LlmClient.generate({ system, user, schemaName })` returns parsed JSON; `SearchProvider.search(query)` returns documents with provenance. Adapters (Anthropic, Tavily) map provider errors to the failure kinds used for retry decisions. No credentials appear in any contract.

## Tests

Contract tests: `frontend/tests/contracts/` (operations, HTTP API, server adapters). Agent schemas and rules: `tests/golden/`, `tests/unit/validation-rules.test.ts`. Run `npm run test:contracts`.
