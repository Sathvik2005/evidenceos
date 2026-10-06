"""Database-level integrity: constraints and triggers hold regardless of application code (port of data-model.test.ts)."""

from __future__ import annotations

from typing import Any

import psycopg
import pytest

from evidenceos.db import PsycopgDatabase

pytestmark = pytest.mark.hard


async def one(db: PsycopgDatabase, sql: str, *params: Any) -> Any:
    rows = await db.query(sql, list(params))
    return next(iter(rows[0].values()))


async def insert_fixture(db: PsycopgDatabase, question: str) -> dict[str, str]:
    investigation = str(await one(db, "INSERT INTO investigations (owner_id, question) VALUES ('user-1', $1) RETURNING id", question))
    claim = str(await one(
        db, "INSERT INTO claims (investigation_id, ordinal, statement) VALUES ($1, 1, 'The claim under test.') RETURNING id", investigation
    ))
    source = str(await one(
        db,
        "INSERT INTO sources (investigation_id, source_type, url, title) VALUES ($1, 'WEB_PAGE', 'https://example.org/source', 'Test source') RETURNING id",
        investigation,
    ))
    evidence = str(await one(
        db,
        """INSERT INTO evidence (investigation_id, claim_id, source_id, relationship, strength, excerpt)
           VALUES ($1, $2, $3, 'SUPPORTS', 'STRONG', 'A quoted source excerpt.') RETURNING id""",
        investigation, claim, source,
    ))
    return {"investigation": investigation, "claim": claim, "source": source, "evidence": evidence}


CHANGE = (
    "INSERT INTO evidence_changes (investigation_id, claim_id, previous_state, new_state, reason, "
    "triggering_evidence_id, idempotency_key) VALUES ($1, $2, {prev}, {new}, {reason}, $3, {key}) RETURNING id"
)


def change_sql(prev: str, new: str, reason: str, key: str) -> str:
    return CHANGE.format(prev=prev, new=new, reason=f"'{reason}'", key=f"'{key}'")


async def test_creates_related_investigation_claim_source_and_evidence_records(db: PsycopgDatabase) -> None:
    f = await insert_fixture(db, "A representative question?")
    count = await one(
        db,
        """SELECT count(*)::int FROM evidence e
           JOIN claims c ON c.investigation_id = e.investigation_id AND c.id = e.claim_id
           JOIN sources s ON s.investigation_id = e.investigation_id AND s.id = e.source_id
           WHERE e.investigation_id = $1 AND c.id = $2""",
        f["investigation"], f["claim"],
    )
    assert count == 1


async def test_rejects_evidence_that_references_a_source_from_another_investigation(db: PsycopgDatabase) -> None:
    first = await insert_fixture(db, "First investigation?")
    second = await insert_fixture(db, "Second investigation?")
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        await db.query(
            """INSERT INTO evidence (investigation_id, claim_id, source_id, relationship, strength, excerpt)
               VALUES ($1, $2, $3, 'SUPPORTS', 'MODERATE', 'Cross-investigation excerpt.')""",
            [first["investigation"], first["claim"], second["source"]],
        )


async def test_records_a_state_change_only_when_prior_state_and_triggering_evidence_match(db: PsycopgDatabase) -> None:
    f = await insert_fixture(db, "State transition question?")
    await db.query("UPDATE claims SET state = 'PARTIALLY_SUPPORTED' WHERE id = $1", [f["claim"]])
    await db.query(
        change_sql("'PARTIALLY_SUPPORTED'", "'CONFLICTING'", "New evidence contradicts the claim.", "transition-1"),
        [f["investigation"], f["claim"], f["evidence"]],
    )
    assert await one(db, "SELECT state FROM claims WHERE id = $1", f["claim"]) == "CONFLICTING"
    with pytest.raises(psycopg.errors.CheckViolation, match="Claim state does not match the recorded previous state"):
        await db.query(
            change_sql("'INSUFFICIENT'", "'SUPPORTED'", "Mismatched prior state.", "transition-2"),
            [f["investigation"], f["claim"], f["evidence"]],
        )


async def test_rejects_a_transition_triggered_by_evidence_belonging_to_another_claim(db: PsycopgDatabase) -> None:
    f = await insert_fixture(db, "Evidence ownership question?")
    other = str(await one(
        db, "INSERT INTO claims (investigation_id, ordinal, statement) VALUES ($1, 2, 'A different claim.') RETURNING id", f["investigation"]
    ))
    await db.query("UPDATE claims SET state = 'PARTIALLY_SUPPORTED' WHERE id = $1", [other])
    with pytest.raises(psycopg.Error):
        await db.query(
            change_sql("'PARTIALLY_SUPPORTED'", "'CONFLICTING'", "Evidence belongs elsewhere.", "transition-3"),
            [f["investigation"], other, f["evidence"]],
        )


async def test_allows_a_first_state_to_be_set_directly_but_blocks_later_direct_state_edits(db: PsycopgDatabase) -> None:
    f = await insert_fixture(db, "Direct edit question?")
    await db.query("UPDATE claims SET state = 'SUPPORTED' WHERE id = $1", [f["claim"]])
    with pytest.raises(psycopg.errors.CheckViolation, match="Claim state may only change through an evidence_changes record"):
        await db.query("UPDATE claims SET state = 'CONFLICTING' WHERE id = $1", [f["claim"]])


async def test_requires_a_persisted_previous_state_on_every_change_record(db: PsycopgDatabase) -> None:
    f = await insert_fixture(db, "Null previous state question?")
    with pytest.raises(psycopg.errors.NotNullViolation):
        await db.query(
            change_sql("NULL", "'SUPPORTED'", "A first assessment is not a change.", "null-prev"),
            [f["investigation"], f["claim"], f["evidence"]],
        )


async def test_keeps_evidence_change_history_append_only(db: PsycopgDatabase) -> None:
    f = await insert_fixture(db, "Append-only history question?")
    await db.query("UPDATE claims SET state = 'PARTIALLY_SUPPORTED' WHERE id = $1", [f["claim"]])
    history = await one(
        db,
        change_sql("'PARTIALLY_SUPPORTED'", "'CONFLICTING'", "New contradicting evidence.", "transition-4"),
        f["investigation"], f["claim"], f["evidence"],
    )
    with pytest.raises(psycopg.Error, match="Evidence change history is append-only"):
        await db.query("UPDATE evidence_changes SET reason = 'Rewritten history.' WHERE id = $1", [history])
    with pytest.raises(psycopg.Error, match="Evidence change history is append-only"):
        await db.query("DELETE FROM evidence_changes WHERE id = $1", [history])
