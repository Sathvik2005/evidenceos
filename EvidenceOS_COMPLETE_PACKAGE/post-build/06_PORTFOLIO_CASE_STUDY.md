# EvidenceOS — Portfolio Case Study

## Title
# EvidenceOS: Engineering an AI System That Knows What Its Evidence Can Actually Support

## Overview
EvidenceOS is a living evidence system designed for complex research questions. Instead of producing a single AI-generated answer, it maintains an inspectable evidence state.

## Problem
Traditional AI research workflows can collapse question, retrieval, reasoning, and answer into one generated response. That makes evidence, contradiction, uncertainty, provenance, and change difficult to inspect.

## Design Decision
> Keep AI interpretation probabilistic, but keep evidence state structured and controlled.

This produced:

```text
LLM interpretation
        ↓
Structured output
        ↓
Deterministic validation
        ↓
Persisted evidence state
        ↓
Human inspection
```

## Core Data Model
```text
Investigation
    ↓
Claim
    ↓
Evidence
    ↓
Source
    ↓
Relationship
    ↓
Evaluation
    ↓
State
    ↓
Change
```

## AI System
- **Claim Decomposer:** broad question → atomic researchable claims.
- **Research Agent:** claim → evidence candidates with provenance.
- **Evidence Analyst:** evidence set → assessment.
- **Evaluator:** assessment → quality evaluation.

## Why Bounded Agents?
A single agent makes responsibility difficult to test. Bounded agents provide clearer contracts, targeted retries, observability, and controlled permissions.

## Deterministic Safety Layer
Examples:
- supported claims require support;
- conflicting claims require contradiction;
- evidence must reference a valid claim;
- evidence must have provenance;
- changes require real state transitions.

## Contradiction
Contradiction is a first-class relationship:

```text
SUPPORTS
PARTIALLY_SUPPORTS
CONTRADICTS
INSUFFICIENT
```

## Change Detection
```text
PARTIALLY_SUPPORTED
        ↓
NEW EVIDENCE
        ↓
CONFLICTING
```

The transition records previous state, new state, reason, triggering evidence, and timestamp.

## Evaluation
```text
hard rules
+
golden dataset
+
failure injection
+
contract tests
+
E2E tests
+
evaluator rubric
+
harness
```

## Engineering Lessons

### 1
The difficult part of AI engineering is not calling the model. It is controlling the model's influence.

### 2
Provenance belongs in the data model, not merely the UI.

### 3
Contradiction must be modeled explicitly when evidence is complex.

### 4
AI evaluation needs behavioral invariants, not only example outputs.

### 5
Persistence turns a one-shot interaction into a living system.

## Result
EvidenceOS provides an inspectable chain:

```text
Question
 → Claim
 → Evidence
 → Source
 → Relationship
 → Evaluation
 → State
 → Change
```

## Final Takeaway
> The goal was not to build an AI that sounds certain. The goal was to build an AI system whose uncertainty, evidence, contradictions, and changes can be inspected.

## Skills Demonstrated
AI/LLM engineering · LangGraph workflows · structured generation · deterministic validation · evaluation harnesses · agent design · PostgreSQL · API design · React/TypeScript · E2E testing · failure injection · deployment · product architecture
