# Contributing

1. `npm install`, then make your change.
2. Run `npm run harness`. It must pass: typecheck, lint, unit, contracts, golden, e2e, and the failure-injection cases.
   Tests use an in-memory PostgreSQL and scripted model/retrieval doubles; no keys or services are needed.
3. Keep to the project's invariants (see [`CLAUDE.md`](CLAUDE.md) and [`docs/adr/`](docs/adr/README.md)):
   model output is untrusted until validated; provenance comes from retrieval; contradictions are never dropped;
   claim state and confidence stay separate; history is append-only; failures are explicit.
4. A change to behavior needs a test (a golden case if it alters evidence semantics), and docs updated in the same change.
5. Never commit secrets. `.env.local` is git-ignored; `.env.example` lists names only.
