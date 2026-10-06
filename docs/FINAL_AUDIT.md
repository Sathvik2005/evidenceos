# Final audit (Prompt 22)

Scope: the repository as committed, audited against `agents.md`, `system dessign.md`, the 22 implementation prompts and
the harness. **The other authoritative specifications are not in the repository** (`CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `AGENT_SPEC.md`, `WORKFLOW.md`, `EVALUATION.md`, `UI_SPEC.md`, `RULES.md`, `GOLDEN_SPECS.md`, `HARNESS.md`,
`BUILD_PLAN.md`, `DEMO.md`); they could not be audited against, so this is an audit against the material that is present.

Verdicts: **PASS** (verified here), **CONDITIONAL** (implemented and tested locally, but part of it could not be verified in this
environment), **FAIL**. Nothing below is marked PASS on the basis of intent.

## Evidence for this audit

- `npm run harness`: typecheck PASS, lint PASS, unit 56/56, contracts 28/28, golden 77/77, e2e 21/21, failure injection 10/10. (Final run at the end of this audit: PASS, exit 0.)
- `npm run build` PASS (client bundle ≈ 89 kB gzip). `npm audit --omit=dev`: 0 vulnerabilities.
- Client bundle searched for `ANTHROPIC`, `TAVILY`, `DATABASE_URL`, `MOMEN_ADMIN`, provider hostnames: 0 matches. Tracked files searched for JWT-shaped tokens: none; the only tracked env file is `.env.example` with empty secret values.
- Contrast ratios computed from the CSS tokens (WCAG): light and dark text/background pairs 5.9:1 to 14.9:1, all above the 4.5:1 AA threshold for text.

## Verification items

| # | Item | Verdict | Evidence and caveats |
| --- | --- | --- | --- |
| 1 | Architecture invariants | **PASS** (with one approved deviation) | Holds: UI → API → LangGraph → agents → deterministic validation → evaluator → PostgreSQL → UI; no agent swarm; state ownership centralized. **Deviation: Momen is not in the path** (introspection disabled, no export); PostgreSQL is accessed directly. The owner approved this on 2026-10-06 ([ADR-010](adr/ADR-010-postgresql-direct-backend.md)). |
| 2 | Data integrity | **PASS** | FKs `RESTRICT`; evidence tied to claim and source of the same investigation; enums/checks; triggers for stale previous state, direct state edits, append-only history (`data-model.test.ts`, G10, G17). Schema is provisional (no `DATA_MODEL.md`). |
| 3 | Provenance | **PASS** (logic) | Source fields come only from retrieval; quotes must be verbatim; unretrieved URL/quote rejected at the agent and again by the rules layer (G06–G08, failure-injection). Not exercised against live Tavily output. |
| 4 | Contradiction handling | **PASS** | Contradicting evidence must be cited, blocks SUPPORTED when material, persisted and shown prominently (G05, G12, UI tests, failure-injection "contradiction"). |
| 5 | Insufficient-evidence behavior | **PASS** | No evidence ⇒ INSUFFICIENT without a model call; unavailable research leaves the claim unassessed rather than concluding INSUFFICIENT (G03, G14, e2e). |
| 6 | Agent boundaries | **PASS** | Unauthorized fields rejected for all four agents; decomposer cannot cite or assign states; research cannot assign state; evaluator cannot add evidence and its decision is computed in code. |
| 7 | Deterministic validation | **PASS** | 24 rule ids with injection tests; hard rules override evaluator (G13). |
| 8 | Evaluator behavior | **PASS** | Rubric 0–2 × 5, accept ≥7 with grounding and justification ≥1 and no critical failure; hard-rule failure skips the model and rejects. |
| 9 | LangGraph durability | **CONDITIONAL / known gap** | Checkpointer is in memory (`MemorySaver`); a cut-off run is **not** resumed from a checkpoint. Mitigations that are tested: idempotent re-run reuses saved work with no duplicates; abandoned runs are taken over after 10 minutes. Model calls repeat on resume. |
| 10 | UI truthfulness | **PASS** | State comes only from persisted records; null state renders "Not yet assessed"; progress is the persisted status with no percentage; missing backend renders an explicit error; contradictions never hidden; sources link only for http(s). Not exercised in a real browser (jsdom only). |
| 11 | Accessibility | **CONDITIONAL** | Done and tested: landmarks, skip link, labelled form with `aria-invalid`/`aria-describedby`, focus-visible, reduced motion, state conveyed by text and glyph, graph keyboard-operable with a text version, AA contrast. **Not done:** screen-reader testing, an automated axe run, visual responsive checks in a real browser. |
| 12 | E2E workflow | **PASS** (fixtures) | Question → investigation → claims → research → evidence → analysis → validation → evaluation → persistence → UI → history, with controlled retrieval and a scripted model; includes failure and retry paths. Live providers not run. |
| 13 | Golden tests | **PASS** | 20 executable cases (derived from `agents.md` §34 + prompt injection) plus agent goldens; `GOLDEN_SPECS.md` absent, so their completeness against it is unknown. |
| 14 | Failure injection | **PASS** | 10/10: timeout, malformed output, missing excerpt, fabricated provenance, invalid reference, ignored contradiction, duplicate/concurrent run, partial research failure, persistence failure, credential failure. |
| 15 | Deployment | **CONDITIONAL** | `vercel.json`, function, migrations runner, env docs, health check, rollback/recovery written; production build passes. **Never deployed**; Anthropic/Tavily/`pg` adapters unverified against the real services. |
| 16 | Demo path | **CONDITIONAL** | Real, verified source corpus; rehearsal test of PARTIALLY_SUPPORTED → CONFLICTING passes with the real documents and a scripted model. The live-model run and the UI in a real browser were not performed. |

## Fixes made during the audit

- Harness could report PASS after a failed stage; fixed, and a 5-minute stage timeout added.
- Test runtime crashed intermittently (native crash of the forked pool with the WASM database); switched to worker threads.
- Investigation page replaced the claim list with "loading" on every status refresh; refreshes now keep the last good data.
- Data model aligned with the system design (statuses, strengths, evidence `reasoning`, first-state vs change-event semantics, new-evidence trigger).
- Stalled runs can be resumed (found while auditing item 9).

## Remaining known issues

1. **Momen not connected** (item 1). Accepted deviation, ADR-010; revisit if a Momen export becomes available.
2. **No durable workflow checkpoints** (item 9).
3. **Authoritative specifications missing**; schema enums and golden cases are derived. Re-audit when supplied.
4. **External integrations unverified** (Anthropic, Tavily, hosted PostgreSQL, Vercel); first deployment must run the smoke test.
5. **No accounts**: ownership is an anonymous cookie; no rate limiting on investigation creation (cost exposure per visitor). Add rate limits or authentication before public launch.
6. **Accessibility testing incomplete** (item 11).
7. **UI never rendered in a real browser** by this project's tests; do a visual pass (mobile and desktop, both themes) before the demo.
8. Search results are mapped to `WEB_PAGE`; `publisher` is null for live retrievals.
9. `*.test` suites boot an in-memory database per file; they run reliably with the threads pool but need a few minutes for the full harness.

## Acceptance (Prompt 22)

- [x] Audit performed against the material present, with PASS/CONDITIONAL per item
- [x] No new features introduced; only fixes needed for the audit items
- [x] Relevant harness layers rerun
- [ ] Audit against the missing specifications (not possible here)
- [ ] Deployment and demo verified in their real environments (not possible here)
