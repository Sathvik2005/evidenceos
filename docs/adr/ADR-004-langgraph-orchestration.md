# ADR-004: LangGraph for orchestration

Status: Accepted (durable checkpointing is not implemented)

## Context

An investigation is a multi-step process with retries, partial failure and per-claim parallel work. Embedding that control flow inside agents would blur their responsibilities.

## Decision

LangGraph owns orchestration: a typed, serializable `InvestigationState`, explicit nodes (load, decompose, validateClaims, persistClaims, research, validateEvidence, analyze, validateAssessment, evaluate, decide, persistState, detectChange, summarize), bounded retries (at most 2, transient failures only) and a trace of node outcomes. Agents contain no workflow logic; handlers call them and persist through the operations layer.

## Alternatives Considered

- **A single agent loop.** Rejected: one agent responsible for research, analysis, validation and persistence destroys responsibility boundaries and is hard to bound.
- **Hand-written orchestration code.** Possible, but loses the explicit state, transition and checkpoint model.

## Consequences

State, transitions and retries are explicit and testable, and execution is bounded. **Gap:** the checkpointer is in memory (`MemorySaver`), so a cut-off run is not resumed from a checkpoint. Recovery today is an idempotent re-run that reuses saved work, plus takeover of runs with no progress for 10 minutes. A durable checkpointer would close the gap.
