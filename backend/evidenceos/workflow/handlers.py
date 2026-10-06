"""Real node handlers for the investigation workflow.

Each node does one job, persists through the typed operations, and records explicit failures instead of hiding them.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, TypeVar

from ..agents.claim_decomposer import claim_problems, decompose_claims
from ..agents.evaluator import evaluate_assessment
from ..agents.evidence_analyst import AnalystEvidence, analyze_evidence
from ..agents.llm import LlmClient
from ..agents.research_agent import SearchProvider, research_claim
from ..contracts import ApiResult
from ..db import Database
from ..operations import (
    add_claim,
    add_evidence,
    add_source,
    get_investigation,
    list_claims,
    list_evidence,
    record_claim_assessment,
    record_state_change,
    set_investigation_status,
)
from ..text import normalize_url
from ..validation.rules import (
    AssessableEvidence,
    EvidenceRecord,
    StateChangeCheck,
    TriggeringEvidence,
    validate_assessment_rules,
    validate_evidence_record,
    validate_state_change,
)
from .types import (
    DEFAULT_MAX_RETRIES,
    ClaimOutcome,
    NodeHandlers,
    PersistedEvidence,
    WorkflowClaim,
    WorkflowError,
    WorkflowFailure,
)

T = TypeVar("T")
FATAL = frozenset({"AUTHENTICATION", "AUTHORIZATION"})
MAX_PAGE = 100


@dataclass(frozen=True)
class WorkflowDeps:
    db: Database
    llm: LlmClient
    search: SearchProvider
    max_retries: int = DEFAULT_MAX_RETRIES


def fnv1a(text: str) -> str:
    """Stable 32-bit FNV-1a over UTF-16 code units, used only to build deterministic idempotency keys."""
    value = 0x811C9DC5
    data = text.encode("utf-16-le", errors="surrogatepass")
    for i in range(0, len(data), 2):
        value ^= data[i] | (data[i + 1] << 8)
        value = (value * 0x01000193) & 0xFFFFFFFF
    return f"{value:08x}"


def unwrap(result: ApiResult[T]) -> T:
    if result.ok:
        return result.data  # type: ignore[return-value]
    assert result.error is not None
    code = result.error.code
    if code in ("VALIDATION_FAILED", "REFERENCE_INVALID", "CONSTRAINT_VIOLATION"):
        kind = "VALIDATION"
    elif code == "NOT_FOUND":
        kind = "AUTHORIZATION"
    else:
        kind = "PERSISTENCE"
    raise WorkflowError(kind, result.error.message)


def _failure(node: str, kind: str, message: str, claim_id: str | None = None) -> WorkflowFailure:
    return WorkflowFailure(node=node, kind=kind, message=message, claim_id=claim_id)


def _kind_of(error: BaseException) -> str:
    return error.kind if isinstance(error, WorkflowError) else "WORKFLOW"


async def for_each_claim(
    node: str, claims: list[WorkflowClaim], task: Callable[[WorkflowClaim], Awaitable[T]]
) -> tuple[list[tuple[str, T]], list[WorkflowFailure]]:
    """Runs one task per claim in parallel; a non-fatal failure on one claim never discards the others."""

    async def one(claim: WorkflowClaim) -> tuple[WorkflowClaim, T | None, Exception | None]:
        try:
            return claim, await task(claim), None
        except Exception as error:
            if _kind_of(error) in FATAL:
                raise
            return claim, None, error

    settled = await asyncio.gather(*(one(c) for c in claims))
    results: list[tuple[str, T]] = []
    failures: list[WorkflowFailure] = []
    for claim, value, error in settled:
        if error is not None:
            message = error.message if isinstance(error, WorkflowError) else "Unexpected failure."
            failures.append(_failure(node, _kind_of(error), message, claim.id))
        else:
            results.append((claim.id, value))  # type: ignore[arg-type]
    return results, failures


def _research_unavailable(state: Mapping[str, Any], claim_id: str) -> bool:
    return any(
        f.node == "research" and f.claim_id == claim_id and f.message.startswith("Research unavailable")
        for f in state["failures"]
    )


def _assessable(items: list[PersistedEvidence]) -> list[AssessableEvidence]:
    return [AssessableEvidence(p.evidence.id, p.claim_id, p.evidence.relationship, p.evidence.strength) for p in items]


def create_workflow_handlers(deps: WorkflowDeps) -> NodeHandlers:
    db, llm, search, retries = deps.db, deps.llm, deps.search, deps.max_retries

    async def load(state: Mapping[str, Any]) -> dict[str, Any]:
        owner, inv = state["owner_id"], state["investigation_id"]
        investigation = unwrap(await get_investigation(db, owner, inv))
        claims = unwrap(await list_claims(db, owner, inv, MAX_PAGE))
        prior = unwrap(await list_evidence(db, owner, inv, MAX_PAGE))
        return {
            "prior_evidence_ids": [e["id"] for e in prior],
            "question": investigation["question"],
            "claims": [WorkflowClaim(c["id"], c["ordinal"], c["statement"], c["state"]) for c in claims],
        }

    async def decompose(state: Mapping[str, Any]) -> dict[str, Any]:
        # Idempotent: claims that already exist are reused, never re-generated.
        if state["claims"]:
            return {}
        result = await decompose_claims(
            llm, investigation_id=state["investigation_id"], question=state["question"], max_retries=retries
        )
        return {"claims": [WorkflowClaim("", c.ordinal, c.statement, None) for c in result.claims]}

    async def validate_claims(state: Mapping[str, Any]) -> dict[str, Any]:
        claims: list[WorkflowClaim] = state["claims"]
        if not claims:
            raise WorkflowError("VALIDATION", "No claims were produced.")
        ordinals: set[int] = set()
        for claim in claims:
            if claim.ordinal in ordinals:
                raise WorkflowError("VALIDATION", "Duplicate claim ordinal.")
            ordinals.add(claim.ordinal)
            if claim.id == "":
                problems = claim_problems(claim.statement)
                if problems:
                    raise WorkflowError("VALIDATION", f"Claim {claim.ordinal} is invalid: {'; '.join(problems)}")
        return {}

    async def persist_claims(state: Mapping[str, Any]) -> dict[str, Any]:
        claims: list[WorkflowClaim] = []
        for claim in state["claims"]:
            if claim.id != "":
                claims.append(claim)
                continue
            saved = unwrap(
                await add_claim(
                    db, state["owner_id"], investigation_id=state["investigation_id"], ordinal=claim.ordinal,
                    statement=claim.statement, idempotency_key=f"claim:{claim.ordinal}",
                )
            )
            claims.append(WorkflowClaim(saved["id"], saved["ordinal"], saved["statement"], saved["state"]))
        return {"claims": claims}

    async def research(state: Mapping[str, Any]) -> dict[str, Any]:
        unwrap(await set_investigation_status(db, state["owner_id"], state["investigation_id"], "RESEARCHING"))
        by_id = {c.id: c for c in state["claims"]}

        async def task(claim: WorkflowClaim) -> Any:
            return await research_claim(llm, search, claim_id=claim.id, statement=by_id[claim.id].statement, max_retries=retries)

        results, failures = await for_each_claim("research", state["claims"], task)
        extra: list[WorkflowFailure] = []
        ledger: dict[str, str] = {}
        for claim_id, result in results:
            for url, text in result.retrieved:
                ledger[url] = text
            if result.status == "UNAVAILABLE":
                extra.append(_failure("research", "NETWORK", "Research unavailable: sources could not be retrieved.", claim_id))
            elif result.status == "PARTIAL":
                extra.append(_failure("research", "NETWORK", "Research partial: some sources were unavailable.", claim_id))
        return {
            "evidence_by_claim": {cid: list(r.candidates) for cid, r in results},
            "ledger": ledger,
            "failures": [*failures, *extra],
        }

    async def validate_evidence(state: Mapping[str, Any]) -> dict[str, Any]:
        ledger: dict[str, str] = dict(state["ledger"])
        failures: list[WorkflowFailure] = []
        persisted: dict[str, list[PersistedEvidence]] = {}

        for claim in state["claims"]:
            kept: list[PersistedEvidence] = []
            for index, candidate in enumerate(state["evidence_by_claim"].get(claim.id, [])):
                check = validate_evidence_record(
                    EvidenceRecord(
                        id=f"{claim.id}#{index}", claim_id=claim.id, source_url=candidate.source_url,
                        source_title=candidate.source_title, source_type=candidate.source_type,
                        retrieved_at=candidate.retrieved_at, excerpt=candidate.excerpt,
                        relationship=candidate.relationship, strength=candidate.strength,
                    ),
                    claim.id,
                    ledger,
                )
                if not check.passed:
                    failures.append(
                        _failure("validateEvidence", "VALIDATION", f"Evidence rejected: {', '.join(check.rule_ids)}", claim.id)
                    )
                    continue
                try:
                    url = normalize_url(candidate.source_url) or candidate.source_url
                    source = unwrap(
                        await add_source(
                            db, state["owner_id"], investigation_id=state["investigation_id"],
                            source_type=candidate.source_type, url=url, title=candidate.source_title,
                            publisher=candidate.publisher or None, published_at=candidate.published_at or None,
                            idempotency_key=f"src:{fnv1a(url)}",
                        )
                    )
                    evidence = unwrap(
                        await add_evidence(
                            db, state["owner_id"], investigation_id=state["investigation_id"], claim_id=claim.id,
                            source_id=source["id"], relationship=candidate.relationship, strength=candidate.strength,
                            excerpt=candidate.excerpt, reasoning=candidate.reasoning or None,
                            idempotency_key=f"ev:{claim.id}:{fnv1a(f'{url}|{candidate.excerpt}')}",
                        )
                    )
                    kept.append(
                        PersistedEvidence(
                            AnalystEvidence(
                                id=evidence["id"], source_title=source["title"], source_url=source["url"],
                                published_at=source["publishedAt"], excerpt=evidence["excerpt"],
                                relationship=evidence["relationship"], strength=evidence["strength"],
                            ),
                            claim.id,
                        )
                    )
                except Exception as error:
                    if _kind_of(error) in FATAL:
                        raise
                    message = error.message if isinstance(error, WorkflowError) else "Evidence could not be persisted."
                    failures.append(_failure("validateEvidence", _kind_of(error), message, claim.id))
            persisted[claim.id] = kept
        return {"persisted_evidence": persisted, "failures": failures}

    async def analyze(state: Mapping[str, Any]) -> dict[str, Any]:
        unwrap(await set_investigation_status(db, state["owner_id"], state["investigation_id"], "ANALYZING"))
        claims = [c for c in state["claims"] if not _research_unavailable(state, c.id)]
        by_id = {c.id: c for c in state["claims"]}

        async def task(claim: WorkflowClaim) -> Any:
            evidence = [p.evidence for p in state["persisted_evidence"].get(claim.id, [])]
            return await analyze_evidence(
                llm, claim_id=claim.id, statement=by_id[claim.id].statement, evidence=evidence, max_retries=retries
            )

        results, failures = await for_each_claim("analyze", claims, task)
        return {"assessments": dict(results), "failures": failures}

    async def validate_assessment(state: Mapping[str, Any]) -> dict[str, Any]:
        failures: list[WorkflowFailure] = []
        for claim_id, assessment in state["assessments"].items():
            check = validate_assessment_rules(assessment, _assessable(state["persisted_evidence"].get(claim_id, [])))
            if not check.passed:
                failures.append(
                    _failure("validateAssessment", "VALIDATION", f"Assessment violates: {', '.join(check.rule_ids)}", claim_id)
                )
        return {"failures": failures}

    async def evaluate(state: Mapping[str, Any]) -> dict[str, Any]:
        claims = [c for c in state["claims"] if c.id in state["assessments"]]
        by_id = {c.id: c for c in state["claims"]}

        async def task(claim: WorkflowClaim) -> Any:
            assessment = state["assessments"].get(claim.id)
            if assessment is None:
                raise WorkflowError("WORKFLOW", "Missing assessment.")
            return await evaluate_assessment(
                llm, claim_id=claim.id, statement=by_id[claim.id].statement,
                evidence=state["persisted_evidence"].get(claim.id, []), assessment=assessment, max_retries=retries,
            )

        results, failures = await for_each_claim("evaluate", claims, task)
        return {"evaluations": dict(results), "failures": failures}

    async def decide(state: Mapping[str, Any]) -> dict[str, Any]:
        outcomes: dict[str, ClaimOutcome] = {}
        failures: list[WorkflowFailure] = []
        for claim_id, evaluation in state["evaluations"].items():
            assessment = state["assessments"].get(claim_id)
            if evaluation.decision == "ACCEPT" and assessment is not None:
                outcomes[claim_id] = ClaimOutcome(claim_id, assessment.proposed_state, assessment.confidence)
            elif evaluation.hard_rules.passed:
                failures.append(_failure("decide", "VALIDATION", "Assessment was not accepted by the evaluation audit.", claim_id))
        return {"outcomes": outcomes, "failures": failures}

    async def persist_state(state: Mapping[str, Any]) -> dict[str, Any]:
        # A claim's FIRST assessment is stored directly (it is not a "change"); later changes are
        # recorded by detect_change against the persisted previous state.
        failures: list[WorkflowFailure] = []
        claims = {c.id: c for c in state["claims"]}
        for outcome in state["outcomes"].values():
            assessment = state["assessments"].get(outcome.claim_id)
            claim = claims.get(outcome.claim_id)
            if assessment is None or claim is None or claim.state is not None:
                continue
            try:
                unwrap(
                    await record_claim_assessment(
                        db, state["owner_id"], investigation_id=state["investigation_id"], claim_id=claim.id,
                        confidence=outcome.confidence, reason=assessment.rationale, initial_state=outcome.state,
                    )
                )
            except Exception as error:
                if _kind_of(error) in FATAL:
                    raise
                failures.append(_failure("persistState", _kind_of(error), "Assessment could not be persisted.", claim.id))
        return {"failures": failures}

    async def detect_change(state: Mapping[str, Any]) -> dict[str, Any]:
        failures: list[WorkflowFailure] = []
        prior = set(state["prior_evidence_ids"])
        claims = {c.id: c for c in state["claims"]}
        owner, inv = state["owner_id"], state["investigation_id"]
        for outcome in state["outcomes"].values():
            claim = claims.get(outcome.claim_id)
            assessment = state["assessments"].get(outcome.claim_id)
            if claim is None or assessment is None or claim.state is None:
                continue  # first assessments are not changes
            try:
                if claim.state == outcome.state:
                    # No meaningful difference: no history event, but the current confidence/reason are refreshed.
                    unwrap(
                        await record_claim_assessment(
                            db, owner, investigation_id=inv, claim_id=claim.id,
                            confidence=outcome.confidence, reason=assessment.rationale,
                        )
                    )
                    continue

                # The trigger must be evidence that is NEW in this run; prefer the kind that explains the change.
                cited = [p for p in state["persisted_evidence"].get(claim.id, []) if p.evidence.id in assessment.evidence_ids]
                fresh = [p for p in cited if p.evidence.id not in prior]
                wanted = (
                    "CONTRADICTS" if outcome.state == "CONFLICTING"
                    else "INSUFFICIENT" if outcome.state == "INSUFFICIENT"
                    else "SUPPORTS"
                )
                trigger = next((p for p in fresh if p.evidence.relationship == wanted), None)
                trigger = trigger or (fresh[0] if fresh else (cited[0] if cited else None))
                check = validate_state_change(
                    StateChangeCheck(
                        claim_id=claim.id, persisted_state=claim.state, previous_state=claim.state,
                        new_state=outcome.state,
                        triggering_evidence=TriggeringEvidence(trigger.evidence.id, trigger.claim_id) if trigger else None,
                        trigger_is_new=(trigger.evidence.id not in prior) if trigger else False,
                    )
                )
                if not check.passed:
                    failures.append(
                        _failure("detectChange", "VALIDATION", f"State change not recorded: {', '.join(check.rule_ids)}", claim.id)
                    )
                    continue
                assert trigger is not None
                unwrap(
                    await record_state_change(
                        db, owner, investigation_id=inv, claim_id=claim.id, previous_state=claim.state,
                        new_state=outcome.state, reason=assessment.rationale, triggering_evidence_id=trigger.evidence.id,
                        idempotency_key=f"chg:{claim.id}:{claim.state}>{outcome.state}:{trigger.evidence.id}",
                    )
                )
                unwrap(
                    await record_claim_assessment(
                        db, owner, investigation_id=inv, claim_id=claim.id,
                        confidence=outcome.confidence, reason=assessment.rationale,
                    )
                )
            except Exception as error:
                if _kind_of(error) in FATAL:
                    raise
                failures.append(_failure("detectChange", _kind_of(error), "State change could not be persisted.", claim.id))
        return {"failures": failures}

    async def summarize(state: Mapping[str, Any]) -> dict[str, Any]:
        recorded = list(state["outcomes"].values())
        counts: dict[str, int] = {}
        for outcome in recorded:
            counts[outcome.state] = counts.get(outcome.state, 0) + 1
        unresolved = len(state["claims"]) - len(recorded)
        parts = [f"{n} {name}" for name, n in counts.items()]
        tail = f"; {unresolved} unresolved" if unresolved > 0 else ""
        summary = f"{len(state['claims'])} claims: {', '.join(parts) or 'none assessed'}{tail}."
        complete = unresolved == 0 and not state["failures"]
        unwrap(
            await set_investigation_status(db, state["owner_id"], state["investigation_id"], "READY" if complete else "REVIEW_REQUIRED")
        )
        return {"summary": summary}

    return {
        "load": load,
        "decompose": decompose,
        "validateClaims": validate_claims,
        "persistClaims": persist_claims,
        "research": research,
        "validateEvidence": validate_evidence,
        "analyze": analyze,
        "validateAssessment": validate_assessment,
        "evaluate": evaluate,
        "decide": decide,
        "persistState": persist_state,
        "detectChange": detect_change,
        "summarize": summarize,
    }
