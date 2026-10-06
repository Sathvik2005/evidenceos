# Prompt 03 — Database & Data Model

## Objective

Implement the EvidenceOS persistence model from DATA_MODEL.md.

Entities:
investigations, claims, sources, evidence, evidence_changes.

Tasks:
1. Implement the schema using the supported Momen/PostgreSQL path.
2. Add enums and constraints for statuses, states, relationships, strengths, confidence, and source types.
3. Add foreign keys and indexes.
4. Preserve timestamps and referential integrity.
5. Prevent invalid evidence from referencing unrelated claims/sources.
6. Establish deterministic state-transition constraints where appropriate.
7. Add seed/demo data only if explicitly required for development verification.
8. Verify schema synchronization.

Test CRUD, relationships, invalid references, and representative queries.

Do not build agents or UI.

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
03 — Database & Data Model

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
04 — API & Backend Actions

Do not execute the next prompt.
