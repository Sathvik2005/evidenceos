# Prompt 11 — Complete Investigation Workflow

## Objective

Connect the complete investigation workflow.

Implement:
START → LOAD INVESTIGATION → DECOMPOSE → VALIDATE CLAIMS → PERSIST CLAIMS → RESEARCH → COLLECT EVIDENCE → VALIDATE EVIDENCE → ANALYZE → DETERMINISTIC VALIDATION → EVALUATE → PERSIST → COMPARE STATE → RECORD CHANGE → SUMMARY → UPDATE INVESTIGATION → END.

Requirements:
1. Parallelize research per claim where safe.
2. Preserve durable state.
3. Handle partial failures.
4. Bound retries.
5. Ensure idempotency.
6. Never mark a claim supported without valid evidence.
7. Never hide contradictions.
8. Persist provenance and history.

Add an end-to-end workflow test using a controlled fixture.

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
11 — Complete Investigation Workflow

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
12 — Harness & Golden Dataset

Do not execute the next prompt.
