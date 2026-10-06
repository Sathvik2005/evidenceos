"""Workflow foundation tests: ordering, bounded retries and explicit failure (port of workflow-graph.test.ts)."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from evidenceos.workflow.graph import build_investigation_graph, placeholder_handlers, run_investigation
from evidenceos.workflow.types import WORKFLOW_NODES, TraceEntry, WorkflowError, WorkflowOptions


def fixed_now() -> datetime:
    return datetime(2026, 1, 1, tzinfo=UTC)


def handlers_with(**overrides: Any) -> dict[str, Any]:
    return {**placeholder_handlers, **overrides}


async def run(graph: Any) -> dict[str, Any]:
    return await run_investigation(graph, investigation_id="inv-1", owner_id="owner-1", question="Does X hold?")


async def test_runs_every_node_in_order_and_fabricates_nothing_with_placeholder_handlers() -> None:
    logged: list[TraceEntry] = []
    graph = build_investigation_graph(placeholder_handlers, WorkflowOptions(now=fixed_now, log=logged.append))
    result = await run(graph)
    assert [t.node for t in result["trace"]] == list(WORKFLOW_NODES)
    assert len(logged) == len(WORKFLOW_NODES)
    assert result["claims"] == []
    assert result["evidence_by_claim"] == {}
    assert result["outcomes"] == {}
    assert result["status"] == "COMPLETED"


async def test_retries_transient_failures_within_the_bound_and_then_succeeds() -> None:
    calls = {"n": 0}

    async def research(_state: Mapping[str, Any]) -> dict[str, Any]:
        calls["n"] += 1
        if calls["n"] < 3:
            raise WorkflowError("TIMEOUT", "slow")
        return {}

    result = await run(build_investigation_graph(handlers_with(research=research), WorkflowOptions(now=fixed_now)))
    assert [t.outcome for t in result["trace"] if t.node == "research"] == ["RETRY", "RETRY", "OK"]
    assert result["status"] == "COMPLETED"


async def test_stops_after_the_retry_bound_and_records_an_explicit_failed_run() -> None:
    calls = {"n": 0}

    async def research(_state: Mapping[str, Any]) -> dict[str, Any]:
        calls["n"] += 1
        raise WorkflowError("PROVIDER", "down")

    result = await run(build_investigation_graph(handlers_with(research=research), WorkflowOptions(now=fixed_now)))
    assert calls["n"] == 3
    assert result["status"] == "FAILED"
    assert [(f.node, f.kind, f.message) for f in result["failures"]] == [("research", "PROVIDER", "down")]
    assert not any(t.node == "analyze" for t in result["trace"])


async def test_never_retries_deterministic_validation_failures() -> None:
    calls = {"n": 0}

    async def validate_claims(_state: Mapping[str, Any]) -> dict[str, Any]:
        calls["n"] += 1
        raise WorkflowError("VALIDATION", "bad claim")

    result = await run(build_investigation_graph(handlers_with(validateClaims=validate_claims)))
    assert calls["n"] == 1
    assert result["status"] == "FAILED"


async def test_classifies_unexpected_exceptions_as_workflow_failures_without_leaking_their_message() -> None:
    async def load(_state: Mapping[str, Any]) -> dict[str, Any]:
        raise RuntimeError("secret-ish internal detail")

    result = await run(build_investigation_graph(handlers_with(load=load)))
    assert (result["failures"][0].node, result["failures"][0].kind) == ("load", "WORKFLOW")
    assert "secret-ish" not in repr(result["failures"])
