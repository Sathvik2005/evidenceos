# EvidenceOS architecture (as built)

This describes what the repository actually contains. The target architecture is
`EvidenceOS_COMPLETE_PACKAGE/implementation-prompts/system dessign.md`; deviations are listed at the end.

## Request lifecycle

```text
POST /api/investigations
  → validate, create investigation (idempotency key), atomically claim the run, return 201
  → (background) LangGraph workflow:
      load → decompose → validateClaims → persistClaims → research → validateEvidence
           → analyze → validateAssessment → evaluate → decide → persistState → detectChange → summarize
GET  /api/investigations/:id[/claims|/evidence|/sources|/changes]   (the UI polls these)
POST /api/investigations/:id/refresh   (re-run so new evidence can be assessed; refuses a live run)
```

## Layers (`frontend/src`, despite the folder name most of it is server-side)

| Folder | Responsibility |
| --- | --- |
| `api/` | Typed contracts and owner-scoped, idempotent persistence over an injected `Database {query}` |
| `agents/` | Claim Decomposer, Research, Evidence Analyst, Evaluator; each treats model output as untrusted JSON |
| `validation/` | Deterministic hard rules; they override any model or evaluator opinion |
| `workflow/` | LangGraph state machine, node handlers, bounded retries, failure classification |
| `server/` | HTTP app, config, adapters (Anthropic, Tavily, PostgreSQL, recorded demo corpus) |
| `gateway/`, `pages/`, `components/`, `graph/` | Browser client and UI; the UI never computes a claim state |
| `database/migrations/` | PostgreSQL schema (provisional) |

## Responsibilities and trust boundaries

- **Model output is data.** Every agent output passes schema validation, then deterministic validation, before it is stored. Fields outside the contract are rejected.
- **Provenance comes from retrieval.** URL, title, publisher and dates are copied from what the search provider returned; the model may only point at a retrieved document and quote it. A quote must appear verbatim in the retrieved text (whitespace-normalised) or the output is rejected.
- **Retrieved text is untrusted.** It is wrapped as data in prompts, and the model cannot change roles, fields or states through it.
- **State ownership.** The analyst proposes; deterministic rules validate; the evaluator audits (score rubric 0–2 × 5 dimensions, accept at ≥7 with grounding and justification ≥1 and no critical failure); the workflow decision layer persists. A hard-rule failure rejects regardless of the evaluator.
- **History is append-only and DB-enforced.** A claim's first state is stored directly. Afterwards its state can change only through an `evidence_changes` record, which needs a persisted previous state, a different new state, and triggering evidence that belongs to the claim and is **new in this run**. Triggers reject stale previous states, direct state edits, and updates or deletes of history.
- **Identity.** An anonymous HttpOnly `eos_uid` cookie scopes every record. Another browser gets `404` for your investigation (no existence leak). Writes require same-origin. An optional demo investigation is readable, never writable, by everyone.
- **Secrets** exist only in server environment variables. The client bundle contains none (checked in the audit).

## Failure handling

Failures are classified (`VALIDATION`, `PROVIDER`, `TIMEOUT`, `RATE_LIMIT`, `MALFORMED_OUTPUT`, `PERSISTENCE`, `AUTHENTICATION`, `AUTHORIZATION`, `NETWORK`, `WORKFLOW`). Only transient kinds are retried, at most twice. A failing claim does not discard the others: the run ends `REVIEW_REQUIRED` with the failure listed. Authentication or authorization failures fail the whole run and mark the investigation `ERROR`. A claim whose research was unavailable is left unassessed rather than concluded `INSUFFICIENT`.

## Data model summary

`investigations` → `claims` (state, confidence, assessment reason) → `evidence` (relationship, strength, excerpt, reasoning) → `sources` (URL, title, publisher, dates, retrieved-at); `evidence_changes` (previous/new state, reason, triggering evidence). Foreign keys use `ON DELETE RESTRICT`; evidence must reference a claim and a source of the same investigation. See `database/PROVISIONAL_DATA_MODEL.md`.

## Deviations from the system design, and open decisions

| # | Deviation | Why | Needed |
| --- | --- | --- | --- |
| 1 | **No Momen.** The API talks to PostgreSQL directly; the target was Frontend → Momen → workflow → PostgreSQL. | Momen's GraphQL introspection is disabled and no project export exists, so its schema and actions cannot be verified. | **Accepted** by the owner on 2026-10-06 ([ADR-010](adr/ADR-010-postgresql-direct-backend.md)); revisit if a Momen export is provided. |
| 2 | Workflow checkpoints are in memory (`MemorySaver`), not durable (§35, §48). | No durable checkpointer was configured. | Recovery today is re-run (idempotent) plus stale-run takeover after 10 minutes without progress. |
| 3 | UI built with hand-written CSS tokens, not Tailwind/shadcn. | Avoid adding a styling stack for a small UI. | Optional. |
| 4 | Specs absent: `DATA_MODEL.md`, `RULES.md`, `PRD.md`, `GOLDEN_SPECS.md`, `UI_SPEC.md`, … | Not in the supplied package. | Supply them for a true spec audit. |
| 5 | Unverified externally: Anthropic, Tavily, `pg`/hosted PostgreSQL and Vercel integrations. | No credentials or hosting available during development. | Run the smoke test in `docs/DEPLOYMENT.md`. |
