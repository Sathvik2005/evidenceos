# EvidenceOS

EvidenceOS is being built in the order defined in
[`EvidenceOS_COMPLETE_PACKAGE/implementation-prompts/README.md`](./EvidenceOS_COMPLETE_PACKAGE/implementation-prompts/README.md).
The current foundation is a strict TypeScript React/Vite workspace; product and
backend behavior will be added by the subsequent prompts.

## Development

Requirements: Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run dev --workspace=@evidenceos/frontend
npm run typecheck
npm run lint
npm test
npm run build
```

Copy `.env.example` to `.env.local` for local configuration. Momen credentials
are server-only and must never be exposed through `VITE_*` variables or committed.
Only the Momen endpoint URLs are public client configuration. The supplied admin
token should be rotated before configuring it locally; do not paste its replacement
into source control or chat.
The frontend currently validates Momen endpoint configuration but does not send
authenticated GraphQL operations; those contracts belong to later implementation
prompts. Momen remains the backend of record; this repository does not add a
parallel application database or a browser-accessible admin-token proxy.
`npm run momen:check` performs an anonymous-only endpoint probe and never reads or
sends the admin token.

The database migration and assumptions are documented in
[`database/PROVISIONAL_DATA_MODEL.md`](./database/PROVISIONAL_DATA_MODEL.md).
It is locally tested against PGlite but has not been synchronized to Momen.

The harness command is an entry point only; the harness is introduced by Prompt 12.

See [`docs/momen-setup.md`](./docs/momen-setup.md) for Momen setup, the frontend/backend
boundary, and `npm run momen:check`.
