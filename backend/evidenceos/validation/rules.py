"""Deterministic validation layer. These are HARD rules: no LLM judgment can override a violation.

Every check returns structured violations instead of raising, and every rule has a stable id.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from ..contracts import CLAIM_STATES, EVIDENCE_RELATIONSHIPS, EVIDENCE_STRENGTHS, SOURCE_TYPES
from ..text import collapse, normalize_url

if TYPE_CHECKING:
    from ..agents.evidence_analyst import EvidenceAssessment


class RULES:
    """Stable rule ids (the string equals the attribute name)."""

    EVIDENCE_CLAIM_MISSING = "EVIDENCE_CLAIM_MISSING"
    EVIDENCE_CLAIM_MISMATCH = "EVIDENCE_CLAIM_MISMATCH"
    EVIDENCE_SOURCE_MISSING = "EVIDENCE_SOURCE_MISSING"
    EVIDENCE_EXCERPT_MISSING = "EVIDENCE_EXCERPT_MISSING"
    EVIDENCE_ENUM_INVALID = "EVIDENCE_ENUM_INVALID"
    PROVENANCE_MISSING = "PROVENANCE_MISSING"
    FABRICATED_SOURCE = "FABRICATED_SOURCE"
    FABRICATED_EXCERPT = "FABRICATED_EXCERPT"
    STATE_INVALID = "STATE_INVALID"
    SUPPORTED_WITHOUT_SUPPORT = "SUPPORTED_WITHOUT_SUPPORT"
    SUPPORTED_DESPITE_CONTRADICTION = "SUPPORTED_DESPITE_CONTRADICTION"
    PARTIAL_WITHOUT_SUPPORT = "PARTIAL_WITHOUT_SUPPORT"
    CONFLICT_WITHOUT_BOTH_SIDES = "CONFLICT_WITHOUT_BOTH_SIDES"
    CONTRADICTION_OMITTED = "CONTRADICTION_OMITTED"
    CITED_EVIDENCE_UNKNOWN = "CITED_EVIDENCE_UNKNOWN"
    CITED_EVIDENCE_FOREIGN_CLAIM = "CITED_EVIDENCE_FOREIGN_CLAIM"
    CONFIDENCE_UNSUPPORTED = "CONFIDENCE_UNSUPPORTED"
    CAUSATION_UNSUPPORTED = "CAUSATION_UNSUPPORTED"
    CHANGE_PREVIOUS_MISSING = "CHANGE_PREVIOUS_MISSING"
    CHANGE_NO_PREVIOUS_MATCH = "CHANGE_NO_PREVIOUS_MATCH"
    CHANGE_TRIGGER_NOT_NEW = "CHANGE_TRIGGER_NOT_NEW"
    CHANGE_NO_DIFFERENCE = "CHANGE_NO_DIFFERENCE"
    CHANGE_TRIGGER_MISSING = "CHANGE_TRIGGER_MISSING"
    CHANGE_TRIGGER_FOREIGN_CLAIM = "CHANGE_TRIGGER_FOREIGN_CLAIM"


@dataclass(frozen=True)
class Violation:
    rule: str
    message: str
    subject: str | None = None


@dataclass(frozen=True)
class RuleResult:
    passed: bool
    violations: tuple[Violation, ...] = ()

    @property
    def rule_ids(self) -> list[str]:
        return [v.rule for v in self.violations]


def _result(violations: list[Violation]) -> RuleResult:
    return RuleResult(passed=not violations, violations=tuple(violations))


# What the retrieval step actually returned for this run: the ground truth for provenance checks.
RetrievalLedger = Mapping[str, str]


def build_ledger(documents: Sequence[Mapping[str, Any]]) -> dict[str, str]:
    ledger: dict[str, str] = {}
    for doc in documents:
        url = normalize_url(doc["url"])
        if url:
            ledger[url] = collapse(doc["text"])
    return ledger


@dataclass(frozen=True)
class EvidenceRecord:
    id: str
    claim_id: str | None
    source_url: str | None
    source_title: str | None
    source_type: str | None
    retrieved_at: str | None
    excerpt: str | None
    relationship: str
    strength: str


def _valid_timestamp(value: str | None) -> bool:
    if not value:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def validate_evidence_record(evidence: EvidenceRecord, claim_id: str, ledger: RetrievalLedger | None = None) -> RuleResult:
    """Rules for one evidence record against its claim and, when given, the retrieval ledger."""
    v: list[Violation] = []
    subject = evidence.id
    if not evidence.claim_id:
        v.append(Violation(RULES.EVIDENCE_CLAIM_MISSING, "Evidence has no claim.", subject))
    elif evidence.claim_id != claim_id:
        v.append(Violation(RULES.EVIDENCE_CLAIM_MISMATCH, "Evidence belongs to a different claim.", subject))
    if not evidence.source_url or not normalize_url(evidence.source_url):
        v.append(Violation(RULES.EVIDENCE_SOURCE_MISSING, "Evidence has no valid source URL.", subject))
    if not evidence.excerpt or not collapse(evidence.excerpt):
        v.append(Violation(RULES.EVIDENCE_EXCERPT_MISSING, "Evidence has no excerpt.", subject))
    if evidence.relationship not in EVIDENCE_RELATIONSHIPS or evidence.strength not in EVIDENCE_STRENGTHS:
        v.append(Violation(RULES.EVIDENCE_ENUM_INVALID, "Relationship or strength is invalid.", subject))
    if (
        not (evidence.source_title or "").strip()
        or not _valid_timestamp(evidence.retrieved_at)
        or evidence.source_type not in SOURCE_TYPES
    ):
        v.append(Violation(RULES.PROVENANCE_MISSING, "Title, source type or retrieval time is missing.", subject))

    if ledger is not None and evidence.source_url:
        text = ledger.get(normalize_url(evidence.source_url) or "")
        if text is None:
            v.append(Violation(RULES.FABRICATED_SOURCE, "Source was not returned by retrieval.", subject))
        elif evidence.excerpt and collapse(evidence.excerpt) not in text:
            v.append(Violation(RULES.FABRICATED_EXCERPT, "Excerpt is not present in the retrieved source.", subject))
    return _result(v)


@dataclass(frozen=True)
class AssessableEvidence:
    id: str
    claim_id: str
    relationship: str
    strength: str


def validate_assessment_rules(
    assessment: EvidenceAssessment, evidence: Sequence[AssessableEvidence]
) -> RuleResult:
    """State/confidence semantics: the proposed state must be justified by the persisted evidence."""
    v: list[Violation] = []
    by_id = {e.id: e for e in evidence}
    claim_evidence = [e for e in evidence if e.claim_id == assessment.claim_id]

    if assessment.proposed_state not in CLAIM_STATES:
        v.append(Violation(RULES.STATE_INVALID, "State is not an allowed claim state."))
        return _result(v)

    for evidence_id in assessment.evidence_ids:
        item = by_id.get(evidence_id)
        if item is None:
            v.append(Violation(RULES.CITED_EVIDENCE_UNKNOWN, "Cited evidence does not exist.", evidence_id))
        elif item.claim_id != assessment.claim_id:
            v.append(Violation(RULES.CITED_EVIDENCE_FOREIGN_CLAIM, "Cited evidence belongs to another claim.", evidence_id))

    cited = set(assessment.evidence_ids)
    for item in claim_evidence:
        if item.relationship == "CONTRADICTS" and item.id not in cited:
            v.append(Violation(RULES.CONTRADICTION_OMITTED, "Contradicting evidence was not addressed.", item.id))

    def pick(relationships: tuple[str, ...], strengths: tuple[str, ...] | None = None) -> list[AssessableEvidence]:
        return [
            e for e in claim_evidence
            if e.relationship in relationships and (strengths is None or e.strength in strengths)
        ]

    supporting = pick(("SUPPORTS",))
    partial = pick(("SUPPORTS", "PARTIALLY_SUPPORTS"))
    contradicting = pick(("CONTRADICTS",))
    material_contradiction = pick(("CONTRADICTS",), ("STRONG", "MODERATE"))

    state = assessment.proposed_state
    if state == "SUPPORTED":
        if not supporting:
            v.append(Violation(RULES.SUPPORTED_WITHOUT_SUPPORT, "SUPPORTED requires supporting evidence."))
        if material_contradiction:
            v.append(Violation(RULES.SUPPORTED_DESPITE_CONTRADICTION, "SUPPORTED is not allowed with material contradicting evidence."))
    elif state == "PARTIALLY_SUPPORTED":
        if not partial:
            v.append(Violation(RULES.PARTIAL_WITHOUT_SUPPORT, "PARTIALLY_SUPPORTED requires supporting or partially supporting evidence."))
    elif state == "CONFLICTING":
        if not partial or not contradicting:
            v.append(Violation(RULES.CONFLICT_WITHOUT_BOTH_SIDES, "CONFLICTING requires both supporting and contradicting evidence."))
    # INSUFFICIENT is always permitted: insufficiency is the conservative result.

    if assessment.confidence == "HIGH" and state != "INSUFFICIENT":
        strong = [e for e in claim_evidence if e.strength == "STRONG" and e.relationship != "INSUFFICIENT"]
        moderate_support = pick(("SUPPORTS",), ("MODERATE",))
        if not strong and len(moderate_support) < 2:
            v.append(Violation(RULES.CONFIDENCE_UNSUPPORTED, "HIGH confidence needs a STRONG item or two MODERATE supporting items."))
    if assessment.causal_status == "CAUSATION" and not any(
        (by_id.get(i) is not None and by_id[i].strength == "STRONG") for i in assessment.evidence_ids
    ):
        v.append(Violation(RULES.CAUSATION_UNSUPPORTED, "Causal language requires at least one STRONG cited item."))
    return _result(v)


@dataclass(frozen=True)
class TriggeringEvidence:
    id: str
    claim_id: str


@dataclass(frozen=True)
class StateChangeCheck:
    claim_id: str
    persisted_state: str | None
    #: None means the claim has no persisted state yet, so no change event may exist.
    previous_state: str | None
    new_state: str
    triggering_evidence: TriggeringEvidence | None
    #: True when the trigger was not part of the evidence known before this run; None means unknown.
    trigger_is_new: bool | None = None


def validate_state_change(change: StateChangeCheck) -> RuleResult:
    """A change event needs a real previous state, a real difference and a real trigger for this claim."""
    v: list[Violation] = []
    if change.new_state not in CLAIM_STATES:
        v.append(Violation(RULES.STATE_INVALID, "New state is invalid."))
    if change.previous_state is None:
        v.append(Violation(RULES.CHANGE_PREVIOUS_MISSING, "A change needs a persisted previous state; a first assessment is not a change."))
    if change.previous_state != change.persisted_state:
        v.append(Violation(RULES.CHANGE_NO_PREVIOUS_MATCH, "Previous state does not match the persisted state."))
    if change.previous_state == change.new_state:
        v.append(Violation(RULES.CHANGE_NO_DIFFERENCE, "There is no meaningful state difference."))
    trigger = change.triggering_evidence
    if trigger is None:
        v.append(Violation(RULES.CHANGE_TRIGGER_MISSING, "A state change needs triggering evidence."))
    elif trigger.claim_id != change.claim_id:
        v.append(Violation(RULES.CHANGE_TRIGGER_FOREIGN_CLAIM, "Triggering evidence belongs to another claim.", trigger.id))
    elif change.trigger_is_new is False:
        v.append(Violation(RULES.CHANGE_TRIGGER_NOT_NEW, "A state change must be triggered by evidence new to this run.", trigger.id))
    return _result(v)


Decision = Literal["ACCEPT", "REJECT"]


def decide(hard: RuleResult, evaluator_accepts: bool) -> Decision:
    """Hard rules are final: an LLM/Evaluator "accept" can never override a violation."""
    return "ACCEPT" if hard.passed and evaluator_accepts else "REJECT"
