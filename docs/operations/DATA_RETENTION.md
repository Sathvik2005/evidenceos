# Data retention

No formal retention period has currently been configured for any data in this project, and no deletion or expiry job exists. The tables below state what is stored and what the schema does today.

## Stored data

| Data | Purpose | Retention policy | Deletion behavior | Backup implications |
| --- | --- | --- | --- | --- |
| Investigations (question, status, owner id) | Scope of an evidence investigation | None configured | No delete operation in the API; foreign keys `RESTRICT` prevent deleting one that has claims | Depends on the hosting database's backups |
| Claims (statement, state, confidence, assessment reason) | Researchable propositions and their current state | None configured | No delete operation; `RESTRICT` while evidence or history references them | As above |
| Sources (URL, title, publisher, dates, retrieved-at) | Provenance of evidence | None configured | `RESTRICT` while evidence references them | As above |
| Evidence (excerpt, relationship, strength, reasoning) | The grounded record behind a state | None configured | `RESTRICT`: a claim or source with evidence cannot be removed | As above |
| Evidence changes (previous/new state, reason, trigger) | Immutable history of state transitions | None configured | Updates and deletes are rejected by a trigger | As above |
| Anonymous owner id | Scopes records to a browser | Cookie lives up to one year (`Max-Age` 31,536,000 s); `owner_id` rows persist independently | Clearing the cookie loses access to the records but does not delete them | As above |
| Workflow state and trace | Coordinating a run | In memory only; discarded when the run ends | Not persisted | None |
| Logs | Operations | Controlled by the hosting platform, not by this project | Platform-defined | Platform-defined |
| Schema migration records (`schema_migrations`) | Tracking applied migrations | Permanent | None | Same as database |

Evidence excerpts are third-party text copied verbatim from public sources with their URL. Review the copyright and terms of the sources before retaining or republishing excerpts at scale.

## Historical integrity

Evidence-change history stays immutable while the underlying claim state evolves. The claim row holds only the *current* state; the history explains how it got there. Rewriting history would let the latest state look cleaner than the evidence justifies, which is the failure the product exists to prevent. A trigger rejects updates and deletes on `evidence_changes`.

## Deletion

Every foreign key is `ON DELETE RESTRICT`, so nothing cascades silently. Consequences:

- Evidence cannot be orphaned: deleting a claim or source that evidence references is refused.
- History cannot be erased as a side effect of deleting a claim.
- Removing a whole investigation (for a privacy request, for example) is **not supported by an existing operation**. It would need a deliberate, reviewed procedure that removes evidence changes, evidence, sources, claims and the investigation in dependency order, and it would have to bypass the append-only trigger. That procedure does not exist and is not documented here as available.

## Backups

This project implements no backup or recovery mechanism. Backup, point-in-time recovery and retention of backups are operational dependencies of the hosted PostgreSQL provider and must be configured and tested there. See [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for the deployment notes.

## Before a public launch

Decide and document: a retention period, a deletion/erasure procedure, backup frequency and restore testing, and whether anonymous investigations should expire.
