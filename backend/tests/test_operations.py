"""Contract tests for the persistence operations (port of the TypeScript api-operations suite)."""

from __future__ import annotations

import re
from typing import Any

from evidenceos.contracts import ApiError, ApiResult
from evidenceos.db import PsycopgDatabase
from evidenceos.operations import (
    add_claim,
    add_evidence,
    add_source,
    create_investigation,
    get_investigation,
    list_claims,
    list_evidence_changes,
    list_investigations,
    record_claim_assessment,
    record_state_change,
)


def unwrap(result: ApiResult[Any]) -> Any:
    assert result.ok, f"Expected ok, got {result.error}"
    return result.data


def error_of(result: ApiResult[Any]) -> ApiError:
    assert not result.ok, "Expected an error result."
    assert result.error is not None
    return result.error


async def seed(db: PsycopgDatabase, owner: str) -> dict[str, Any]:
    investigation = unwrap(await create_investigation(db, owner, question="Does X hold?"))
    claim = unwrap(await add_claim(db, owner, investigation_id=investigation["id"], ordinal=1, statement="X holds."))
    source = unwrap(
        await add_source(
            db, owner, investigation_id=investigation["id"], source_type="JOURNAL_ARTICLE",
            url="https://example.org/a", title="A study",
        )
    )
    evidence = unwrap(
        await add_evidence(
            db, owner, investigation_id=investigation["id"], claim_id=claim["id"], source_id=source["id"],
            relationship="SUPPORTS", strength="MODERATE", excerpt="A quoted excerpt.",
        )
    )
    return {"investigation": investigation, "claim": claim, "source": source, "evidence": evidence}


async def assess_first(db: PsycopgDatabase, owner: str, seeded: dict[str, Any], state: str = "PARTIALLY_SUPPORTED") -> Any:
    """Gives the claim its first, directly stored state (a first assessment is not a change event)."""
    return unwrap(
        await record_claim_assessment(
            db, owner, investigation_id=seeded["investigation"]["id"], claim_id=seeded["claim"]["id"],
            confidence="MEDIUM", reason="First assessment.", initial_state=state,
        )
    )


class TestValidRequests:
    async def test_creates_and_reads_related_records(self, db: PsycopgDatabase) -> None:
        s = await seed(db, "owner-valid")
        assert unwrap(await get_investigation(db, "owner-valid", s["investigation"]["id"]))["question"] == "Does X hold?"
        assert unwrap(await list_claims(db, "owner-valid", s["investigation"]["id"])) == [s["claim"]]
        assert s["evidence"]["claimId"] == s["claim"]["id"]
        assert s["claim"]["state"] is None

    async def test_records_a_state_change_and_updates_the_claim(self, db: PsycopgDatabase) -> None:
        s = await seed(db, "owner-change")
        assert (await assess_first(db, "owner-change", s))["state"] == "PARTIALLY_SUPPORTED"
        change = unwrap(
            await record_state_change(
                db, "owner-change", investigation_id=s["investigation"]["id"], claim_id=s["claim"]["id"],
                previous_state="PARTIALLY_SUPPORTED", new_state="CONFLICTING", reason="New contradicting evidence.",
                triggering_evidence_id=s["evidence"]["id"], idempotency_key="k1",
            )
        )
        assert change["newState"] == "CONFLICTING"
        assert unwrap(await list_claims(db, "owner-change", s["investigation"]["id"]))[0]["state"] == "CONFLICTING"
        assert len(unwrap(await list_evidence_changes(db, "owner-change", s["investigation"]["id"]))) == 1

    async def test_bounds_pagination(self, db: PsycopgDatabase) -> None:
        await create_investigation(db, "owner-page", question="One?")
        await create_investigation(db, "owner-page", question="Two?")
        assert len(unwrap(await list_investigations(db, "owner-page", limit=1))) == 1
        assert error_of(await list_investigations(db, "owner-page", limit=101)).code == "VALIDATION_FAILED"
        assert error_of(await list_investigations(db, "owner-page", offset=-1)).field == "offset"


