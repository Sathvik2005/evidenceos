# API / backend action contracts (Prompt 04, provisional)

Typed persistence operations over the provisional schema (`database/migrations/001_initial_schema.sql`).
They are **server-side only**: `frontend/src/api/operations.ts` trusts the caller-supplied `ownerId`
(the authenticated user id) and must not be imported by browser code. Request/response types and
validators live in `frontend/src/api/contracts.ts`.

These are not yet exposed as Momen actions: no Momen project/export is available, so the mapping
to Momen actions and permissions is unverified.

## Result shape

Every operation returns `{ ok: true, data }` or `{ ok: false, error: { code, message, field? } }`.

| Code | Meaning |
| --- | --- |
| `VALIDATION_FAILED` | Bad input; `field` names the offender |
| `NOT_FOUND` | Missing **or not owned** (same response, no existence leak) |
| `REFERENCE_INVALID` | Referenced record absent or in another investigation/claim |
| `CONFLICT` | Unique value already exists |
| `IDEMPOTENCY_CONFLICT` | Idempotency key reused with different content |
| `CONSTRAINT_VIOLATION` | Integrity rule failed (e.g. stale `previousState`) |
| `INTERNAL_ERROR` | Anything else; no SQL or internals are returned |

## Operations

| Operation | Notes |
| --- | --- |
| `createInvestigation(db, ownerId, {question, idempotencyKey?})` | |
| `getInvestigation` / `listInvestigations` | Owner-scoped; `limit` 1–100 (default 25), `offset` ≥ 0 |
| `addClaim` | `ordinal` positive integer, unique per investigation |
| `addSource` | `url` must be http(s) without credentials; `sourceType` enum |
| `addEvidence` | Claim and source must belong to the same investigation; excerpt required |
| `recordStateChange` | Append-only; idempotency key **required**; DB trigger verifies `previousState` and updates the claim atomically |
| `listClaims` / `listSources` / `listEvidence` / `listEvidenceChanges` | Owner-scoped, paginated |

## Idempotency

With an `idempotencyKey`, an identical replay returns the stored record; a replay with different
content returns `IDEMPOTENCY_CONFLICT`. Nothing is duplicated.

## Tests

`frontend/tests/contracts/api-operations.test.ts` runs the operations against the migration in PGlite
(valid, invalid, ownership, cross-reference, state-change and idempotency cases).

## HTTP API (Prompts 14-18)

`frontend/src/server/http.ts` exposes the operations as a same-origin JSON API (`/api`). Success: `{ "data": … }`;
failure: `{ "error": { "code", "message", "field"? } }` with `VALIDATION_FAILED` 400, `NOT_FOUND` 404,
`CONFLICT`/`IDEMPOTENCY_CONFLICT` 409, `REFERENCE_INVALID`/`CONSTRAINT_VIOLATION` 422, `INTERNAL_ERROR` 500/503.

| Request | Behavior |
| --- | --- |
| `GET /api/health` | `200 {status:"ok"}` after `SELECT 1`, else `503` |
| `POST /api/investigations` `{question, idempotencyKey?}` | `201`; creates and starts the workflow once (a replay does not start another); `503` when research keys are not configured |
| `GET /api/investigations/:id` | The investigation (status: CREATED, RESEARCHING, ANALYZING, READY, REVIEW_REQUIRED, ERROR) |
| `GET /api/investigations/:id/claims`, `/evidence`, `/sources`, `/changes` | Owner-scoped lists; `limit` 1-100, `offset` |
| `POST /api/investigations/:id/refresh` | `202` and a new run; `409` while a live run exists; takes over a run with no progress for 10 minutes |

Identity is an anonymous HttpOnly `eos_uid` cookie set by the server; another browser gets `404` for your records.
Writes require a same-origin `Origin` (or none). Bodies are limited to 16 KB. One structured log line per request.
The optional demo investigation is readable by everyone and never writable.
