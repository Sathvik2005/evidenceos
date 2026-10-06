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
