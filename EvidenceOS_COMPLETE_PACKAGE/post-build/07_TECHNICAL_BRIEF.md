# EvidenceOS — One-Page Technical Brief

## Product
**EvidenceOS**

> Build evidence. Track change. Understand what holds up.

## Problem
Complex questions rarely have one definitive evidence path. AI systems can produce fluent answers while obscuring evidence, contradiction, uncertainty, provenance, and change.

## Solution
EvidenceOS models evidence as structured, persistent state.

```text
Question
 ↓
Claims
 ↓
Evidence
 ↓
Relationships
 ↓
Evaluation
 ↓
State
 ↓
Change
```

## Architecture
```text
React
 ↓
Momen
 ↓
LangGraph
 ↓
Bounded Agents
 ↓
Deterministic Validation
 ↓
PostgreSQL
```

## Agents
| Agent | Responsibility |
|---|---|
| Claim Decomposer | Question → atomic claims |
| Research Agent | Claim → evidence candidates |
| Evidence Analyst | Evidence → assessment |
| Evaluator | Assessment → quality evaluation |

## Evidence States
`SUPPORTED` · `PARTIALLY_SUPPORTED` · `CONFLICTING` · `INSUFFICIENT`

## Evidence Relationships
`SUPPORTS` · `PARTIALLY_SUPPORTS` · `CONTRADICTS` · `INSUFFICIENT`

## Trust Model
```text
LLMs interpret
Evidence grounds
Structured state remembers
Deterministic rules control
Humans interpret
```

## Safety
- `SUPPORTED` requires support.
- `CONFLICTING` requires contradiction.
- Evidence requires provenance.
- State changes require real transitions.
- History is immutable.

## Evaluation
```text
Unit Tests
Contract Tests
Golden Dataset
Failure Injection
E2E Tests
Evaluator
Harness
```

## Signature Capability
```text
PARTIALLY SUPPORTED
        ↓
   NEW EVIDENCE
        ↓
CONFLICTING
```

## Why It Matters
EvidenceOS shifts AI from “Here is an answer” toward:

> “Here is the current evidence state, why it looks this way, what conflicts with it, and what changed.”
