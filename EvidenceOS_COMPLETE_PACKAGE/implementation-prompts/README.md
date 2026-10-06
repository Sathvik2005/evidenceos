# EvidenceOS Implementation Prompts

This directory contains the 22 sequential implementation prompts for EvidenceOS.

## Execution model

Run exactly one prompt at a time:

```text
READ SPEC
   ↓
IMPLEMENT
   ↓
TEST
   ↓
HARNESS
   ↓
REVIEW
   ↓
ACCEPT
   ↓
NEXT PROMPT
```

Do not ask the coding agent to execute the next prompt automatically.

## Order

01 Repository & Environment Foundation
02 Momen Project Foundation
03 Database & Data Model
04 API & Backend Actions
05 LangGraph Workflow Foundation
06 Claim Decomposer Agent
07 Research Agent
08 Evidence Analyst Agent
09 Deterministic Validation
10 Evaluator Agent
11 Complete Investigation Workflow
12 Harness & Golden Dataset
13 Frontend Foundation
14 Investigation UI
15 Claim & Evidence UI
16 Evidence Graph
17 Change Detection
18 E2E Integration
19 Testing & Failure Injection
20 Deployment
21 Demo Hardening
22 Final Audit

## Recovery rule

If a prompt fails:

1. Stop.
2. Preserve the failure output.
3. Identify whether the failure is implementation, environment, specification, or pre-existing.
4. Fix only the current prompt's scope.
5. Rerun the relevant tests/harness.
6. Continue only after acceptance criteria pass.

## Core EvidenceOS invariant

LLMs interpret. Evidence provides grounding. Structured state provides memory. Deterministic rules provide control. Humans interpret the final result.

## Recommended execution

Use Claude Code/Codex from the repository root and paste the contents of the selected prompt file. After completion, review the report before moving forward.
