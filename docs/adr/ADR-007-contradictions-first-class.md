# ADR-007: Contradictions are first-class data

Status: Accepted

## Context

When evidence disagrees, a clean-looking answer is tempting. Hiding contradiction produces confident output that overstates what the evidence supports.

## Decision

Contradictory evidence is an explicit relationship (`CONTRADICTS`) stored like any other evidence. The analyst must cite every contradicting item, deterministic rules reject `SUPPORTED` when material contradiction exists and reject `CONFLICTING` without evidence on both sides, and the UI shows contradicting evidence prominently. `CONFLICTING` is a first-class claim state.

## Alternatives Considered

- **Hide contradiction** and present a single best answer: simpler and more impressive, but epistemically dishonest.
- **Keep contradiction only in prose rationale:** easy for validation and the UI to lose.

## Consequences

EvidenceOS prioritises epistemic transparency over a smooth answer. Users see disagreement and can judge it. The cost is noisier output and more rules to maintain; an analyst that silently drops a contradiction is rejected, not corrected.
