# AI safety

How EvidenceOS controls probabilistic model behavior. Everything here refers to controls present in the code; limits are stated plainly.

```text
Agent → structured output → schema validation → deterministic validation
      → evidence provenance → evaluator → persistence → human inspection
```

## Hallucination

The model never writes trusted state directly. Each agent returns JSON that must match a closed schema: unknown fields are rejected, enums are checked, and referenced ids must exist. Malformed output triggers a bounded retry with the validation errors fed back (at most two retries), then fails explicitly. Nothing is persisted after a failed validation.

## Fabricated sources

Agents may not invent URLs, titles, publishers, dates, excerpts, evidence ids or claim ids.

- The **search provider** supplies every provenance field. The Research Agent returns only a document index, a quote, a relationship and a strength.
- A quote must appear verbatim (whitespace-normalised) in the retrieved text, or it is rejected.
- The rules layer repeats the check against a ledger of what was actually retrieved (`FABRICATED_SOURCE`, `FABRICATED_EXCERPT`, `PROVENANCE_MISSING`), so a bug in one layer is not enough to let a fabrication through.
- The analyst may cite only the evidence ids it was given.

## Prompt injection

Retrieved text is data. See the [threat model](THREAT_MODEL.md#prompt-injection). The output contract is too narrow for injected text to change a state, a role or a field.

## Contradictions

Contradicting evidence is persisted as `CONTRADICTS` evidence and cannot be dropped. The analyst must cite every contradicting item (`CONTRADICTION_OMITTED`), `SUPPORTED` is rejected when material contradiction exists (`SUPPORTED_DESPITE_CONTRADICTION`), and the UI renders contradicting evidence prominently.

## Uncertainty

Allowed states are `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONFLICTING` and `INSUFFICIENT`. **`INSUFFICIENT` is a valid, often preferable result.** With no validated evidence the analyst returns `INSUFFICIENT` without calling a model. A claim whose research was *unavailable* is left unassessed (shown as "Not yet assessed") instead of being concluded `INSUFFICIENT`, because failing to find evidence is different from evidence being insufficient. The analyst also records scope notes and uncertainties.

## Correlation versus causation

The analyst declares `causalStatus` (`CAUSATION`, `CORRELATION`, `NOT_APPLICABLE`). The prompt forbids rewriting association as causation, and a deterministic rule rejects causal language without at least one cited `STRONG` item (`CAUSATION_UNSUPPORTED`). *Limit:* the rule checks strength, not study design; whether a strong item really establishes causality is left to the model and the human reader.

## Scope

Population, context, time and study type are carried as scope notes in the assessment so a narrow finding is not presented as universal. *Limit:* scope is described by the model and displayed; there is no deterministic check that the scope matches the claim. This is a known gap.

## State versus confidence

State says what the evidence supports; confidence (`HIGH`, `MEDIUM`, `LOW`) says how sure the assessment is. They are separate fields and are never merged. A deterministic rule limits `HIGH` confidence to cases with a `STRONG` item or two `MODERATE` supporting items (`CONFIDENCE_UNSUPPORTED`).

## Evaluator limitations

The Evaluator scores five dimensions 0–2 (evidence quality, grounding, contradiction handling, state justification, uncertainty handling). It is itself probabilistic. Its accept/reject decision is **computed in code** from the scores and the hard-rule result: any hard-rule failure rejects without consulting the model, and a model opinion alone can never accept. Acceptance requires a total of at least 7, grounding ≥ 1, state justification ≥ 1 and no critical failure. The evaluator does no research and cannot add or alter evidence.

## State changes and history

A claim's state can change only through an `evidence_changes` record whose previous state matches the stored state, whose new state differs, and whose triggering evidence belongs to the claim and is new in the run. The database enforces this with triggers, and history is append-only.

## Human oversight

The system presents evidence, relationships, states, confidence, uncertainty, sources and history. It does not claim to establish truth. A run with any unresolved claim ends `REVIEW_REQUIRED`, and a person interprets the result.

## Known limits

- The model can mislabel a real passage (for example `SUPPORTS` instead of `PARTIALLY_SUPPORTS`). Hard rules catch inconsistency between label and state, not every misreading.
- Evidence strength is a model-assigned label, not independent verification.
- Golden and failure-injection tests use scripted models and recorded sources; behavior with live providers has not been measured here.
- Search results are typed `WEB_PAGE`, and publisher is null for live retrievals.

## Principles

```text
AI may interpret.
AI may not fabricate.
AI may propose.
Deterministic rules validate.
Evidence remains inspectable.
Humans retain interpretation.
```
