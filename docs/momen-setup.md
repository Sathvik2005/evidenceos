# Momen setup and local development

> **Status:** the application does not use Momen at runtime. Momen's GraphQL introspection is disabled and no project
> export is available, so the schema and actions cannot be verified; the API uses PostgreSQL directly (see
> `ARCHITECTURE.md`, deviation 1). This page covers the endpoint configuration and the anonymous probe only.

Momen is the backend of record (database, APIs/actions, permissions). This repo holds no
parallel backend or database; it consumes Momen contracts.

## Configuration

Copy `.env.example` to `.env.local` (git-ignored).

| Variable | Scope | Notes |
| --- | --- | --- |
| `VITE_MOMEN_GRAPHQL_URL` | public (browser) | `https://` GraphQL endpoint |
| `VITE_MOMEN_SUBSCRIPTION_URL` | public (browser) | `wss://` subscription endpoint |
| `MOMEN_ADMIN_TOKEN` | **server only** | Never prefix with `VITE_`; never ship to the browser |

`frontend/src/config/momen.ts` validates the public endpoints (required, correct protocol,
no embedded credentials). Rotate any admin token that has been shared in chat or committed.

## Frontend/backend boundary

- The browser may only use the two public endpoint URLs.
- Anything needing `MOMEN_ADMIN_TOKEN` must run server-side (e.g. `scripts/`); there is no
  browser-accessible token proxy.
- Business rules live in Momen/workflow; React consumes the contract.

## Verifying the foundation

```sh
npm run momen:check   # Sends `{ __typename }` anonymously; never reads or sends a token
npm run typecheck && npm run lint && npm test
```

The anonymous endpoint probe returns a non-zero status if the endpoint rejects the
request. It does not establish that authenticated requests work.

Backend synchronization and logs are viewed in the Momen console (project preview/sync and
log panels); they cannot be verified from this repository because no Momen project
workspace/export is available. Do not use the admin token in the probe. Record the
outcome of a manual console check in the Prompt 02 completion report.
