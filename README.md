# EvidenceOS

**Build evidence. Track change. Understand what holds up.**

EvidenceOS is an evidence operating system for complex questions. Instead of one AI answer, it turns a
question into a structured, inspectable evidence state: claims, sources, evidence, contradictions, an
evaluated claim state, and a history of how that state changed when new evidence arrived.

> **LLMs interpret. Evidence provides grounding. Structured state provides memory. Deterministic rules provide control.**

```text
Question → Claims → Sources → Evidence → Relationships → Validation → Evaluation → Evidence State → Change History
```

Each claim is **Supported**, **Partially supported**, **Conflicting** or **Insufficient** (state), with a
separate **High / Medium / Low** confidence. EvidenceOS does not decide what is true; it shows what the
available evidence currently supports, where it conflicts, and what changed.

```text
PARTIALLY SUPPORTED  →  NEW EVIDENCE  →  CONFLICTING      (recorded, with the triggering evidence)
```

## Status

Prompts 01–21 are built and verified by `npm run harness`; the final audit is in
[`docs/FINAL_AUDIT.md`](docs/FINAL_AUDIT.md). Most prompts are marked **Provisional** because the
authoritative specification files (`DATA_MODEL.md`, `RULES.md`, …) and a Momen project export are not in
this repository. Read [Known limitations](#known-limitations) before relying on it.

## Architecture

```text
Browser (React + Vite + TypeScript)
        │  same-origin /api
Vercel Function  ──►  HTTP API ──► typed, owner-scoped operations ──► PostgreSQL
        │
        └─ LangGraph workflow ─► Claim Decomposer → Research → [validation] → Evidence Analyst
                                  → [deterministic validation] → Evaluator → persist → change detection
```

Details, trust boundaries and deviations: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick start

Requires Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run typecheck && npm run lint && npm test   # everything runs on an in-memory PostgreSQL; no services needed
npm run harness                                  # static checks + unit + contracts + golden + e2e, with a report
npm run dev --workspace=@evidenceos/frontend     # UI only; the API needs the server configuration below
```

## Configuration

Copy `.env.example` to `.env.local`. Names only are listed here; never commit values.

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | server | PostgreSQL connection string (required) |
| `ANTHROPIC_API_KEY`, `LLM_MODEL` | server | Language model for the agents |
| `TAVILY_API_KEY`, `RESEARCH_PROVIDER` | server | Web retrieval for the Research Agent |
| `APPLICATION_ENV` | server | `development`, `test`, `demo` or `production` |
| `DEMO_INVESTIGATION_ID`, `DEMO_OWNER_ID` | server | Optional read-only public demo investigation |
| `VITE_MOMEN_GRAPHQL_URL`, `VITE_MOMEN_SUBSCRIPTION_URL` | public | Momen endpoints (diagnostic only today) |
| `MOMEN_ADMIN_TOKEN` | server only | Never exposed to the browser; unused by the app |

Without model and retrieval keys the server still serves reads and `/api/health`, and refuses new
investigations with an explicit "research is not configured" error.

## Commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` / `lint` / `test` / `build` | Standard checks and production build |
| `npm run test:contracts` / `test:golden` / `test:e2e` | One test layer |
| `npm run harness` | Full gate; writes `harness-report.json` (hard-rule failures, semantic regressions, infrastructure failures, model variance, failure-injection summary) |
| `npm run db:migrate` | Apply `database/migrations/*.sql` to `DATABASE_URL` |
| `npm run demo:seed` / `demo:advance` | Seed the demo investigation / reveal the new evidence ([`docs/DEMO.md`](docs/DEMO.md)) |
| `npm run momen:check` | Anonymous probe of the Momen endpoint |

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | As-built architecture, data model, trust boundaries |
| [`docs/api-contracts.md`](docs/api-contracts.md) | Operations and HTTP API |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel + PostgreSQL deployment, smoke test, rollback and recovery |
| [`docs/DEMO.md`](docs/DEMO.md) | Demo script, checklist, recovery |
| [`docs/FINAL_AUDIT.md`](docs/FINAL_AUDIT.md) | Prompt 22 audit |
| [`docs/momen-setup.md`](docs/momen-setup.md) | Momen configuration and its current status |
| [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md) | Per-prompt status and system-design conformance |

## Known limitations

- **Momen is not connected.** The specification names Momen as the backend; its GraphQL introspection is
  disabled and no project export exists, so the API talks to PostgreSQL directly. This needs an explicit
  decision (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).
- **Specifications missing.** `DATA_MODEL.md`, `RULES.md`, `PRD.md`, `GOLDEN_SPECS.md` and the others are
  not in the repository; the schema, enums and golden cases are derived from `agents.md` and the system design.
- **Not run against live providers or a hosted database in this repository's history.** All tests use an
  in-memory PostgreSQL and scripted model/retrieval doubles; the Anthropic, Tavily, `pg` and Vercel
  integrations are implemented but unverified until configured and smoke-tested ([`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)).
- **No accounts.** Ownership is an anonymous per-browser cookie; clearing it loses access to your investigations.
- **Workflow checkpoints are in memory.** A cut-off run is recovered by re-running, which reuses saved work
  idempotently (claims, sources, evidence, history) but repeats model calls.
