# ADR-009: Immutable evidence history

Status: Accepted

## Context

The product's central behaviour is showing how an evidence state changes when new evidence arrives. Overwriting state would erase that story and let history be rewritten to look cleaner.

## Decision

State transitions are persisted, not overwritten:

```text
SUPPORTED → PARTIALLY_SUPPORTED → CONFLICTING
```

Each meaningful transition is an `evidence_changes` row (previous state, new state, reason, triggering evidence, timestamp). A claim's first state is stored directly; every later change must go through `evidence_changes`, whose previous state must match the stored state and whose triggering evidence must belong to the claim and be new in the run. Database triggers apply the change atomically, reject stale previous states and direct state edits, and reject updates and deletes of history. Idempotency keys prevent duplicate records when a run is retried. No record is created when the state does not change.

## Alternatives Considered

- **Mutable state with an audit log elsewhere:** the log can drift from the state.
- **Application-level append-only convention:** easy to bypass by mistake; the database enforces it instead.

## Consequences

Users can see how and why an evidence state evolved. The history cannot be corrected by editing it; mistakes require a new, explained transition. Deleting records is deliberately hard (`RESTRICT` foreign keys), so removing an investigation has no supported procedure yet (see `docs/operations/DATA_RETENTION.md`).
