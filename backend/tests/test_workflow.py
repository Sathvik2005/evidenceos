"""End-to-end workflow tests with a controlled fixture (port of the TypeScript investigation-workflow suite)."""

from __future__ import annotations

from typing import Any

from evidenceos.agents.llm import LlmRequest
from evidenceos.agents.research_agent import SearchOutcome
from evidenceos.db import PsycopgDatabase
from evidenceos.operations import create_investigation
from evidenceos.workflow.handlers import WorkflowDeps
from evidenceos.workflow.run import run_investigation_workflow
from evidenceos.workflow.types import WorkflowError

from .helpers import Corpus, FixtureLlm, FunctionSearch, doc

TWO_CLAIMS = ["Remote learning changes standardized test scores", "Remote learning changes student attendance rates"]


async def new_investigation(db: PsycopgDatabase, owner: str) -> str:
    result = await create_investigation(db, owner, question="Does remote learning improve student outcomes?")
    assert result.ok
    return result.data["id"]


async def scalar(db: PsycopgDatabase, sql: str, *params: Any) -> Any:
    rows = await db.query(sql, list(params))
    return next(iter(rows[0].values()))


async def run(db: PsycopgDatabase, investigation_id: str, owner: str, llm: Any, search: Any, **kw: Any) -> dict[str, Any]:
    return await run_investigation_workflow(
        WorkflowDeps(db=db, llm=llm, search=search, **kw), investigation_id=investigation_id, owner_id=owner
    )


class TestFullWorkflow:
    async def test_runs_end_to_end_preserves_contradiction_and_records_real_state_history(self, db: PsycopgDatabase) -> None:
        inv = await new_investigation(db, "owner-a")
        result = await run(db, inv, "owner-a", FixtureLlm(claims=TWO_CLAIMS), Corpus())
        assert result["status"] == "COMPLETED"
        claims = await db.query("SELECT statement, state, confidence FROM claims WHERE investigation_id = $1 ORDER BY ordinal", [inv])
        assert [c["state"] for c in claims] == ["CONFLICTING", "SUPPORTED"]
        assert all(c["confidence"] == "MEDIUM" for c in claims)
        # The contradicting evidence is persisted next to the supporting evidence, with provenance.
        assert await scalar(db, "SELECT count(*) FROM evidence WHERE investigation_id = $1 AND relationship = 'CONTRADICTS'", inv) == 1
        assert await scalar(db, "SELECT count(*) FROM sources WHERE investigation_id = $1", inv) == 3
        # First assessments are stored directly: they are not state changes, so there is no history yet.
        assert await scalar(db, "SELECT count(*) FROM evidence_changes WHERE investigation_id = $1", inv) == 0
        assert await scalar(db, "SELECT status FROM investigations WHERE id = $1", inv) == "READY"
        assert "1 CONFLICTING" in result["summary"]

    async def test_is_idempotent_a_rerun_creates_no_duplicates(self, db: PsycopgDatabase) -> None:
        inv = await new_investigation(db, "owner-b")
        llm, search = FixtureLlm(claims=TWO_CLAIMS), Corpus()
        await run(db, inv, "owner-b", llm, search)
        tables = ["claims", "sources", "evidence", "evidence_changes"]

        async def counts() -> list[int]:
            return [await scalar(db, f"SELECT count(*) FROM {t} WHERE investigation_id = $1", inv) for t in tables]

        before = await counts()
        again = await run(db, inv, "owner-b", llm, search)
        assert await counts() == before
        assert again["status"] == "COMPLETED"

    async def test_no_evidence_yields_insufficient_and_never_supported_without_support(self, db: PsycopgDatabase) -> None:
        inv = await new_investigation(db, "owner-c")
        result = await run(db, inv, "owner-c", FixtureLlm(), Corpus())
        assert result["status"] == "COMPLETED"
        unsupported = await scalar(
            db,
            """SELECT count(*) FROM claims c WHERE investigation_id = $1 AND state = 'SUPPORTED'
               AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.claim_id = c.id AND e.relationship = 'SUPPORTS')""",
            inv,
        )
        assert unsupported == 0
        third = (await db.query("SELECT state, confidence FROM claims WHERE investigation_id = $1 AND ordinal = 3", [inv]))[0]
        assert third == {"state": "INSUFFICIENT", "confidence": "LOW"}
        assert await scalar(db, "SELECT status FROM investigations WHERE id = $1", inv) == "READY"


