# EvidenceOS — Architecture Explanation

## High-Level Architecture

```text
React + Vite + TypeScript
          ↓
Momen Backend / API / Data
          ↓
LangGraph Workflow
          ↓
Bounded AI Agents
          ↓
Deterministic Validation
          ↓
Evaluator
          ↓
PostgreSQL
          ↓
Evidence State
```

## Core Design

The system deliberately separates interpretation from truth:

```text
LLM
 ↓
Structured Output
 ↓
Validation
 ↓
Persisted State
```

A model can propose an interpretation; it cannot simply declare that interpretation authoritative.

## Workflow

```text
QUESTION
 ↓
CLAIM DECOMPOSITION
 ↓
RESEARCH
 ↓
EVIDENCE EXTRACTION
 ↓
EVIDENCE VALIDATION
 ↓
CLAIM ANALYSIS
 ↓
DETERMINISTIC VALIDATION
 ↓
EVALUATION
 ↓
STATE
 ↓
CHANGE DETECTION
 ↓
HISTORY
```

## Agents

- **Claim Decomposer:** question → atomic researchable claims.
- **Research Agent:** claim → evidence candidates with provenance.
- **Evidence Analyst:** claim + evidence → assessment.
- **Evaluator:** assessment → quality evaluation.

## Deterministic Layer

Critical rules are enforced without relying on model judgment:

- supported claims require support;
- conflicting claims require contradiction;
- evidence must reference a valid claim;
- evidence must have provenance;
- change history requires a real state transition.

## Why LangGraph?

It provides explicit workflow nodes, transitions, checkpoints, retries, structured state, and resumability.

The important architectural idea is not “agents everywhere.”

It is:

> **A controlled workflow containing bounded AI interpretation steps.**

## Why Persistence?

Persistence enables current state, evidence history, change history, and traceability. That turns a one-shot AI interaction into a living evidence system.

## Trust Boundary

```text
External Sources
      ↓
Research / Extraction
      ↓
LLM Interpretation
      ↓
Structured Output
      ↓
Deterministic Validation
      ↓
Persistence
      ↓
Human Inspection
```

Each boundary limits uncontrolled AI output from becoming system truth.
