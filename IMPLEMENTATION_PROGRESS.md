# EvidenceOS implementation progress

This log records the implementation-prompt sequence. It is updated as each
prompt is worked; no unstarted prompt is represented as completed.

| Prompt | Status | Work and verification |
| --- | --- | --- |
| 01 — Repository & Environment Foundation | Conditional | Added the React/Vite TypeScript workspace, strict typechecking, lint/test/build scripts, test-directory structure, README, ignored local environment configuration, and a harness entry point. Lint, typecheck, unit tests, and production build pass. The authoritative specification files referenced by Prompt 01 are not present in the supplied package. |
| 02 — Momen Project Foundation | Conditional | Added public GraphQL/subscription endpoint configuration with HTTPS/WSS validation, an anonymous-only GraphQL probe, and a blank server-only token setting. The anonymous GraphQL probe succeeds. No Momen project/export is available in this workspace; backend synchronization and console logs remain unverified. |
| 03 — Database & Data Model | Provisional | Added PostgreSQL schema, enum/check/FK/index constraints, and state-history triggers based on the supplied constitution. PGlite CRUD, relationship, invalid-reference, transition, and append-only history tests pass. `DATA_MODEL.md` is missing and remote Momen synchronization is unverified; assumptions are recorded in `database/PROVISIONAL_DATA_MODEL.md`. |
| 04 — API & Backend Actions | Provisional | Added typed, owner-scoped, validated persistence operations with structured errors and idempotent writes (`frontend/src/api`), documented in `docs/api-contracts.md`. PGlite contract tests pass. Not exposed as Momen actions; no Momen export is available to verify. |
| 05 — LangGraph Workflow Foundation | Provisional | Typed serializable workflow state, per-node bounded retries (transient failures only), and trace entries in `frontend/src/workflow`; placeholder handlers fabricate nothing. Unit tests pass (`workflow-graph.test.ts`). Committed. |
| 06 — Claim Decomposer Agent | Provisional | Claim Decomposer with schema and deterministic validation behind the provider-neutral `LlmClient`; golden tests pass. Committed. Authoritative specs missing from the package, as above. |
| 07 — Research Agent | Provisional | `researchAgent.ts`: provider-supplied provenance, verbatim-excerpt validation, de-duplication, explicit `UNAVAILABLE`/`PARTIAL` statuses. Golden tests pass (fabrication, retries, partial/unavailable, dedup, untrusted-data framing). Committed (2134ad1). Reviewed against the prompt: all 8 requirements met; no separate contract-test file (coverage is in the golden suite). |
| 08 — Evidence Analyst Agent | Provisional | `evidenceAnalyst.ts`: structured assessment, contradiction-citation rule, state/confidence separation, causal status. Golden tests cover supported/partial/conflicting/insufficient. Committed (1537d1c). Reviewed against the prompt: all 8 requirements met; correlation-vs-causation is a schema field with a prompt rule but has no dedicated negative test, and state-versus-evidence checks are deferred to Prompt 09. |
| 09 — Deterministic Validation | Provisional | Hard-rule layer in `frontend/src/validation/rules.ts` with failure-injection unit tests (`validation-rules.test.ts`). Committed (f10fb95). Not yet reviewed line-by-line against the prompt. |
| 10 — Evaluator Agent | Provisional | `agents/evaluator.ts` with deterministic acceptance (hard-rule failure rejects regardless of evaluator score); golden tests in `evaluator.golden.test.ts`. Committed (52602aa). Not yet reviewed line-by-line against the prompt. |
| 11 — Complete Investigation Workflow | Provisional | Full workflow with durable persistence, idempotent keys, partial-failure handling and `READY`/`REVIEW_REQUIRED` outcomes (`workflow/handlers.ts`, `run.ts`); e2e tests with a controlled fixture. Committed (b304ade); aligned with the system design in 46f302f. |
| 12 — Harness & Golden Dataset | Provisional | Evaluation harness and 20-case executable golden dataset (3c8bd49). `npm run harness` passes: unit 56/56, contracts 10/10, golden 67/67, e2e 8/8. |
| 13 — Frontend Foundation | Provisional | Router, shell, tokens and status primitives (895847c). Production build passes. |
| 14 — Investigation UI | Not started | — |
| 15 — Claim & Evidence UI | Not started | — |
| 16 — Evidence Graph | Not started | — |
| 17 — Change Detection | Not started | — |
| 18 — End-to-End Integration | Not started | — |
| 19 — Testing & Failure Injection | Not started | — |
| 20 — Deployment | Not started | — |
| 21 — Demo Hardening | Not started | — |
| 22 — Final Audit | Not started | — |

## Credential handling

The admin-capable token shared during setup was not saved or used. Rotate it
before configuring any local secret. `.env.local` is ignored by Git; only the
empty `MOMEN_ADMIN_TOKEN` setting is tracked in `.env.example`.

## System-design conformance review (against `system dessign.md`)

Reviewed 2026-10-06 from source and tests (111 passing); the system was not run end to end. Direction is consistent with the design; the items below are open or are spec conflicts to resolve, not silently choose.

| # | Item | Design reference | Status |
| --- | --- | --- | --- |
| 1 | Stale-write guard: enforced in the database. `apply_claim_state_change` only updates a claim whose state equals the recorded `previous_state`, and `guard_claim_state` blocks any state change outside `evidence_changes`. Contract test covers a stale previous state. | §29, I-012 | Resolved (46f302f). |
| 2 | Evidence strength `UNKNOWN` removed from schema; strengths are `STRONG/MODERATE/WEAK` as in the design. | §7 | Resolved (46f302f). |
| 3 | Evidence `reasoning` column added to schema and contracts. | §7 | Resolved (46f302f). |
| 4 | Workflow is not resumable from durable state; checkpointing is in-memory (`MemorySaver`). | §35, §48 | Gap. Prompt 11 or later. |
| 5 | No live Momen connection; the frontend → Momen → workflow chain is local code on PGlite only. | §4, §32 | Known (Prompts 02/04 provisional). |
| 6 | Not built: change path for new evidence on an existing claim, harness, UI, graph, signature PARTIALLY_SUPPORTED → CONFLICTING demo. | §46 | Prompts 12–18. |
| 7 | Repository layout differs from §61 (`frontend/src/...`); the section allows adaptation. | §61 | Accepted. |

Conforming: pipeline order, state ownership (analyst proposes, rules validate, hard rules override evaluator), provenance and contradiction preservation, idempotent writes and change keys, `REVIEW_REQUIRED` on partial failure, bounded retries, untrusted-source handling.


Update: after commit 46f302f, typecheck, lint, build, all 141 tests and `npm run harness` pass. Items 1-3 above are resolved. Items 4-6 remain open.
