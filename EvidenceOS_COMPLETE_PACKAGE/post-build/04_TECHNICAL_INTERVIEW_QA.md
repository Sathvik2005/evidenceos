# EvidenceOS — Technical Interview Q&A

## What problem does EvidenceOS solve?
Complex questions rarely have one clean evidence path. Evidence can support one aspect, contradict another, or be insufficient. EvidenceOS models this explicitly.

## Why isn't this just RAG?
RAG is primarily a retrieval-and-generation pattern. EvidenceOS additionally models claims, evidence, sources, relationships, contradiction, state, evaluation, history, and change detection.

## Why deterministic validation?
LLMs are probabilistic. Critical integrity rules should not be. For example, a `SUPPORTED` claim must have supporting evidence.

## Why separate state and confidence?
State describes the evidence relationship; confidence describes how strongly the assessment is justified. They answer different questions.

## Why multiple agents?
Each agent has a narrow contract, improving testing, observability, failure isolation, prompt design, and permissions.

## Why an evaluator?
The Evidence Analyst proposes an assessment; the Evaluator independently audits evidence quality, grounding, contradiction handling, state justification, and uncertainty.

## What prevents hallucinated evidence?
Retrieval/provider boundaries, structured schemas, provenance requirements, deterministic validation, golden tests, and failure injection.

## What happens when evidence contradicts existing evidence?
It is stored rather than discarded. The complete evidence set is evaluated. If the resulting state changes, the transition is persisted.

## How is change detected?
Compare the previous persisted state with the new validated state. Only meaningful transitions create a change record.

## How is history protected?
History is append-oriented and immutable. A change records previous state, new state, reason, triggering evidence, and timestamp.

## What happens on retry?
The workflow is designed to be idempotent so retries do not create unintended duplicate claims, evidence, or state changes.

## What happens if one claim fails?
Valid completed work is preserved. The investigation can enter a partial/review state instead of falsely reporting complete success.

## Why not let the frontend update claim state?
The frontend is not the source of truth. State must come from validated backend/persisted data.

## How would you scale research?
Parallelize research per claim with bounded concurrency, bounded retries, deterministic persistence, and claim-specific provenance.

## How would you reduce LLM cost?
Bound claim/evidence counts, deduplicate, cache validated evidence, avoid unnecessary re-analysis, and re-evaluate only affected claims.

## How do you evaluate AI behavior?
Use unit tests, contract tests, golden cases, failure injection, E2E tests, evaluator scoring, and a regression harness.

## What is the key invariant?
> AI-generated interpretation must never silently become authoritative evidence state without structured validation and provenance.

## What is the hardest engineering problem?
> The hard part isn't calling an LLM. It is controlling what the LLM is allowed to influence, preserving provenance, handling contradiction and failure, and making state inspectable and reproducible.

## What would you build next?
First measure real failure patterns and usage, then improve retrieval quality, evaluation coverage, and operational reliability before expanding the product surface.
