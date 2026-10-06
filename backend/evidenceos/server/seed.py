"""Seed data for the demo.

It is real persisted data written through the same operations and hard rules as live runs: the sources and quotes
come from demo/corpus.json (verified verbatim), and every state change goes through the change rules. What a seed
does NOT contain is model output: the claims, relationships and reasons below were written by the authors and are
labelled as such.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..agents.evidence_analyst import EvidenceAssessment
from ..contracts import ApiResult
from ..db import Database
from ..operations import (
    add_claim,
    add_evidence,
    add_source,
    create_investigation,
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
    build_ledger,
    validate_assessment_rules,
    validate_evidence_record,
    validate_state_change,
)
from .adapters.recorded import RecordedDocument

SEED_QUESTION = "Does remote learning improve student outcomes?"
SEED_NOTE = "Seed fixture (authored, not model output):"

CLAIMS = (
    "Remote learning improves academic outcomes compared with in-person instruction",
    "Remote learning improves student engagement",
)


@dataclass(frozen=True)
class SeedEvidence:
    phase: int
    claim: int
    url_includes: str
    relationship: str
    strength: str
    reasoning: str


EVIDENCE = (
    SeedEvidence(1, 1, "sri.com", "PARTIALLY_SUPPORTS", "MODERATE",
                 "A pre-pandemic meta-analysis of online conditions (1996-2008); it does not cover emergency remote teaching."),
    SeedEvidence(2, 1, "educationnext.org", "CONTRADICTS", "MODERATE",
                 "A randomized college experiment (2020 cohort): online instruction lowered final grades."),
    SeedEvidence(2, 1, "nber.org", "CONTRADICTS", "MODERATE",
                 "District-level data: more remote schooling was associated with larger test-score declines (association, not a randomized result)."),
)

ASSESSMENT = {
    1: ("PARTIALLY_SUPPORTED", "LOW",
        f"{SEED_NOTE} one older, pre-pandemic synthesis leans slightly toward online learning; its scope differs from the claim."),
    2: ("CONFLICTING", "MEDIUM",
        f"{SEED_NOTE} new evidence from a randomized experiment and from district test data contradicts the earlier, weaker support."),
}
NO_EVIDENCE = f"{SEED_NOTE} no retained evidence addresses this claim."


def _document_for(corpus: list[RecordedDocument], needle: str) -> RecordedDocument:
    for item in corpus:
        if needle in item.document.url:
            return item
    raise ValueError(f"Seed corpus has no document matching {needle}.")


def _unwrap(result: ApiResult[Any], what: str) -> Any:
    if not result.ok:
        assert result.error is not None
        raise RuntimeError(f"Seed failed at {what}: {result.error.message}")
    return result.data


async def _persist_evidence(
    db: Database, owner: str, investigation_id: str, claim_ids: list[str], phase: int, corpus: list[RecordedDocument]
) -> list[dict[str, str]]:
    ledger = build_ledger([{"url": d.document.url, "text": d.document.text} for d in corpus])
    saved: list[dict[str, str]] = []
    for item in (e for e in EVIDENCE if e.phase == phase):
        doc = _document_for(corpus, item.url_includes).document
        claim_id = claim_ids[item.claim - 1]
        # Same hard rules as live evidence: provenance present and the quote exists in the retrieved text.
        check = validate_evidence_record(
            EvidenceRecord(
                id=item.url_includes, claim_id=claim_id, source_url=doc.url, source_title=doc.title,
                source_type=doc.source_type, retrieved_at=doc.retrieved_at, excerpt=doc.text,
                relationship=item.relationship, strength=item.strength,
            ),
            claim_id,
            ledger,
        )
        if not check.passed:
            raise RuntimeError(f"Seed evidence rejected: {', '.join(check.rule_ids)}")
        url = normalize_url(doc.url) or doc.url
        source = _unwrap(
            await add_source(
                db, owner, investigation_id=investigation_id, source_type=doc.source_type, url=url, title=doc.title,
                publisher=doc.publisher or None, published_at=doc.published_at or None,
                idempotency_key=f"seed:src:{item.url_includes}",
            ),
            "source",
        )
        evidence = _unwrap(
            await add_evidence(
                db, owner, investigation_id=investigation_id, claim_id=claim_id, source_id=source["id"],
                relationship=item.relationship, strength=item.strength, excerpt=doc.text,
                reasoning=f"{SEED_NOTE} {item.reasoning}", idempotency_key=f"seed:ev:{item.url_includes}",
            ),
            "evidence",
        )
        saved.append({"id": evidence["id"], "claimId": claim_id, "relationship": evidence["relationship"]})
    return saved


async def seed_initial(db: Database, owner: str, corpus: list[RecordedDocument]) -> str:
    """Stage 1: claims, the first evidence, and first assessments (stored directly; not state changes)."""
    created = _unwrap(await create_investigation(db, owner, question=SEED_QUESTION, idempotency_key="seed-v1"), "investigation")
    claims = []
    for index, statement in enumerate(CLAIMS):
        claims.append(
            _unwrap(
                await add_claim(
                    db, owner, investigation_id=created["id"], ordinal=index + 1, statement=statement,
                    idempotency_key=f"seed:claim:{index + 1}",
                ),
                "claim",
            )
        )
    claim_ids = [c["id"] for c in claims]
    evidence = await _persist_evidence(db, owner, created["id"], claim_ids, 1, corpus)

    for index, claim in enumerate(claims):
        if claim["state"] is not None:
            continue  # already assessed: re-running the seed changes nothing
        own = [e for e in evidence if e["claimId"] == claim["id"]]
        state, confidence, reason = ASSESSMENT[1] if index == 0 else ("INSUFFICIENT", "LOW", NO_EVIDENCE)
        rules = validate_assessment_rules(
            EvidenceAssessment(
                claim_id=claim["id"], proposed_state=state, confidence=confidence, rationale=reason,
                evidence_ids=tuple(e["id"] for e in own), causal_status="NOT_APPLICABLE", scope_notes=(), uncertainties=(),
            ),
            [AssessableEvidence(e["id"], e["claimId"], e["relationship"], "MODERATE") for e in own],
        )
        if not rules.passed:
            raise RuntimeError(f"Seed assessment rejected: {', '.join(rules.rule_ids)}")
        _unwrap(
            await record_claim_assessment(
                db, owner, investigation_id=created["id"], claim_id=claim["id"], confidence=confidence,
                reason=reason, initial_state=state,
            ),
            "assessment",
        )
    _unwrap(await set_investigation_status(db, owner, created["id"], "READY"), "status")
    return str(created["id"])


async def seed_advance(db: Database, owner: str, investigation_id: str, corpus: list[RecordedDocument]) -> None:
    """Stage 2: new evidence arrives and the first claim changes state, recorded with its trigger."""
    claims = _unwrap(await list_claims(db, owner, investigation_id), "claims")
    first = next((c for c in claims if c["ordinal"] == 1), None)
    if first is None:
        raise RuntimeError("Seed investigation has no first claim; run the initial seed first.")
    prior = {e["id"] for e in _unwrap(await list_evidence(db, owner, investigation_id), "evidence")}

    added = await _persist_evidence(db, owner, investigation_id, [c["id"] for c in claims], 2, corpus)
    state, confidence, reason = ASSESSMENT[2]
    if first["state"] == state:
        return  # already advanced: no meaningful difference, no new history

    trigger = next(
        (e for e in added if e["claimId"] == first["id"] and e["relationship"] == "CONTRADICTS" and e["id"] not in prior), None
    )
    check = validate_state_change(
        StateChangeCheck(
            claim_id=first["id"], persisted_state=first["state"], previous_state=first["state"], new_state=state,
            triggering_evidence=TriggeringEvidence(trigger["id"], trigger["claimId"]) if trigger else None,
            trigger_is_new=bool(trigger),
        )
    )
    if not check.passed or not first["state"] or trigger is None:
        raise RuntimeError(f"Seed state change rejected: {', '.join(check.rule_ids)}")

    _unwrap(
        await record_state_change(
            db, owner, investigation_id=investigation_id, claim_id=first["id"], previous_state=first["state"],
            new_state=state, reason=reason, triggering_evidence_id=trigger["id"], idempotency_key=f"seed:change:{first['id']}",
        ),
        "state change",
    )
    _unwrap(
        await record_claim_assessment(
            db, owner, investigation_id=investigation_id, claim_id=first["id"], confidence=confidence, reason=reason
        ),
        "assessment",
    )
