<div align="center">

# 🔎 EvidenceOS

**Build evidence. Track change. Understand what holds up.**

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![LangGraph](https://img.shields.io/badge/LangGraph-workflow-1C3C3C)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-state-4169E1?logo=postgresql&logoColor=white)
![Status](https://img.shields.io/badge/status-experimental%20MVP-orange)

An evidence operating system that turns a complex question into claims, sourced evidence, contradictions and a claim state that changes, visibly, when new evidence arrives.

</div>

## Overview

AI tools usually return one confident answer and discard how they got there. EvidenceOS keeps the work: it breaks a question into claims, retrieves real sources, records supporting **and** contradicting evidence with provenance, and stores what the evidence currently supports. When new evidence appears, the claim is re-assessed and any change is written to an append-only history.

## Why it matters

- **Traceable.** Every conclusion links to a verbatim excerpt, its source and the reason it was linked.
- **Contradiction-aware.** Disagreement is stored and shown, never averaged away.
- **State ≠ confidence.** *What the evidence supports* and *how sure we are* are separate fields.
- **Model-independent integrity.** An LLM can propose; deterministic rules decide what is allowed to become state.
- **Change is a feature.** `PARTIALLY SUPPORTED → new evidence → CONFLICTING` is recorded with its trigger, not silently overwritten.

## How it works

```text
Question → Claims → Research (real sources) → Evidence → Validation → Analysis → Evaluation → Claim state → Change history
              LLM        LLM + retrieval     verbatim      rules         LLM        LLM audit    persisted     append-only
```

## Key features

- 🧩 **Claim decomposition** into atomic, researchable claims
- 📎 **Provenance by construction**: quotes must appear verbatim in retrieved text; the model cannot supply URLs, titles or dates
- ⚖️ **Four states** (Supported, Partially supported, Conflicting, Insufficient) with separate High/Medium/Low confidence
- 🛡️ **Hard rules override the model**, including the evaluator's score
- 🕰️ **Immutable history** enforced by database triggers
- 🔁 **Idempotent, bounded workflow**: retries are capped; re-runs create no duplicates; partial failures are reported, not hidden
- 🧭 **Inspectable UI**: claim detail, evidence graph with a text equivalent, state history

## Architecture

```mermaid
flowchart LR
  B[Browser<br/>React + Vite] -->|same-origin /api| F[Vercel Function<br/>HTTP API]
  F --> O[Typed, owner-scoped<br/>operations]
  F -->|starts| W[LangGraph workflow]
  W --> A1[Claim Decomposer]
  W --> A2[Research Agent]
  W --> V[Deterministic validation]
  W --> A3[Evidence Analyst]
  W --> A4[Evaluator]
  A2 --> S[(Search provider)]
  A1 & A3 & A4 --> L[(LLM provider)]
  V --> O
  O --> P[(PostgreSQL<br/>claims · evidence · sources · history)]
```

More diagrams (workflow, state change, data model, provenance) are in [`docs/DIAGRAMS.md`](docs/DIAGRAMS.md); trust boundaries and deviations are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tech stack

| Layer | Technology |
| --- | --- |
| UI | React 19, Vite, strict TypeScript, hand-written CSS tokens (light and dark) |
| Workflow | LangGraph (`@langchain/langgraph`) |
| Models and retrieval | Anthropic SDK, Tavily (behind provider-neutral interfaces) |
| Data | PostgreSQL via `pg`; PGlite for tests |
| Hosting | Vercel (configured, not yet deployed) |
| Quality | Vitest, Testing Library, custom harness |

## Demo

The demo question is **“Does remote learning improve student outcomes?”** over recorded passages copied verbatim from three real public sources (`demo/corpus.json`); the models still run live. Script, checklist and recovery steps: [`docs/DEMO.md`](docs/DEMO.md).

> 📷 *Screenshots / demo video: not yet recorded. Add them under `docs/media/` and link them here.*

## Project structure

```text
api/                 Vercel Function entry (/api/*)
frontend/src/
  agents/            Claim Decomposer, Research, Evidence Analyst, Evaluator
  validation/        Deterministic hard rules
  workflow/          LangGraph graph, node handlers, retries
  api/               Typed contracts and owner-scoped operations
  server/            HTTP app, config, adapters (Anthropic, Tavily, PostgreSQL)
  pages/ components/ graph/ gateway/   UI and browser client
database/migrations/ PostgreSQL schema
demo/                Recorded, verified source corpus
scripts/             Harness, migrations, demo driver, Momen endpoint probe
docs/                Architecture, deployment, security, operations, ADRs, audit
```

## Getting started

Requires Node.js 20.19+ (or 22.12+).

```sh
npm install
npm run harness      # typecheck, lint, unit, contracts, golden, e2e (in-memory PostgreSQL; no services needed)
npm run build
```

**Run the seeded demo locally (no keys, no database server):**

```sh
npm run dev:api                                  # terminal 1: real API over a local file-backed PostgreSQL (PGlite), auto-seeded
npm run dev --workspace=@evidenceos/frontend     # terminal 2: UI on http://localhost:5173 (proxies /api)
npm run seed:advance                             # reveal the seeded "new evidence": PARTIALLY SUPPORTED → CONFLICTING
```

Open the app and choose **View the demo investigation**. New investigations are refused in this mode (research needs model and search keys). Delete `.data/` to start over.

**Run with live research:** needs a PostgreSQL database and provider keys; see [`.env.example`](.env.example), then `npm run db:migrate`. Deployment and the smoke test: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Engineering principles

- **LLMs interpret; evidence grounds; structured state remembers; deterministic rules control.**
- **No fabricated provenance:** retrieval supplies sources, the model only points and quotes.
- **Fail explicitly:** classified failures, bounded retries, `REVIEW_REQUIRED` instead of a fake success.
- **Insufficient is a valid answer.** Overconfidence is treated as a defect.
- **Append-only history,** enforced in the database rather than by convention.

## Status

🧪 **Experimental MVP.** The automated suite and 10 failure-injection cases pass (`npm run harness`), and the seeded demo runs end to end locally. It has **not** yet been deployed, or run against live Anthropic, Tavily or a hosted database. The authoritative spec files other than `agents.md` and the system design are not in this repository, and Momen is deferred ([ADR-010](docs/adr/ADR-010-postgresql-direct-backend.md)). There are no accounts or rate limits yet. Full audit: [`docs/FINAL_AUDIT.md`](docs/FINAL_AUDIT.md).

## Roadmap

- First deployment and live-provider smoke test
- Durable workflow checkpoints (today: idempotent re-run and stale-run takeover)
- Accounts, rate limiting and cost controls before public use
- Momen integration if a project export is provided
- Screen-reader and automated accessibility audit

## Documentation

[`docs/README.md`](docs/README.md) is the index: architecture, API contracts, deployment, demo, security, operations, ADRs and the final audit.

## License / Author

[MIT](LICENSE). Built by Sathvik. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