class TestInvalidRequests:
    async def test_rejects_malformed_input_with_the_offending_field(self, db: PsycopgDatabase) -> None:
        assert error_of(await create_investigation(db, "o", question="   ")).field == "question"
        s = await seed(db, "owner-invalid")
        base = {
            "investigation_id": s["investigation"]["id"], "claim_id": s["claim"]["id"], "source_id": s["source"]["id"],
        }
        bad_relationship = await add_evidence(db, "owner-invalid", **base, relationship="MAYBE", strength="STRONG", excerpt="x")
        assert error_of(bad_relationship).field == "relationship"
        empty_excerpt = await add_evidence(db, "owner-invalid", **base, relationship="SUPPORTS", strength="STRONG", excerpt="")
        assert error_of(empty_excerpt).field == "excerpt"
        bad_url = await add_source(
            db, "owner-invalid", investigation_id=s["investigation"]["id"], source_type="WEB_PAGE",
            url="ftp://example.org", title="t",
        )
        assert error_of(bad_url).field == "url"
        bad_id = await add_claim(db, "owner-invalid", investigation_id="not-a-uuid", ordinal=2, statement="s")
        assert error_of(bad_id).field == "investigationId"
        bad_ordinal = await add_claim(db, "owner-invalid", investigation_id=s["investigation"]["id"], ordinal=0, statement="s")
        assert error_of(bad_ordinal).field == "ordinal"

    async def test_rejects_evidence_referencing_a_source_from_another_investigation(self, db: PsycopgDatabase) -> None:
        a = await seed(db, "owner-ref-a")
        b = await seed(db, "owner-ref-a")
        error = error_of(
            await add_evidence(
                db, "owner-ref-a", investigation_id=a["investigation"]["id"], claim_id=a["claim"]["id"],
                source_id=b["source"]["id"], relationship="CONTRADICTS", strength="WEAK",
                excerpt="Cross-investigation excerpt.",
            )
        )
        assert error.code == "REFERENCE_INVALID"
        assert not re.search(r"violates|constraint|evidence_", error.message, re.IGNORECASE)

    async def test_rejects_a_state_change_with_a_stale_previous_state_or_foreign_evidence(self, db: PsycopgDatabase) -> None:
        a = await seed(db, "owner-state")
        b = await seed(db, "owner-state")
        await assess_first(db, "owner-state", a)
        common = {"investigation_id": a["investigation"]["id"], "claim_id": a["claim"]["id"]}
        stale = error_of(
            await record_state_change(
                db, "owner-state", **common, previous_state="SUPPORTED", new_state="CONFLICTING",
                reason="Stale.", triggering_evidence_id=a["evidence"]["id"], idempotency_key="stale",
            )
        )
        assert stale.code == "CONSTRAINT_VIOLATION"
        foreign = error_of(
            await record_state_change(
                db, "owner-state", **common, previous_state="PARTIALLY_SUPPORTED", new_state="CONFLICTING",
                reason="Wrong evidence.", triggering_evidence_id=b["evidence"]["id"], idempotency_key="foreign",
            )
        )
        assert foreign.code == "REFERENCE_INVALID"
        assert unwrap(await list_claims(db, "owner-state", a["investigation"]["id"]))[0]["state"] == "PARTIALLY_SUPPORTED"
        noop = await record_state_change(
            db, "owner-state", **common, previous_state="PARTIALLY_SUPPORTED", new_state="PARTIALLY_SUPPORTED",
            reason="No-op.", triggering_evidence_id=a["evidence"]["id"], idempotency_key="noop",
        )
        assert error_of(noop).field == "newState"


class TestOwnership:
    async def test_hides_other_owners_investigations_and_blocks_writes_to_them(self, db: PsycopgDatabase) -> None:
        s = await seed(db, "owner-one")
        inv = s["investigation"]["id"]
        assert error_of(await get_investigation(db, "owner-two", inv)).code == "NOT_FOUND"
        intrusion = await add_claim(db, "owner-two", investigation_id=inv, ordinal=2, statement="Intrusion.")
        assert error_of(intrusion).code == "NOT_FOUND"
        assert error_of(await list_claims(db, "owner-two", inv)).code == "NOT_FOUND"
        assert len(unwrap(await list_investigations(db, "owner-two"))) == 0


class TestIdempotency:
    async def test_returns_the_same_record_for_an_identical_replay_without_duplicating(self, db: PsycopgDatabase) -> None:
        first = unwrap(await create_investigation(db, "owner-idem", question="Replay?", idempotency_key="inv-1"))
        second = unwrap(await create_investigation(db, "owner-idem", question="Replay?", idempotency_key="inv-1"))
        assert second["id"] == first["id"]
        assert len(unwrap(await list_investigations(db, "owner-idem"))) == 1
        args = {"investigation_id": first["id"], "ordinal": 1, "statement": "Once.", "idempotency_key": "claim-1"}
        claim = unwrap(await add_claim(db, "owner-idem", **args))
        assert unwrap(await add_claim(db, "owner-idem", **args))["id"] == claim["id"]
        assert len(unwrap(await list_claims(db, "owner-idem", first["id"]))) == 1

    async def test_rejects_a_key_reused_with_different_content(self, db: PsycopgDatabase) -> None:
        unwrap(await create_investigation(db, "owner-idem2", question="Original?", idempotency_key="k"))
        different = await create_investigation(db, "owner-idem2", question="Different?", idempotency_key="k")
        assert error_of(different).code == "IDEMPOTENCY_CONFLICT"

    async def test_does_not_duplicate_state_changes_on_retry(self, db: PsycopgDatabase) -> None:
        s = await seed(db, "owner-idem3")
        await assess_first(db, "owner-idem3", s)
        args = {
            "investigation_id": s["investigation"]["id"], "claim_id": s["claim"]["id"],
            "previous_state": "PARTIALLY_SUPPORTED", "new_state": "CONFLICTING", "reason": "Assessed.",
            "triggering_evidence_id": s["evidence"]["id"], "idempotency_key": "change-1",
        }
        first = unwrap(await record_state_change(db, "owner-idem3", **args))
        assert unwrap(await record_state_change(db, "owner-idem3", **args))["id"] == first["id"]
        assert len(unwrap(await list_evidence_changes(db, "owner-idem3", s["investigation"]["id"]))) == 1