class TestChangeDetection:
    async def test_partially_supported_then_new_evidence_then_conflicting_recorded_once_with_its_trigger(
        self, db: PsycopgDatabase
    ) -> None:
        inv = await new_investigation(db, "owner-h")
        partly = doc("scores-partly", "Remote students partly improved reading scores in one district.")
        contradicting = doc("scores-down", "Average math scores declined after the move to remote learning.")
        phase = {"n": 1}

        def evolving(query: str) -> SearchOutcome:
            if "test scores" not in query:
                return SearchOutcome()
            return SearchOutcome(documents=(partly,) if phase["n"] == 1 else (partly, contradicting))

        llm, search = FixtureLlm(claims=[TWO_CLAIMS[0]]), FunctionSearch(evolving)

        async def state_of() -> Any:
            return await scalar(db, "SELECT state FROM claims WHERE investigation_id = $1", inv)

        await run(db, inv, "owner-h", llm, search)
        assert await state_of() == "PARTIALLY_SUPPORTED"
        assert await scalar(db, "SELECT count(*) FROM evidence_changes WHERE investigation_id = $1", inv) == 0

        phase["n"] = 2
        second = await run(db, inv, "owner-h", llm, search)
        assert second["status"] == "COMPLETED"
        assert await state_of() == "CONFLICTING"
        rows = await db.query(
            """SELECT ch.previous_state, ch.new_state, e.relationship, e.excerpt FROM evidence_changes ch
               JOIN evidence e ON e.id = ch.triggering_evidence_id WHERE ch.investigation_id = $1""",
            [inv],
        )
        assert rows == [
            {"previous_state": "PARTIALLY_SUPPORTED", "new_state": "CONFLICTING", "relationship": "CONTRADICTS", "excerpt": contradicting.text}
        ]
        # The earlier evidence is kept; nothing is deleted because the state changed.
        assert await scalar(db, "SELECT count(*) FROM evidence WHERE investigation_id = $1", inv) == 2

        await run(db, inv, "owner-h", llm, search)  # same evidence again: no change, no new history
        assert await scalar(db, "SELECT count(*) FROM evidence_changes WHERE investigation_id = $1", inv) == 1


class TestFailureHandling:
    async def test_keeps_partial_progress_and_marks_research_unavailable_when_retrieval_fails(self, db: PsycopgDatabase) -> None:
        inv = await new_investigation(db, "owner-d")

        class Offline:
            async def search(self, query: str) -> SearchOutcome:
                raise WorkflowError("NETWORK", "offline")

        result = await run(db, inv, "owner-d", FixtureLlm(claims=TWO_CLAIMS), Offline(), max_retries=1)
        assert result["status"] == "PARTIAL"
        assert len([f for f in result["failures"] if f.message.startswith("Research unavailable")]) == 2
        assert await scalar(db, "SELECT count(*) FROM claims WHERE investigation_id = $1", inv) == 2
        assert await scalar(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state IS NOT NULL", inv) == 0
        assert result["outcomes"] == {}

    async def test_rejects_a_fabricated_quote_without_discarding_the_other_claims(self, db: PsycopgDatabase) -> None:
        inv = await new_investigation(db, "owner-e")

        def research(request: LlmRequest) -> Any:
            if "attendance" in request.user:
                return {"candidates": [{"documentIndex": 0, "excerpt": "Invented attendance statistic.", "relationship": "SUPPORTS", "strength": "STRONG"}]}
            return None  # default answer for the other claim

        result = await run(db, inv, "owner-e", FixtureLlm(claims=TWO_CLAIMS, research=research), Corpus(), max_retries=1)
        assert result["status"] == "PARTIAL"
        assert any(f.node == "research" and f.kind == "MALFORMED_OUTPUT" for f in result["failures"])
        assert await scalar(db, "SELECT count(*) FROM evidence WHERE investigation_id = $1 AND excerpt LIKE 'Invented%'", inv) == 0
        assert await scalar(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state = 'CONFLICTING'", inv) == 1

    async def test_fails_the_run_explicitly_on_an_authentication_error_and_persists_error(self, db: PsycopgDatabase) -> None:
        inv = await new_investigation(db, "owner-f")

        class Denied:
            async def generate(self, request: LlmRequest) -> Any:
                raise WorkflowError("AUTHENTICATION", "bad key")

        result = await run(db, inv, "owner-f", Denied(), Corpus())
        assert result["status"] == "FAILED"
        assert result["failures"][0].node == "decompose" and result["failures"][0].kind == "AUTHENTICATION"
        assert await scalar(db, "SELECT status FROM investigations WHERE id = $1", inv) == "ERROR"

    async def test_refuses_to_run_for_an_investigation_owned_by_someone_else(self, db: PsycopgDatabase) -> None:
        inv = await new_investigation(db, "owner-g")
        result = await run(db, inv, "intruder", FixtureLlm(), Corpus())
        assert result["status"] == "FAILED"
        assert result["failures"][0].node == "load" and result["failures"][0].kind == "AUTHORIZATION"
