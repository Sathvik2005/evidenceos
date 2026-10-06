# Demo (3–5 minutes)

Question: **“Does remote learning improve student outcomes?”**
Signature moment: **PARTIALLY SUPPORTED → NEW EVIDENCE → CONFLICTING**.

## Seeded mode (no keys needed)

The data can be **seeded** instead of produced by a live model run. The seed writes real records through the same operations and hard rules (sources and verbatim quotes from `demo/corpus.json`; the claims, relationships and reasons were authored and are labelled “Seed fixture (authored, not model output)” in the UI).

- Local: `npm run dev:api`, `npm run dev --workspace=@evidenceos/frontend`, then `npm run seed:advance` for the new-evidence moment. Data persists in `.data/`; delete it to reset.
- Hosted: `npm run db:migrate`, then `npm run seed` (needs `DATABASE_URL` and `DEMO_OWNER_ID`); set `DEMO_INVESTIGATION_ID` as printed and redeploy; later `npm run seed -- advance`.
- Be explicit with the audience that this mode replays a recorded research pass; live mode (below) runs the model.

## What is real (live mode)

- Claims, states, confidence, evidence, relationships, history and the transition are produced by the product's workflow and stored in PostgreSQL. Nothing is edited by hand and the UI computes no state.
- The documents are **recorded retrievals**: three real public sources whose passages were copied verbatim on 2026-10-06 and re-verified in a second fetch. `demo/corpus.json` holds them (this is an excerpt of each page, not the full page):
  1. Means, Toyama, Murphy, Bakia & Jones (2010), *Evaluation of Evidence-Based Practices in Online Learning* — online conditions “performed modestly better” (studies from 1996 to July 2008; pre-pandemic, online rather than emergency remote teaching). Available at the start.
  2. Kofoed, Gebhart, Gilmore & Moschitto (2024), *Zooming to Class Slows Student Learning*, Education Next — online instruction reduced final grades by 22% of a standard deviation. Revealed as **new evidence**.
  3. Halloran, Jack, Okun & Oster (2022), *Remote Schooling and Standardized Test Scores*, NBER Digest — remote schooling linked to larger test-score declines. Revealed as **new evidence**.
- The model (Anthropic) decomposes, picks quotes from the documents, assesses and audits live. Its wording varies run to run; the invariants (verbatim quotes, hard rules, history rules) do not. The exact claim split and whether a particular claim flips can vary, so rehearse and check the result.

## Setup (once, before the audience arrives)

0. For seeded mode skip to the script; `seed:advance` replaces `demo:advance`.
1. Deploy and smoke-test ([`DEPLOYMENT.md`](DEPLOYMENT.md)); `ANTHROPIC_API_KEY` and `DATABASE_URL` must be set where you run the scripts (`.env.local`), and `DEMO_OWNER_ID` set to any stable string.
2. `npm run demo:seed` — creates the investigation and runs the first pass. Confirm at least one claim is **Partially supported**. Copy the printed id into the deployment's `DEMO_INVESTIGATION_ID` (with `DEMO_OWNER_ID`) and redeploy so the demo is viewable by everyone, read-only.
3. Open the investigation page and the claim that is partially supported. Keep the tab open.

## Script

| Time | Say / show |
| --- | --- |
| 0:00 | The problem: AI gives one confident answer; evidence is messy and changes. Show the question. |
| 0:30 | The claims the question was broken into, each with a **state** and a separate **confidence**. |
| 1:15 | Open the partially supported claim: the quote is the centerpiece, with source, publisher, date and a link; the *Why*; the *Uncertainty* (the evidence is pre-pandemic and about online, not emergency remote, teaching). |
| 2:00 | “Now new research is found.” Run `npm run demo:advance` (about a minute). Say what it does: same workflow, same rules, two more real sources. |
| 3:00 | Refresh the claim: **Conflicting**. The *Contradictory evidence* section is prominent; the earlier evidence is still there. |
| 3:30 | **State history**: PARTIALLY SUPPORTED → CONFLICTING, the reason, and the triggering evidence quoted. Open the evidence graph: dashed, labelled contradiction edges; the text version below it. |
| 4:15 | Trust model: model interprets, retrieval supplies provenance, rules validate (a fabricated quote is rejected), the evaluator audits, history is append-only. “It doesn't tell you what to believe.” |

## Checklist

- [ ] `npm run harness` passes on the commit being demoed
- [ ] `/api/health` is `ok`; keys valid; provider quota available
- [ ] Demo investigation shows a Partially supported claim **before** `demo:advance`
- [ ] The projector browser is signed in to nothing; cookies cleared; light mode readable at the venue
- [ ] Second tab with a screenshot or recording of the final state (see recovery)
- [ ] Phone hotspot as a network fallback

## Recovery

| Situation | Action |
| --- | --- |
| `demo:advance` ends without a state change | Run it again once (model variance); a change is recorded only when new evidence alters the state. If it still does not change, show the evidence and contradiction as they are and explain the rule — do not edit data. |
| Provider outage / rate limit | The run ends *Review required* with the reason shown; say so. Show the pre-recorded final state from the rehearsal. |
| Demo investigation is already advanced | History is append-only and cannot be reset. Run `npm run demo:seed` again (new id, from the first phase), update `DEMO_INVESTIGATION_ID`, redeploy. |
| Site down | Roll back ([`DEPLOYMENT.md`](DEPLOYMENT.md)); fall back to the rehearsal recording. |

The signature transition is also covered by an automated rehearsal that uses the real corpus with a scripted model: `frontend/tests/e2e/demo-corpus.test.ts`.
