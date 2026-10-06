# ADR-005: Momen as the backend platform

Status: **Superseded by [ADR-010](ADR-010-postgresql-direct-backend.md)**. The target architecture and the project rules name Momen as the backend of record, but the repository does not use it; PostgreSQL-direct was approved on 2026-10-06.

## Context

The intended architecture is Frontend → Momen (APIs, permissions, data layer, backend logic) → LangGraph → agents → validation → PostgreSQL. Momen is part of the hackathon ecosystem and could supply the API, permission and data-integration layers.

What is true today: only the public endpoint configuration and an anonymous probe exist (`frontend/src/config/momen.ts`, `npm run momen:check`). Momen's GraphQL introspection is disabled and no project export or action definitions are available, so its schema, actions and permissions could not be verified or synchronised. No Momen administrative token was used.

## Decision

Not yet taken. Two options are open and the choice needs to be made explicitly:

1. **Momen as the data/API layer.** Provide a Momen project export or actions; map the existing operations and schema to Momen actions and permissions; route the browser through Momen.
2. **PostgreSQL-direct as the approved backend.** Keep the HTTP API in this repository (as built), document Momen as out of scope, and supersede this ADR.

Until then the implemented system is option 2 in practice, without that having been approved.

## Alternatives Considered

The two options above.

## Consequences

- The current deployment bypasses Momen's permissions and data layer, which conflicts with `CLAUDE.md` ("Momen is the backend of record. Do not add a parallel app database").
- Momen credentials must stay server-side either way; none are used.
- Choosing option 1 needs the missing Momen export and would move authorization from the cookie scheme to Momen permissions. Choosing option 2 means updating `CLAUDE.md` and the system design to match.
