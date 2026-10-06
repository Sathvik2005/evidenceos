# ADR-008: State and confidence are separate

Status: Accepted

## Context

A single "how true is it" value conflates two questions: what the evidence relates to (supports, partly supports, conflicts, is insufficient) and how sure the assessment is.

## Decision

```text
Claim state  ≠  Confidence
```

State (`SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONFLICTING`, `INSUFFICIENT`) describes the relationship between the evidence and the claim. Confidence (`HIGH`, `MEDIUM`, `LOW`) describes confidence in that assessment. They are separate columns, separate model fields and separate validation rules; a deterministic rule limits `HIGH` confidence to well-evidenced cases. The distinction must stay stable throughout the system, and the UI displays them as two things.

## Alternatives Considered

- **One score or label** (for example "70% true"): compact, but implies precision that does not exist and cannot say why.
- **State only:** loses the signal that a `SUPPORTED` claim may rest on thin evidence.

## Consequences

Users can read, for example, `INSUFFICIENT` with `LOW` confidence, or `PARTIALLY_SUPPORTED` with `MEDIUM`, without them being merged. Schemas, prompts, rules, tests and UI must keep two fields; confidence changes alone do not create history records, only state changes do.
