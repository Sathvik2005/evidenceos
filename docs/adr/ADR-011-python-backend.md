# ADR-011: The backend is implemented in Python

Status: Accepted (project owner request, 2026-10-06). Refines [ADR-010](ADR-010-postgresql-direct-backend.md): the backend is still the PostgreSQL-direct HTTP API; only its implementation language and runtime changed.

## Context

The first working backend was written in TypeScript next to the React code (agents, validation, LangGraph workflow, HTTP API, Vercel Function). The owner wanted the backend in Python, the language of the AI and data ecosystem the project builds on, with the React UI unchanged.

## Decision

Replace the TypeScript backend with a Python backend in `backend/evidenceos`:

- **API:** FastAPI (ASGI). The request logic is framework-agnostic (`server/http.py`), so it also runs in tests and behind any ASGI host.
- **Workflow:** LangGraph for Python, same 13 nodes, same bounded retries and state-merge semantics.
- **Agents and validation:** the same four agents, schemas, prompts and deterministic rules, ported function by function.
- **Database:** `psycopg` 3 (async pool) against the unchanged SQL migrations in `database/migrations`.
- **Providers:** the `anthropic` SDK and `httpx` for Tavily, behind the same provider-neutral interfaces.
- **Frontend:** keeps only the UI and browser-side wire types (`frontend/src/api/contracts.ts`). `frontend/tests/fixtures/wire.json` pins the record shapes; the backend and the UI tests both assert it.
- **Tests:** pytest against a real PostgreSQL 16 (embedded via `pgserver`, one cloned database per test), so database triggers, constraints and genuine concurrency are exercised, not simulated.

## Alternatives Considered

- **Keep TypeScript.** Working and verified, but not what the owner asked for.
- **Run both.** Two implementations to keep in sync, with no way to say which is authoritative.
- **Python only for the agents, behind the TypeScript API.** Adds a network hop and two runtimes for no product benefit.

## Consequences

- One backend, one language; strict typing is enforced with mypy (strict) and ruff.
- Every behavior of the TypeScript suite was ported (171 backend tests plus 26 UI tests); the ported golden dataset, failure-injection cases and database-integrity tests all pass. A test for correlation-versus-causation at the rules layer was added.
- Local development needs Python 3.11+ (`npm run backend:setup`) in addition to Node for the UI.
- Previously verified items are **no longer verified for this code**: the hosted-PostgreSQL connection, the Vercel deployment (now a Python Function) and live provider calls. See `docs/DEPLOYMENT.md`.
- Windows note: psycopg's async mode cannot use the default Proactor event loop; the server runner and test setup select the selector loop explicitly.
