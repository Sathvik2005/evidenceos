# EvidenceOS — Final Submission Checklist

## Product
- [ ] Name and tagline are consistent.
- [ ] Problem is clear.
- [ ] Product boundary is clear.
- [ ] Canonical question works.
- [ ] Core evidence workflow works.

## Demo
- [ ] 3–5 minute demo rehearsed.
- [ ] Landing page ready.
- [ ] Investigation ready.
- [ ] Claims visible.
- [ ] Evidence visible.
- [ ] Sources traceable.
- [ ] Contradiction visible.
- [ ] Graph works.
- [ ] New evidence workflow works.
- [ ] State transition works.
- [ ] History works.
- [ ] Reset works.

## Signature Moment
- [ ] `PARTIALLY_SUPPORTED` exists.
- [ ] New evidence is introduced.
- [ ] New evidence is persisted.
- [ ] Evidence is validated.
- [ ] Claim is re-evaluated.
- [ ] State becomes `CONFLICTING`.
- [ ] Change record is persisted.
- [ ] Triggering evidence is visible.
- [ ] History is visible.

## Engineering
- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Unit tests pass.
- [ ] Contract tests pass.
- [ ] Golden tests pass.
- [ ] Failure injection passes.
- [ ] E2E tests pass.
- [ ] Harness passes.
- [ ] Production build passes.

## Evidence Integrity
- [ ] No fabricated sources.
- [ ] No fabricated evidence.
- [ ] Provenance required.
- [ ] Cross-claim evidence rejected.
- [ ] Contradictions preserved.
- [ ] Insufficient evidence supported.
- [ ] State and confidence remain separate.
- [ ] History is immutable.
- [ ] Change triggers are traceable.

## Security
- [ ] No secrets committed.
- [ ] No secrets in frontend bundle.
- [ ] Authentication tested.
- [ ] Authorization tested.
- [ ] Cross-user access tested.
- [ ] Prompt injection tested.
- [ ] Sensitive logs reviewed.
- [ ] Environments separated.

## Deployment
- [ ] Production environment exists.
- [ ] Health check works.
- [ ] Environment variables documented.
- [ ] Migration process documented.
- [ ] Smoke test works.
- [ ] Rollback documented.
- [ ] Demo environment can be reset.

## Documentation
- [ ] README complete.
- [ ] Architecture documented.
- [ ] Data model documented.
- [ ] Agent responsibilities documented.
- [ ] Workflow documented.
- [ ] Evaluation documented.
- [ ] Harness documented.
- [ ] Deployment documented.
- [ ] Demo script complete.
- [ ] Demo checklist complete.

## Portfolio
- [ ] Case study written.
- [ ] One-page technical brief written.
- [ ] Architecture screenshot prepared.
- [ ] Product screenshots prepared.
- [ ] Demo video prepared if required.
- [ ] Repository is clean.
- [ ] Repository description is clear.

## Judge Preparation
Be able to answer:
- [ ] Why isn't this RAG?
- [ ] Why LangGraph?
- [ ] Why multiple agents?
- [ ] How is hallucination controlled?
- [ ] How is provenance handled?
- [ ] How are contradictions handled?
- [ ] How does state change?
- [ ] How is AI evaluated?
- [ ] What happens when an agent fails?
- [ ] What would you improve next?

## Final Release Gate

```text
PRODUCT        PASS / FAIL
DEMO           PASS / FAIL
EVIDENCE       PASS / FAIL
TESTING        PASS / FAIL
SECURITY       PASS / FAIL
DEPLOYMENT     PASS / FAIL
DOCUMENTATION  PASS / FAIL
PORTFOLIO      PASS / FAIL
```

Final decision:

```text
READY / NOT READY
```
