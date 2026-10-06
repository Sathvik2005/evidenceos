# ADR-002: Evidence is structured state

Status: Accepted

## Context

If evidence lives only in model context, it cannot be audited, compared across runs or shown to a user, and it disappears with the conversation.

## Decision

Evidence is persisted as structured records in PostgreSQL: investigations, claims, sources, evidence (excerpt, relationship, strength, reasoning) and evidence changes. Each evidence record is tied to a claim and a source with provenance (URL, title, publisher where known, dates, retrieved-at). The database, not a model or the UI, is the source of truth.

## Alternatives Considered

- **Keep evidence in prompt context or vector memory.** Cheaper to build, but not inspectable or reproducible, and it cannot support change detection.
- **Store only final answers.** Loses provenance and the ability to explain a state.

## Consequences

- **Provenance:** each evidence item answers where it came from and why it relates to a claim.
- **History and change detection:** new evidence can be compared with persisted state.
- **UI inspection:** the interface renders stored records, never inferred ones.
- **Reproducibility:** runs are idempotent through stable keys; re-running reuses saved work.
- The schema must be migrated deliberately, and every agent output needs a mapping into it.
