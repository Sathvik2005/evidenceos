# Prompt 18 — E2E Integration

## Objective

Connect the complete product from browser to persisted backend state and AI workflow.

Verify:
question submission → investigation creation → claim decomposition → research → evidence → analysis → validation → evaluation → persistence → UI rendering → history/change detection.

Requirements:
1. Use real contracts.
2. Use controlled test fixtures for external research where necessary.
3. Avoid brittle timing assumptions.
4. Test partial failure and retry paths.
5. Verify provenance survives the complete journey.
6. Add a primary happy-path E2E test and critical failure-path tests.

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
18 — E2E Integration

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
19 — Testing & Failure Injection

Do not execute the next prompt.
