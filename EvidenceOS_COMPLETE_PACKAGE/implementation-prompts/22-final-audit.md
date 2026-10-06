# Prompt 22 — Final Audit

## Objective

Perform the final EvidenceOS audit against every authoritative specification.

Audit:
- CONTEXT.md
- PRD.md
- ARCHITECTURE.md
- DATA_MODEL.md
- AGENT_SPEC.md
- WORKFLOW.md
- EVALUATION.md
- UI_SPEC.md
- RULES.md
- GOLDEN_SPECS.md
- HARNESS.md
- BUILD_PLAN.md
- DEMO.md
- CLAUDE.md

Verify:
1. architecture invariants;
2. data integrity;
3. provenance;
4. contradiction handling;
5. insufficient evidence behavior;
6. agent boundaries;
7. deterministic validation;
8. evaluator behavior;
9. LangGraph durability;
10. UI truthfulness;
11. accessibility;
12. E2E workflow;
13. golden tests;
14. failure injection;
15. deployment;
16. demo path.

Do not introduce new features during the audit. Fix only issues necessary to satisfy the specifications, then rerun the relevant harness layers.

Produce a final audit report with PASS/FAIL per acceptance criterion and a list of remaining known issues.

## Read Before Starting

Read the authoritative EvidenceOS specifications before making changes:

- `CONTEXT.md`
- `PRD.md`
- `ARCHITECTURE.md`
- `DATA_MODEL.md`
- `AGENT_SPEC.md`
- `WORKFLOW.md`
- `EVALUATION.md`
- `UI_SPEC.md`
- `RULES.md`
- `BUILD_PLAN.md`
- `HARNESS.md`
- `CLAUDE.md`

Also inspect the current repository before changing anything.

## Global Constraints

- Do not assume the repository is empty.
- Preserve working behavior unless this prompt explicitly changes it.
- Do not fabricate data, sources, citations, API responses, or test results.
- Prefer existing dependencies and conventions.
- Keep changes scoped to this prompt.
- Do not silently change architecture or specifications.
- Keep secrets outside source control.
- Use strict typing.
- Add tests appropriate to the change.
- If a test fails, determine whether it is pre-existing or caused by your changes.
- Do not proceed to the next implementation prompt automatically.

## Acceptance Criteria

- [ ] Implementation matches the relevant authoritative specifications.
- [ ] Changes are scoped to this prompt.
- [ ] Type safety is preserved.
- [ ] Relevant tests are added or updated.
- [ ] Existing relevant tests pass.
- [ ] No fabricated behavior or data was introduced.
- [ ] No secrets were committed.
- [ ] Documentation is updated where necessary.
- [ ] The completion report is produced.
- [ ] The agent stops after this prompt.

## Completion Report

Return exactly:

IMPLEMENTATION COMPLETE

Prompt:
22 — Final Audit

Repository inspected:
<yes/no>

Implemented:
- ...

Files changed:
- ...

Dependencies added:
- ...

Tests added/updated:
- ...

Commands executed:
- ...

Results:
- Typecheck: PASS/FAIL/NOT RUN
- Lint: PASS/FAIL/NOT RUN
- Unit Tests: PASS/FAIL/NOT RUN
- Contract Tests: PASS/FAIL/NOT RUN
- Golden Tests: PASS/FAIL/NOT RUN
- E2E Tests: PASS/FAIL/NOT RUN
- Harness: PASS/FAIL/NOT RUN

Acceptance Criteria:
- [x] ...
- [ ] ...

Known Issues:
- ...

Pre-existing Issues:
- ...

Next Recommended Prompt:
NONE

Do not execute the next prompt.
