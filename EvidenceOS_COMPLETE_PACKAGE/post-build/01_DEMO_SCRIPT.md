# EvidenceOS — 3–5 Minute Demo Script

## Objective
Prove that EvidenceOS is not a chatbot or simple RAG wrapper. It turns a complex question into inspectable claims and evidence, preserves contradiction and uncertainty, and records state changes.

## Canonical Question
> Does remote learning improve student outcomes?

## Demo Sequence

### 1. Opening
> “EvidenceOS is an evidence-state system for complex questions. Instead of giving you one AI-generated answer, it decomposes a question into claims, connects those claims to traceable evidence, exposes contradictions and uncertainty, and records how the evidence state changes over time.”

### 2. Start Investigation
Enter the canonical question and start the investigation.

> “The system turns the question into smaller researchable claims rather than treating the entire question as one answer.”

### 3. Claims
Show several claims:
- Remote learning affects academic performance.
- Remote learning affects student engagement.
- Effects differ across student populations.
- Effects differ depending on course type.

### 4. Evidence
Open a claim and show:
- state;
- confidence;
- why;
- supporting evidence;
- contradictory evidence;
- uncertainty;
- source metadata;
- excerpts.

> “The conclusion is inspectable. I can see the evidence, source, relationship, and reasoning instead of trusting an opaque generated answer.”

### 5. Contradiction
> “EvidenceOS does not hide conflicting evidence. Contradiction is a first-class relationship and remains visible even when the claim state changes.”

### 6. Graph
Show Claim → Evidence → Source and relationships:
`SUPPORTS`, `PARTIALLY_SUPPORTS`, `CONTRADICTS`, `INSUFFICIENT`.

> “The graph is a view over persisted evidence relationships, not generated decoration.”

### 7. Signature Moment
Introduce new evidence and trigger the real workflow:

```text
PARTIALLY SUPPORTED
        ↓
   NEW EVIDENCE
        ↓
CONFLICTING
```

> “This is not a frontend animation. The evidence is persisted, validated, evaluated, and causes a real state transition.”

### 8. History
Show:
- previous state;
- new state;
- reason;
- triggering evidence;
- timestamp.

### 9. Architecture
Explain:

```text
React
 ↓
Momen
 ↓
LangGraph
 ↓
Agents
 ↓
Deterministic Validation
 ↓
PostgreSQL
 ↓
Evidence State
```

> “LLMs interpret and research. Structured outputs are validated. Deterministic rules control what can become persisted truth.”

### 10. Evaluation
Mention:
- deterministic hard rules;
- golden dataset;
- evaluator;
- failure injection;
- E2E tests;
- harness.

### 11. Closing
> “EvidenceOS doesn't tell you what to believe. It shows you what the evidence currently supports, where it conflicts, what remains uncertain, and what changed when new evidence arrived.”

## Demo Rules
Never fake a state transition, manually alter claim state, hard-code graph relationships, hide contradictory evidence, or present synthetic fixtures as real-world evidence.

## Final Check
- [ ] Application starts
- [ ] Demo seed exists
- [ ] Investigation opens
- [ ] Claims load
- [ ] Evidence and sources are inspectable
- [ ] Contradiction is visible
- [ ] Graph works
- [ ] New evidence workflow works
- [ ] State changes
- [ ] History records the change
- [ ] Reset works
- [ ] No console errors
