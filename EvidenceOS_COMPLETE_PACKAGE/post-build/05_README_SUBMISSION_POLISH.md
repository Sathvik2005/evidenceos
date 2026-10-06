# EvidenceOS — README / Submission Polish

## Title
# EvidenceOS

### Build evidence. Track change. Understand what holds up.

## One-Line Description
EvidenceOS is a living evidence system that turns complex questions into structured claims, traceable evidence, explicit uncertainty, contradiction, and historical state changes.

## Problem
AI systems can produce convincing answers while hiding where evidence came from, what supports the conclusion, what contradicts it, what remains uncertain, and why the conclusion changed.

## Solution
```text
Question
 ↓
Claims
 ↓
Research
 ↓
Evidence
 ↓
Relationships
 ↓
Evaluation
 ↓
Evidence State
 ↓
Change History
```

## Example
> Does remote learning improve student outcomes?

EvidenceOS breaks this into claims and shows supporting evidence, contradictory evidence, strength, uncertainty, sources, current state, and historical changes.

## Signature Capability
```text
PARTIALLY SUPPORTED
        ↓
   NEW EVIDENCE
        ↓
CONFLICTING
```

The transition is backed by persisted evidence and change history.

## Architecture
```text
React + Vite
      ↓
Momen
      ↓
LangGraph
      ↓
AI Agents
      ↓
Deterministic Validation
      ↓
PostgreSQL
      ↓
Evidence State
```

## AI Architecture
1. Claim Decomposer
2. Research Agent
3. Evidence Analyst
4. Evaluator

## Trust Model
> LLMs interpret. Evidence provides grounding. Structured state provides memory. Deterministic rules provide control. Humans interpret the result.

## Evaluation
- deterministic hard rules;
- contract tests;
- golden dataset;
- failure injection;
- E2E tests;
- evaluator scoring;
- regression harness.

## Tech Stack
React · Vite · TypeScript · Tailwind CSS · shadcn/ui · Momen · PostgreSQL · LangChain · LangGraph

## Running / Testing
Document the exact commands from the final repository. Do not invent commands.

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run test:contracts
npm run test:golden
npm run test:e2e
npm run harness
npm run build
```

## Demo
Canonical demo:
> Does remote learning improve student outcomes?

Document the exact known-good demo reset procedure.

## Deployment
Document the actual platform, environment variables, migrations, health checks, deployment command, smoke test, and rollback.

## Design Philosophy
EvidenceOS is intentionally quiet, editorial, precise, and evidence-first. It is intentionally not cyberpunk, a chatbot clone, an AI avatar interface, or a generic dashboard.

## Closing
> EvidenceOS doesn't tell you what to believe. It shows you what the evidence currently supports, where it conflicts, what remains uncertain, and what changed when new evidence arrived.
