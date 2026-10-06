# EvidenceOS — Judge / Reviewer Guide

## One-Sentence Explanation
EvidenceOS is a living evidence system that transforms complex questions into inspectable claims, evidence relationships, evaluations, and traceable state changes.

## 30-Second Pitch
> “Most AI research tools give you an answer and citations. EvidenceOS focuses on the evidence state underneath that answer. It decomposes a question into claims, connects each claim to traceable evidence, preserves support and contradiction, validates AI outputs with deterministic rules, and records how the state changes when new evidence arrives.”

## What Makes It Different

### Evidence Is First-Class
Evidence is persisted with claim, source, excerpt, relationship, strength, reasoning, and provenance.

### Contradiction Is First-Class
The system explicitly represents `SUPPORTS`, `PARTIALLY_SUPPORTS`, `CONTRADICTS`, and `INSUFFICIENT`.

### State Is Explicit
Claims use `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONFLICTING`, or `INSUFFICIENT`.

### State Can Change
New evidence can cause:

```text
PARTIALLY_SUPPORTED
        ↓
CONFLICTING
```

The transition is persisted as history.

### LLMs Are Not Final Authority
```text
LLM interpretation
        ↓
structured output
        ↓
deterministic validation
        ↓
persisted state
```

## Judge Questions

### “Isn't this just RAG?”
RAG retrieves context for generation. EvidenceOS models the evidence itself: claims, sources, relationships, contradiction, uncertainty, evaluation, and historical state.

### “How do you prevent hallucinated sources?”
The research agent cannot invent provenance, and deterministic validation rejects evidence without valid source/provenance relationships.

### “Can the model change the database?”
Not directly. Model output is structured, validated, and passed through controlled workflow and persistence boundaries.

### “What happens when evidence conflicts?”
Contradiction is preserved as a first-class relationship. The analyst considers both supporting and contradictory evidence.

### “How do you evaluate an AI system?”
With deterministic rules, golden cases, evaluator scoring, failure injection, contract tests, and E2E tests protected by a harness.

### “What happens when new evidence arrives?”
The claim is re-evaluated. If the validated state changes, a change record is created with the reason and triggering evidence.

### “What happens when an agent fails?”
Completed valid work is preserved, the failure is recorded, and bounded retries are used rather than falsely reporting success.

## Core Principle
> LLMs interpret. Evidence provides grounding. Structured state provides memory. Deterministic rules provide control. Humans interpret the final result.
