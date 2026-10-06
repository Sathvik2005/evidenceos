# Deployment (Vercel + PostgreSQL)

Status: the configuration is written and tested locally. The database path was verified on 2026-10-06 against a hosted
Supabase PostgreSQL: use the **Session pooler** connection string, because the direct `db.<ref>.supabase.co` host is
IPv6-only and fails on IPv4-only networks. The Vercel deployment and live Anthropic/Tavily runs have **not** been done;
use the smoke test below to verify them.

## What gets deployed

- **Frontend**: `npm run build` → `frontend/dist`, served by Vercel (`vercel.json` also sends non-API paths to `index.html`).
- **API**: the Vercel Function `api/[...path].ts` (Node runtime) handling `/api/*`. Research runs after the response using `waitUntil`, with `maxDuration` 300 s (check your plan's limit).
- **Database**: any PostgreSQL 15+ reachable from Vercel (for example a Vercel-marketplace Postgres, Neon or Supabase). Set `DATABASE_URL`.
- **Momen**: not used by the application today ([`ARCHITECTURE.md`](ARCHITECTURE.md), deviation 1).

## Environment

Set in Vercel → Project → Settings → Environment Variables, per environment (Development / Preview / Production). Do not reuse production keys or databases in Preview.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Connection string with TLS (`sslmode=require`) |
| `ANTHROPIC_API_KEY` | for research | Without it, new investigations are refused with a 503 explaining why |
| `LLM_MODEL` | no | Defaults to `claude-sonnet-5-5` |
| `TAVILY_API_KEY` | for research | Retrieval provider |
| `APPLICATION_ENV` | yes in production | `production` also marks cookies `Secure` |
| `DEMO_INVESTIGATION_ID`, `DEMO_OWNER_ID` | no | Set together to expose one read-only demo |

Never put these under a `VITE_` prefix: that would ship them to the browser.

## First deployment

1. Create the database and run migrations from a trusted machine: `DATABASE_URL=… npm run db:migrate` (idempotent; records applied files in `schema_migrations`).
2. Import the repository in Vercel. Framework preset **Other**; the build and output settings come from `vercel.json`.
3. Set the environment variables, then deploy.
4. Smoke test (below). Seed the demo if you want one ([`DEMO.md`](DEMO.md)).

## Smoke test (production-like)

```sh
BASE=https://<your-domain>
curl -s $BASE/api/health                         # {"status":"ok"}; 503 means the database is unreachable
curl -si $BASE/ | head -1                        # 200, the app shell
curl -si -X POST $BASE/api/investigations \
  -H 'content-type: application/json' -d '{"question":"Does remote learning improve student outcomes?"}'
# 201 + a Set-Cookie (HttpOnly; SameSite=Lax; Secure) and an investigation id; 503 "not configured" if keys are missing
```

Then open the app, start an investigation and confirm the status moves Created → Researching →
Analyzing → Ready (or Review required, with the reason shown). Expect minutes, not seconds, with live providers.

## Boundaries and security checks

- **CORS**: none. The API is same-origin only; cross-origin `POST`s are rejected (`403`) and no `Access-Control-*` headers are sent.
- **Headers** (`vercel.json`): CSP restricting scripts/connections to self, `X-Frame-Options: DENY`, `nosniff`, strict referrer policy. API responses are `no-store`.
- **Logs**: one JSON line per request and workflow step (method, path, status, duration, node, outcome). Request bodies, source text, cookies and keys are never logged.
- **Health**: `GET /api/health` runs `SELECT 1`; wire it to an uptime monitor.

## Rollback and recovery

- **Bad deploy**: Vercel → Deployments → promote the previous deployment (instant). Database migrations are forward-only; schema changes must stay backward-compatible with the previous deployment for one release, or be reverted with a new forward migration.
- **Stuck investigation** (function cut off): the page offers *Resume research* after 10 minutes without progress; the API takes over only such abandoned runs. Resuming reuses saved claims, sources, evidence and history without duplicates, and repeats model calls.
- **Failed run (`ERROR`)**: *Check for new evidence* / retry re-runs it; partial results already saved are kept.
- **Database loss**: restore from the provider's backups. History is append-only, so restore the whole database rather than editing rows.
- **Key compromise**: rotate in the provider console, update the Vercel variable, redeploy. Rotate `MOMEN_ADMIN_TOKEN` if it was ever shared in chat or a ticket.
- **Never** repair data by hand-editing claims or history; the triggers will reject it by design.

## Pre-release gate

`npm run harness` must report PASS (typecheck, lint, unit, contracts, golden, e2e, and 10/10 failure-injection cases), then `npm run build` and `npm audit --omit=dev`.
