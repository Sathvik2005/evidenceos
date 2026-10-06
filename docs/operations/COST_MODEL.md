# Cost model

The project does not track billing, tokens or per-investigation cost, and no provider prices appear here. This describes the *structure* of cost and the controls that bound it.

## Structure of one investigation

```text
Investigation
 ├── Claim decomposition        1 model call (plus retries)
 ├── Research × claims          1 search call + 1 model call per claim (plus retries)
 ├── Evidence analysis × claims 1 model call per claim with evidence (none when there is no evidence)
 ├── Evaluation × assessments   1 model call per assessment that passes the hard rules
 └── Retries                    at most 2 per failing step
```

```text
Estimated cost = Decomposition + Σ Research + Σ Analysis + Σ Evaluation + Retries
```

Model calls per run are therefore roughly `1 + 3 × claims` in the no-retry case (decomposition, plus research, analysis and evaluation per claim), with `claims ≤ 6`, plus one search call per claim. Upper bound with retries is about three times that for the model steps. A refresh run repeats the pipeline for the claims it reprocesses.

## Cost drivers

- **Number of claims** (capped at 6 by the Claim Decomposer).
- **Retrieved context size**: at most 8 documents per claim, each truncated to 6,000 characters, so the prompt for research and analysis has a fixed ceiling.
- **Output size**: the Anthropic adapter sets `max_tokens` to 4,096 per call by default.
- **Model selection**: one configured model (`LLM_MODEL`, default `claude-sonnet-5-5`) is used for all agents; there is no per-agent model routing.
- **Retry count**: transient failures and malformed output are retried at most twice.
- **Evaluation calls**: skipped when hard rules already reject an assessment.
- **Parallelism**: per-claim steps run concurrently across claims. It affects latency, not total calls.
- **Caching**: none is implemented. The same question run twice pays twice, although persisted claims, sources and evidence are reused on an idempotent re-run.

## Cost controls (implemented)

- Bounded retries (`DEFAULT_MAX_RETRIES` = 2); deterministic validation failures are not retried as if they were transient.
- Bounded research: document, character and excerpt caps; de-duplication by normalized URL and by candidate.
- Claim cap, question length cap (2,000 characters) and request body cap (16 KB).
- No model call when there is nothing to interpret: no search results means no research model call; no evidence means no analyst call; a hard-rule failure means no evaluator call.
- Deterministic logic does validation, state comparison, id checks and authorization; models only interpret.
- One run per investigation at a time (atomic claim), so double clicks do not double the cost.
- Research is refused (503) when keys are not configured.

## Not controlled

- **No rate limiting or accounts.** A visitor can start many investigations; cost exposure is unbounded per visitor. This is the main cost risk (see the [threat model](../security/THREAT_MODEL.md)).
- No spending cap, budget alert or usage dashboard. Configure provider-side limits on the Anthropic and Tavily accounts.
- No measured token usage, so any dollar estimate would be invented. To estimate, record tokens from provider responses over a few real runs and multiply by current published prices.
