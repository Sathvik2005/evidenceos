# Provisional EvidenceOS data model

This schema is provisional because the referenced `DATA_MODEL.md` and the
Momen project export are not present. It implements only the entities and
integrity rules explicitly named in the supplied prompt and `agents.md`.
Replace or amend it after the authoritative data model is available.

## Entities and relationships

- An investigation owns its claims and sources.
- Evidence connects one claim to one source within the same investigation.
- Evidence changes belong to a claim and must cite evidence belonging to that
  same claim and investigation.
- Foreign keys use `ON DELETE RESTRICT` to preserve provenance and history.
- Optional idempotency keys are unique within an investigation; state-change
  keys are required.

## Provisional enum assumptions

- Investigation status: `CREATED`, `RESEARCHING`, `ANALYZING`, `READY`, `REVIEW_REQUIRED`, `ERROR` (system design section 7).
- Claim state: `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONFLICTING`, `INSUFFICIENT`.
- Confidence: `HIGH`, `MEDIUM`, `LOW`, stored separately from claim state.
- Evidence relationship: `SUPPORTS`, `CONTRADICTS`, `PARTIALLY_SUPPORTS`,
  `INSUFFICIENT`.
- Evidence strength: `STRONG`, `MODERATE`, `WEAK` (system design section 7). Evidence also has an optional `reasoning` text.
- Source type: `WEB_PAGE`, `JOURNAL_ARTICLE`, `BOOK`, `REPORT`, `DATASET`,
  `OTHER`.

The constitution specifies the claim-state, confidence, and evidence
relationship labels. The investigation statuses, evidence-strength labels,
source-type labels, and column choices are assumptions pending the missing
data-model specification.

## Integrity and history

- Claim state may be unset until an assessment exists.
- A claim's FIRST state is stored directly; it is not a change event. A change record
  (`evidence_changes`) requires a persisted previous state (NOT NULL), a different new
  state, a reason, triggering evidence belonging to the claim, and an idempotency key.
- A trigger rejects a change unless the stored state matches the recorded previous state,
  then updates the claim state in the same transaction. A second trigger blocks any other
  direct edit of an established claim state.
- Evidence-change records reject updates and deletes.
- Sources retain URL, title, optional publisher/publication time, and retrieval
  time; excerpts are required on evidence records.
- No demo data is seeded.

## Verification boundary

The migration is executable against PostgreSQL-compatible engines and is tested
locally with PGlite. It has not been synchronized to Momen or verified against
the live Momen schema because no Momen project/workspace export is available.
