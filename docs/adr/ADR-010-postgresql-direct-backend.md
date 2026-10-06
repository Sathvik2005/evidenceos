# ADR-010: PostgreSQL-direct backend (Momen deferred)

Status: **Accepted** (approved by the project owner on 2026-10-06; supersedes ADR-005).

## Context

The target architecture and `CLAUDE.md` name Momen as the backend of record. Momen's GraphQL introspection is disabled and no project export or action definitions exist, so its schema, actions and permissions cannot be verified or synchronised from this repository (ADR-005). The application nevertheless needs a working API, durable storage and authorization.

## Decision

The HTTP API in this repository (`frontend/src/server`, served by the Vercel Function `api/[...path].ts`) is the approved backend. It talks to PostgreSQL directly through typed, owner-scoped operations (`frontend/src/api/operations.ts`). Momen is **out of scope for now**; it remains a possible future platform if an export and actions are provided.

## Alternatives Considered

- **Momen as the data/API layer** — rejected for now: cannot be built or verified without an export (ADR-005, option 1).
- **No backend** — rejected: the product needs persisted, owner-scoped evidence state and a workflow runner.

## Consequences

- The "Momen is the backend of record" rule and the "no second application database" rule in `CLAUDE.md` do not apply to this deployment; the PostgreSQL database defined by `database/migrations/` **is** the system of record.
- Authorization is the anonymous per-browser cookie scheme documented in `docs/ARCHITECTURE.md`, enforced in the API and the operations, not by Momen permissions. There are no accounts and no rate limiting yet.
- The Momen configuration (`frontend/src/config/momen.ts`, `npm run momen:check`) stays as an inert diagnostic. No Momen credential is used and `MOMEN_ADMIN_TOKEN` must stay empty.
- Moving to Momen later means: obtain an export, map the operations and schema to Momen actions and permissions, route the browser through Momen, and supersede this ADR.
- This decision does not change any evidence-integrity invariant; those are enforced by the operations, the validation layer and database triggers.
