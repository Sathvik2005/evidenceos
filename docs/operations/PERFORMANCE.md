# Performance

No formal benchmark has yet been established. Nothing below is a measured number; it describes where time is spent and what bounds the work.

## Frontend

- **Initial load:** client bundle about 89 kB gzip at the final audit (a build output, not a load-time measurement). No code splitting or load testing has been done.
- **Investigation page:** polls the API for status and claims while a run is live; refreshes keep the last good data instead of blanking the view.
- **Claim detail:** loads claims, evidence, sources and changes, each paginated (default 25, maximum 100 per request).
- **Graph:** built from persisted claims, evidence and sources and rendered with a list fallback. The number of nodes is bounded in practice by 6 claims and the per-claim document caps; large evidence sets have not been tested.

## Backend

- **API latency:** reads are indexed lookups scoped by owner and investigation. Indexes exist on investigation owner/created and status/created, claims by investigation/state, sources by investigation/type, evidence by claim/created and by source, and changes by claim/changed time. Not measured.
- **Workflow startup:** the API returns `201` immediately after creating the investigation and claiming the run. The workflow continues after the response (`waitUntil`, up to the function's `maxDuration`).
- **Persistence:** idempotent inserts check for an existing record by idempotency key before writing; claim state changes are applied atomically by a trigger.
- **Connections:** a small pool (max 5) reused across warm invocations; connection timeout 10 s.

## AI

- Provider latency is the dominant cost of a run: one decomposition call, then per claim a search call, a research call, an analysis call and an evaluation call. Anthropic requests time out at 60 s by default and Tavily requests at 20 s, with at most two retries.
- Retrieval and analysis latency depend on provider response time and document size (capped at 6,000 characters per document, 8 documents per claim).

## Parallelism

Per-claim steps (research, analysis, evaluation, persistence and change detection) run concurrently across claims through a shared helper (`forEachClaim`, `Promise.all`), with a failure in one claim recorded without discarding the others. Within one claim the steps are sequential. Safety relies on database constraints and idempotency keys, not on ordering assumptions. Concurrency is not capped beyond the 6-claim limit.

## Bottlenecks (expected, not measured)

1. Sequential model calls within a claim (research → analysis → evaluation).
2. Provider rate limits when claims run concurrently.
3. Run duration versus the serverless function's maximum duration.
4. Graph rendering with unusually large evidence sets.

## Principles

```text
Bounded work · Efficient queries · Pagination · Deduplication
Parallel independent work · Avoid unnecessary LLM calls
```

To establish a baseline: time end-to-end runs with live providers, record p50/p95 per workflow node from the trace timestamps, and load-test the read endpoints against a seeded database.
