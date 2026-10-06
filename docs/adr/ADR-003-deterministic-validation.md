# ADR-003: Deterministic validation around LLMs

Status: Accepted

## Context

Model output is probabilistic. Critical invariants (no fabricated provenance, no unsupported state, no dropped contradiction) cannot depend on a model behaving well every time.

## Decision

```text
LLM output → structured schema → deterministic validation → persistence
```

Every agent returns a closed JSON schema that is checked (unknown fields rejected). A separate rules layer (`frontend/src/validation/rules.ts`) applies hard rules with stable ids. The Evaluator's accept/reject decision is computed in code and a hard-rule failure rejects regardless of its opinion. The database repeats the structural rules (foreign keys, checks, state-change and history triggers).

## Alternatives Considered

- **Rely on prompting and an LLM judge alone.** Variable, and a judge can agree with a flawed answer.
- **Validate only in the database.** Catches integrity errors but not semantic ones such as a quote that is not in the source.

## Consequences

Critical invariants hold even when model output varies, and they can be tested with failure injection. Rules must be maintained as states and schemas evolve, and the rules can reject legitimate but unusual model output; those cases surface as explicit failures rather than silent acceptance.
