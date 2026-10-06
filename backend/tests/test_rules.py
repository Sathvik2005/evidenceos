"""Failure-injection tests for the deterministic hard rules (port of the TypeScript validation-rules suite)."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from evidenceos.agents.evidence_analyst import EvidenceAssessment
from evidenceos.validation.rules import (
    RULES,
    AssessableEvidence,
    EvidenceRecord,
    RuleResult,
    StateChangeCheck,
    TriggeringEvidence,
    build_ledger,
    decide,
    validate_assessment_rules,
    validate_evidence_record,
    validate_state_change,
)

GOOD = EvidenceRecord(
    id="e1", claim_id="c1", source_url="https://example.org/a", source_title="A study", source_type="JOURNAL_ARTICLE",
    retrieved_at="2026-01-01T00:00:00.000Z", excerpt="scores fell by four points.", relationship="SUPPORTS", strength="MODERATE",
)
LEDGER = build_ledger([{"url": "https://example.org/a", "text": "Overall, scores fell   by four points. Next topic."}])

pytestmark = pytest.mark.hard


class TestEvidenceRecordRules:
    def test_passes_a_well_formed_retrieved_record(self) -> None:
        assert validate_evidence_record(GOOD, "c1", LEDGER).passed

    @pytest.mark.parametrize(
        ("label", "patch", "rule"),
        [
            ("missing claim", {"claim_id": None}, RULES.EVIDENCE_CLAIM_MISSING),
            ("other claim", {"claim_id": "c2"}, RULES.EVIDENCE_CLAIM_MISMATCH),
            ("no source url", {"source_url": None}, RULES.EVIDENCE_SOURCE_MISSING),
            ("bad source url", {"source_url": "not a url"}, RULES.EVIDENCE_SOURCE_MISSING),
            ("empty excerpt", {"excerpt": "  "}, RULES.EVIDENCE_EXCERPT_MISSING),
            ("bad relationship", {"relationship": "PROVES"}, RULES.EVIDENCE_ENUM_INVALID),
            ("bad strength", {"strength": "HUGE"}, RULES.EVIDENCE_ENUM_INVALID),
            ("no title", {"source_title": ""}, RULES.PROVENANCE_MISSING),
            ("no retrieval time", {"retrieved_at": None}, RULES.PROVENANCE_MISSING),
            ("fabricated source", {"source_url": "https://made-up.example/x"}, RULES.FABRICATED_SOURCE),
            ("fabricated excerpt", {"excerpt": "Scores rose by forty points."}, RULES.FABRICATED_EXCERPT),
        ],
    )
    def test_rejects(self, label: str, patch: dict[str, Any], rule: str) -> None:
        assert rule in validate_evidence_record(replace(GOOD, **patch), "c1", LEDGER).rule_ids


def ev(id: str, relationship: str, strength: str = "MODERATE", claim_id: str = "c1") -> AssessableEvidence:
    return AssessableEvidence(id, claim_id, relationship, strength)


def assessment(**patch: Any) -> EvidenceAssessment:
    base = EvidenceAssessment(
        claim_id="c1", proposed_state="SUPPORTED", confidence="MEDIUM", rationale="r", evidence_ids=("e1",),
        causal_status="CORRELATION", scope_notes=(), uncertainties=(),
    )
    return replace(base, **patch)


class TestAssessmentRules:
    def test_accepts_justified_states(self) -> None:
        assert validate_assessment_rules(assessment(), [ev("e1", "SUPPORTS")]).passed
        both = assessment(proposed_state="CONFLICTING", evidence_ids=("e1", "e2"))
        assert validate_assessment_rules(both, [ev("e1", "SUPPORTS"), ev("e2", "CONTRADICTS")]).passed
        assert validate_assessment_rules(assessment(proposed_state="INSUFFICIENT", evidence_ids=()), []).passed

    def test_insufficient_stays_allowed_even_with_supporting_evidence(self) -> None:
        assert validate_assessment_rules(assessment(proposed_state="INSUFFICIENT"), [ev("e1", "SUPPORTS", "STRONG")]).passed

    @pytest.mark.parametrize(
        ("label", "subject", "evidence", "rule"),
        [
            ("SUPPORTED with no evidence", assessment(evidence_ids=()), [], RULES.SUPPORTED_WITHOUT_SUPPORT),
            ("SUPPORTED with only partial support", assessment(), [ev("e1", "PARTIALLY_SUPPORTS")], RULES.SUPPORTED_WITHOUT_SUPPORT),
            ("SUPPORTED despite a material contradiction", assessment(evidence_ids=("e1", "e2")),
             [ev("e1", "SUPPORTS"), ev("e2", "CONTRADICTS", "STRONG")], RULES.SUPPORTED_DESPITE_CONTRADICTION),
            ("PARTIALLY_SUPPORTED with no support", assessment(proposed_state="PARTIALLY_SUPPORTED"),
             [ev("e1", "CONTRADICTS")], RULES.PARTIAL_WITHOUT_SUPPORT),
            ("CONFLICTING with one side only", assessment(proposed_state="CONFLICTING"), [ev("e1", "SUPPORTS")],
             RULES.CONFLICT_WITHOUT_BOTH_SIDES),
            ("omitted contradiction", assessment(proposed_state="PARTIALLY_SUPPORTED"),
             [ev("e1", "SUPPORTS"), ev("e2", "CONTRADICTS", "WEAK")], RULES.CONTRADICTION_OMITTED),
            ("unknown cited evidence", assessment(evidence_ids=("e1", "ghost")), [ev("e1", "SUPPORTS")],
             RULES.CITED_EVIDENCE_UNKNOWN),
            ("evidence from another claim", assessment(evidence_ids=("e1", "x1")),
             [ev("e1", "SUPPORTS"), ev("x1", "SUPPORTS", "STRONG", "c2")], RULES.CITED_EVIDENCE_FOREIGN_CLAIM),
            ("HIGH confidence on weak evidence", assessment(confidence="HIGH"), [ev("e1", "SUPPORTS", "WEAK")],
             RULES.CONFIDENCE_UNSUPPORTED),
            ("causation without strong evidence", assessment(causal_status="CAUSATION"),
             [ev("e1", "SUPPORTS", "MODERATE")], RULES.CAUSATION_UNSUPPORTED),
            ("invalid state", assessment(proposed_state="TRUE"), [ev("e1", "SUPPORTS")], RULES.STATE_INVALID),
        ],
    )
    def test_rejects(self, label: str, subject: EvidenceAssessment, evidence: list[AssessableEvidence], rule: str) -> None:
        assert rule in validate_assessment_rules(subject, evidence).rule_ids


class TestStateChangeRules:
    BASE = StateChangeCheck(
        claim_id="c1", persisted_state="PARTIALLY_SUPPORTED", previous_state="PARTIALLY_SUPPORTED",
        new_state="CONFLICTING", triggering_evidence=TriggeringEvidence("e9", "c1"),
    )

    def test_accepts_a_real_evidence_backed_transition(self) -> None:
        assert validate_state_change(self.BASE).passed

    @pytest.mark.parametrize(
        ("label", "patch", "rule"),
        [
            ("stale previous state", {"persisted_state": "SUPPORTED"}, RULES.CHANGE_NO_PREVIOUS_MATCH),
            ("no difference", {"new_state": "PARTIALLY_SUPPORTED"}, RULES.CHANGE_NO_DIFFERENCE),
            ("no trigger", {"triggering_evidence": None}, RULES.CHANGE_TRIGGER_MISSING),
            ("trigger from another claim", {"triggering_evidence": TriggeringEvidence("e9", "c2")}, RULES.CHANGE_TRIGGER_FOREIGN_CLAIM),
            ("first assessment is not a change", {"previous_state": None, "persisted_state": None}, RULES.CHANGE_PREVIOUS_MISSING),
            ("trigger not new in this run", {"trigger_is_new": False}, RULES.CHANGE_TRIGGER_NOT_NEW),
        ],
    )
    def test_rejects(self, label: str, patch: dict[str, Any], rule: str) -> None:
        assert rule in validate_state_change(replace(self.BASE, **patch)).rule_ids


class TestHardRulesOverrideEvaluator:
    def test_rejects_when_a_hard_rule_fails_even_if_the_evaluator_accepts(self) -> None:
        failed = validate_assessment_rules(assessment(evidence_ids=()), [])
        assert decide(failed, True) == "REJECT"
        assert decide(RuleResult(True), False) == "REJECT"
        assert decide(RuleResult(True), True) == "ACCEPT"
