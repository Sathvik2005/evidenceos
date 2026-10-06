# Observability

Status key: **Implemented** (in code and tested), **Planned** (not present). No metrics system, tracing backend or alerting exists.

## Execution identity

| Identifier | Status | Where |
| --- | --- | --- |
| Investigation ID | Implemented | Every workflow trace entry and workflow log line |
| Claim ID | Implemented | Failure records carry the claim id where one applies |
| Node and attempt number | Implemented | Each trace entry: `node`, `attempt`, `outcome` (`OK`, `RETRY`, `FAILED`), `at`, optional `detail` |
| Workflow (run) ID | **Planned** | Runs are identified by the investigation id and its status; there is no separate run id |
| Agent execution ID | **Planned** | Not recorded |

## Workflow visibility

```text
Investigation → workflow run → node → attempt → outcome
              → validation outcome → persistence → evaluation → state
```

The LangGraph state carries an append-only `trace` of node outcomes and a `failures` list (`node`, failure kind, safe message, claim id). Failure kinds: `VALIDATION`, `PROVIDER`, `TIMEOUT`, `RATE_LIMIT`, `MALFORMED_OUTPUT`, `PERSISTENCE`, `AUTHENTICATION`, `AUTHORIZATION`, `NETWORK`, `WORKFLOW`. Trace and failures live in the run's memory and in logs; they are **not persisted** to the database. What is persisted: investigation status (`CREATED`, `RESEARCHING`, `ANALYZING`, `READY`, `REVIEW_REQUIRED`, `ERROR`), claims with state, confidence and assessment reason, evidence with reasoning, and `evidence_changes` history.

## Logging

Implemented in `backend/evidenceos/server/app.py` and `http.py`: one JSON line per event on stdout (collected by the hosting platform).

| Event | Fields |
| --- | --- |
| `api` | `ts`, `method`, `path`, `status`, `ms` |
| `workflow` | `ts`, node trace fields (`node`, `attempt`, `outcome`, `investigationId`, `detail`) |
| `workflow-crash` | `ts`, `investigationId` |

Error categories are the failure kinds above. Retry information is the `RETRY` outcome and `attempt` number. There is no log level, correlation id across requests, or log shipping configured by this project.

## Metrics

None are collected. **Planned** candidates, only if wanted: request latency (the `ms` field already exists per request and can be aggregated from logs), workflow duration (derivable from trace timestamps), retry counts, provider error rates, validation-failure counts, evidence counts and evaluation scores. The harness report (`harness-report.json`) summarizes test results and failure-injection outcomes; it is a test artifact, not production monitoring.

## Health

`GET /api/health` returns `200 {"status":"ok"}` after a `SELECT 1`, else `503`. It checks database reachability only, not provider availability.

## What must never be logged

API keys, admin tokens, passwords, connection strings, cookies, request bodies, and retrieved source text. The existing log lines contain none of these. Keep it that way when adding fields.

## Debugging workflow

1. Get the **investigation id** from the URL (`/investigations/:id`).
2. Read `GET /api/investigations/:id`: the status says whether the run is live, finished, `REVIEW_REQUIRED` or `ERROR`.
3. Search platform logs for that id: `workflow` lines show which node ran, how many attempts, and where it failed. `api` lines show the request outcomes.
4. Check the failure kind. Transient kinds (`PROVIDER`, `TIMEOUT`, `RATE_LIMIT`, `NETWORK`) were retried at most twice; `VALIDATION` and `MALFORMED_OUTPUT` indicate the model or retrieval produced something the rules rejected.
5. Inspect persisted state: claims (state, confidence, assessment reason), evidence, sources, and `evidence_changes`.
6. A stalled run (no progress for 10 minutes) can be re-run with `POST /api/investigations/:id/refresh`; the rerun is idempotent and reuses saved work.

## Gaps

No durable run history, no distributed tracing, no alerting, no dashboards, and no per-investigation cost or token accounting.
