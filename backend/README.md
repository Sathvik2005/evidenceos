# EvidenceOS backend (Python)

FastAPI + LangGraph + psycopg. It turns a question into claims, retrieves real sources, validates every piece of
evidence with deterministic rules, assesses and audits each claim, and records state changes in an append-only history.
Design and decisions: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md), [ADR-011](../docs/adr/ADR-011-python-backend.md).

## Setup

Python 3.11+ is required.

```sh
npm run backend:setup          # from the repository root: creates backend/.venv and installs `.[dev]`
# or by hand:
python -m venv .venv && .venv/bin/pip install -e ".[dev]"      # Windows: .venv\Scripts\pip
```

## Everyday commands (from the repository root)

| Command | What it does |
| --- | --- |
| `npm run test:backend` | pytest. Starts an embedded PostgreSQL 16 once per session and clones a migrated database per test |
| `npm run lint:backend` / `npm run typecheck:backend` | ruff / mypy (strict) |
| `npm run dev:api` | Local API on `127.0.0.1:8787` over an embedded, seeded PostgreSQL; no keys needed (research is reported unavailable) |
| `npm run db:migrate` | Apply `database/migrations/*.sql` to `DATABASE_URL` |
| `npm run seed` / `npm run demo:seed` | Seed the demo without a model / run the real workflow over the recorded corpus (needs keys) |
| `npm run harness` | Everything, with hard-rule gating, written to `harness-report.json` |

`EVIDENCEOS_PYTHON` overrides the interpreter the npm scripts use. Tests need free disk space (an embedded PostgreSQL
writes WAL; the fixture deletes its data directory afterwards).

## Layout

```text
evidenceos/
  contracts.py     enums, validators, ApiResult
  operations.py    owner-scoped, idempotent persistence; the only code that writes records
  db.py            async pool, $n -> named placeholder translation, Windows event-loop helper
  agents/          llm.py (provider boundary), claim_decomposer, research_agent, evidence_analyst, evaluator
  validation/      rules.py: the deterministic hard rules (stable rule ids)
  workflow/        types, graph (LangGraph), handlers (13 nodes), run
  server/          http.py (framework-agnostic), app.py (FastAPI), config, seed, adapters/
  cli/             migrate, seed, demo, devserver
tests/             pytest suite; markers: hard, variance, failure
```

## Running against real services

Set the variables listed in [`../.env.example`](../.env.example) (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`),
run `npm run db:migrate`, then serve the ASGI app with any host, for example
`python -c "from evidenceos.server.app import create_app, serve; serve(create_app(), host='127.0.0.1', port=8000)"`
(`serve` selects an event loop that works on Windows; on Linux `uvicorn` can also import `create_app`).
Deployment to Vercel is described in [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md); it has not been verified yet.

## Rules the code must keep

- Model output is untrusted JSON: schema check, then deterministic rules, before it can become state.
- Provenance comes from retrieval, never from the model; a quote must appear verbatim in the retrieved text.
- A claim's state changes only through an `evidence_changes` record (enforced by database triggers as well).
- No secret is ever logged or returned; configuration errors name the variable, never its value.
