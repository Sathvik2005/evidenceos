"""Failure injection. Each case breaks one thing and proves the system fails safely.

No false SUPPORTED, no hidden contradiction, no duplicate writes, and an explicit user-visible status.
Tests are marked `hard` (critical evidence-integrity invariant) and `failure` (an injected fault).
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import pytest

from evidenceos.agents.llm import LlmRequest
from evidenceos.agents.research_agent import SearchOutcome, research_claim
from evidenceos.db import PsycopgDatabase
from evidenceos.operations import create_investigation
from evidenceos.workflow.handlers import WorkflowDeps
from evidenceos.workflow.run import run_investigation_workflow
from evidenceos.workflow.types import WorkflowError

from .helpers import DEFAULT_CLAIMS, FixtureLlm, FunctionSearch, ScriptedLlm, doc

pytestmark = [pytest.mark.hard, pytest.mark.failure]

ONE_CLAIM = [DEFAULT_CLAIMS[0]]


def corpus_outcome(query: str) -> SearchOutcome:
    if "test scores" in query:
        return SearchOutcome(
            documents=(
                doc("up", "Remote students improved reading scores in one district."),
                doc("down", "Average math scores declined after the move to remote learning."),
            )
        )
    return SearchOutcome()


CORPUS = FunctionSearch(corpus_outcome)


async def investigation(db: PsycopgDatabase, owner: str) -> str:
    created = await create_investigation(db, owner, question="Does remote learning improve student outcomes?")
    assert created.ok
    return created.data["id"]


async def count(db: PsycopgDatabase, sql: str, *params: Any) -> int:
    return int(next(iter((await db.query(sql, list(params)))[0].values())))


async def run(db: Any, inv: str, owner: str, *, llm: Any = None, search: Any = None, max_retries: int = 2) -> dict[str, Any]:
    deps = WorkflowDeps(db=db, llm=llm or FixtureLlm(claims=ONE_CLAIM), search=search or CORPUS, max_retries=max_retries)
    return await run_investigation_workflow(deps, investigation_id=inv, owner_id=owner)


async def test_timeout_recovers_within_the_retry_bound_then_reports_unavailable_never_a_state(db: PsycopgDatabase) -> None:
    calls = {"n": 0}

    class Flaky:
        async def search(self, query: str) -> SearchOutcome:
            calls["n"] += 1
            if calls["n"] < 3:
                raise WorkflowError("TIMEOUT", "slow")
            return corpus_outcome(query)

    inv = await investigation(db, "f-timeout")
    assert (await run(db, inv, "f-timeout", search=Flaky()))["status"] == "COMPLETED"
    assert calls["n"] == 3

    always = {"n": 0}

    class Dead:
        async def search(self, query: str) -> SearchOutcome:
            always["n"] += 1
            raise WorkflowError("TIMEOUT", "slow")

    other = await investigation(db, "f-timeout")
    result = await run(db, other, "f-timeout", search=Dead())
    assert always["n"] == 3
    assert result["status"] == "PARTIAL"
    assert await count(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state IS NOT NULL", other) == 0


async def test_malformed_model_output_bounded_retries_explicit_failure_nothing_persisted_as_evidence(db: PsycopgDatabase) -> None:
    llm = FixtureLlm(claims=ONE_CLAIM, research=lambda _r: {"nonsense": True})
    inv = await investigation(db, "f-malformed")
    result = await run(db, inv, "f-malformed", llm=llm)
    assert any(f.node == "research" and f.kind == "MALFORMED_OUTPUT" for f in result["failures"])
    assert await count(db, "SELECT count(*) FROM evidence WHERE investigation_id = $1", inv) == 0
    assert await count(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state = 'SUPPORTED'", inv) == 0


async def test_missing_excerpt_a_candidate_with_no_quote_is_rejected_by_the_agent() -> None:
    llm = ScriptedLlm({"candidates": [{"documentIndex": 0, "excerpt": "   ", "relationship": "SUPPORTS", "strength": "STRONG"}]})
    with pytest.raises(WorkflowError) as error:
        await research_claim(llm, CORPUS, claim_id="c", statement="test scores", max_retries=0)
    assert error.value.kind == "MALFORMED_OUTPUT"


async def test_fabricated_provenance_an_invented_quote_never_reaches_the_database(db: PsycopgDatabase) -> None:
    fabricated = {"candidates": [{"documentIndex": 0, "excerpt": "Scores rose forty points everywhere.", "relationship": "SUPPORTS", "strength": "STRONG"}]}
    inv = await investigation(db, "f-fabricated")
    await run(db, inv, "f-fabricated", llm=FixtureLlm(claims=ONE_CLAIM, research=lambda _r: fabricated))
    assert await count(db, "SELECT count(*) FROM evidence WHERE investigation_id = $1 AND excerpt LIKE '%forty%'", inv) == 0


class Wrapped(FixtureLlm):
    """A fixture model whose assessment answer can be replaced to simulate a misbehaving model."""

    def __init__(self, assessment: Any, **kw: Any) -> None:
        super().__init__(**kw)
        self.assessment = assessment

    async def generate(self, request: LlmRequest) -> Any:
        if request.schema_name == "evidence_assessment":
            return self.assessment(request)
        return await super().generate(request)


async def test_invalid_claim_reference_an_assessment_citing_unknown_evidence_is_rejected_not_saved(db: PsycopgDatabase) -> None:
    llm = Wrapped(
        lambda _r: {"proposedState": "SUPPORTED", "confidence": "HIGH", "rationale": "r",
                    "evidenceIds": ["00000000-0000-4000-8000-00000000dead"], "causalStatus": "NOT_APPLICABLE",
                    "scopeNotes": [], "uncertainties": []},
        claims=ONE_CLAIM,
    )
    inv = await investigation(db, "f-badref")
    result = await run(db, inv, "f-badref", llm=llm)
    assert any(f.node == "analyze" and f.kind == "MALFORMED_OUTPUT" for f in result["failures"])
    assert await count(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state IS NOT NULL", inv) == 0


async def test_contradiction_a_model_that_tries_to_ignore_it_cannot_produce_supported(db: PsycopgDatabase) -> None:
    def ignoring(request: LlmRequest) -> dict[str, Any]:
        ids = re.findall(r'<evidence id="([^"]+)" relationship="SUPPORTS"', request.user)
        return {"proposedState": "SUPPORTED", "confidence": "HIGH", "rationale": "Ignore the rest.", "evidenceIds": ids,
                "causalStatus": "NOT_APPLICABLE", "scopeNotes": [], "uncertainties": []}

    inv = await investigation(db, "f-contradiction")
    await run(db, inv, "f-contradiction", llm=Wrapped(ignoring, claims=ONE_CLAIM))
    assert await count(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state = 'SUPPORTED'", inv) == 0
    assert await count(db, "SELECT count(*) FROM evidence WHERE investigation_id = $1 AND relationship = 'CONTRADICTS'", inv) == 1


async def test_duplicate_workflow_execution_two_concurrent_runs_create_no_duplicates(db: PsycopgDatabase) -> None:
    inv = await investigation(db, "f-duplicate")
    await asyncio.gather(run(db, inv, "f-duplicate"), run(db, inv, "f-duplicate"))
    assert await count(db, "SELECT count(*) FROM claims WHERE investigation_id = $1", inv) == 1
    assert await count(db, "SELECT count(*) FROM evidence WHERE investigation_id = $1", inv) == 2
    assert await count(db, "SELECT count(*) FROM sources WHERE investigation_id = $1", inv) == 2


async def test_partial_research_failure_the_failing_claim_is_flagged_and_the_others_still_complete(db: PsycopgDatabase) -> None:
    class Mixed:
        async def search(self, query: str) -> SearchOutcome:
            if "attendance" in query:
                raise WorkflowError("NETWORK", "offline")
            return corpus_outcome(query)

    inv = await investigation(db, "f-partial")
    result = await run(db, inv, "f-partial", llm=FixtureLlm(claims=[DEFAULT_CLAIMS[0], DEFAULT_CLAIMS[1]]), search=Mixed(), max_retries=1)
    assert result["status"] == "PARTIAL"
    assert await count(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state = 'CONFLICTING'", inv) == 1
    assert await count(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state IS NULL", inv) == 1
    assert (await db.query("SELECT status FROM investigations WHERE id = $1", [inv]))[0]["status"] == "REVIEW_REQUIRED"


async def test_persistence_failure_a_database_error_is_reported_never_converted_into_success(db: PsycopgDatabase) -> None:
    class Failing:
        async def query(self, sql: str, params: Any = None) -> list[dict[str, Any]]:
            if "INSERT INTO evidence " in sql:
                raise RuntimeError("disk full")
            return await db.query(sql, params)

    inv = await investigation(db, "f-persist")
    result = await run(Failing(), inv, "f-persist", max_retries=1)
    assert result["status"] != "COMPLETED"
    assert any(f.node == "validateEvidence" for f in result["failures"])
    assert await count(db, "SELECT count(*) FROM evidence WHERE investigation_id = $1", inv) == 0
    assert await count(db, "SELECT count(*) FROM claims WHERE investigation_id = $1 AND state = 'SUPPORTED'", inv) == 0


async def test_fatal_credential_failure_the_run_fails_explicitly_and_the_investigation_is_marked_error(db: PsycopgDatabase) -> None:
    class Denied:
        async def generate(self, request: LlmRequest) -> Any:
            raise WorkflowError("AUTHENTICATION", "bad key")

    inv = await investigation(db, "f-auth")
    result = await run(db, inv, "f-auth", llm=Denied())
    assert result["status"] == "FAILED"
    assert (await db.query("SELECT status FROM investigations WHERE id = $1", [inv]))[0]["status"] == "ERROR"
