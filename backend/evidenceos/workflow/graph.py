"""The LangGraph state machine: explicit, typed, serializable state and bounded per-node retries.

Nodes run in a fixed order. A node that fails ends the run with an explicit FAILED status; per-claim problems
are recorded as failures (see handlers) so one claim cannot discard the others.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Annotated, Any, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from .types import (
    DEFAULT_MAX_RETRIES,
    TRANSIENT_FAILURES,
    WORKFLOW_NODES,
    NodeHandler,
    NodeHandlers,
    TraceEntry,
    WorkflowError,
    WorkflowFailure,
    WorkflowOptions,
)


def _append(left: list[Any], right: list[Any]) -> list[Any]:
    return [*left, *right]


def _merge(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return {**left, **right}


def _replace(_left: Any, right: Any) -> Any:
    return right


class InvestigationState(TypedDict):
    """Explicit workflow state. Dicts are merged so per-claim work can fan out; lists append."""

    investigation_id: Annotated[str, _replace]
    owner_id: Annotated[str, _replace]
    question: Annotated[str, _replace]
    status: Annotated[str, _replace]
    claims: Annotated[list[Any], _replace]
    evidence_by_claim: Annotated[dict[str, Any], _merge]
    assessments: Annotated[dict[str, Any], _merge]
    outcomes: Annotated[dict[str, Any], _merge]
    #: Retrieved document text by normalized URL: ground truth for provenance checks.
    ledger: Annotated[dict[str, str], _merge]
    #: Evidence that passed validation and was persisted, with real ids.
    persisted_evidence: Annotated[dict[str, Any], _merge]
    evaluations: Annotated[dict[str, Any], _merge]
    #: Evidence that already existed when the run started; anything else is NEW evidence.
    prior_evidence_ids: Annotated[list[str], _replace]
    summary: Annotated[str | None, _replace]
    trace: Annotated[list[TraceEntry], _append]
    failures: Annotated[list[WorkflowFailure], _append]


def initial_state(investigation_id: str, owner_id: str, question: str = "") -> InvestigationState:
    return {
        "investigation_id": investigation_id,
        "owner_id": owner_id,
        "question": question,
        "status": "RUNNING",
        "claims": [],
        "evidence_by_claim": {},
        "assessments": {},
        "outcomes": {},
        "ledger": {},
        "persisted_evidence": {},
        "evaluations": {},
        "prior_evidence_ids": [],
        "summary": None,
        "trace": [],
        "failures": [],
    }


def _noop_handlers() -> dict[str, NodeHandler]:
    async def noop(_state: Mapping[str, Any]) -> dict[str, Any]:
        return {}

    return {node: noop for node in WORKFLOW_NODES}


#: Placeholder handlers fabricate nothing: every node is a no-op, so a run that uses them produces no
#: claims, evidence or states.
placeholder_handlers: NodeHandlers = _noop_handlers()


def _now_iso(now: Any) -> str:
    moment = now() if now else datetime.now(UTC)
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _wrap(node: str, handler: NodeHandler, options: WorkflowOptions) -> Any:
    max_retries = options.max_retries

    async def run(state: InvestigationState) -> dict[str, Any]:
        trace: list[TraceEntry] = []

        def record(attempt: int, outcome: str, detail: str | None = None) -> None:
            entry = TraceEntry(
                node=node, attempt=attempt, outcome=outcome,  # type: ignore[arg-type]
                at=_now_iso(options.now), investigation_id=state["investigation_id"], detail=detail,
            )
            trace.append(entry)
            if options.log:
                options.log(entry)

        attempt = 0
        while True:
            attempt += 1
            try:
                update = await handler(state)
                record(attempt, "OK")
                return {**update, "trace": trace}
            except Exception as error:
                failure = error if isinstance(error, WorkflowError) else WorkflowError("WORKFLOW", "Unexpected node failure.")
                retryable = failure.kind in TRANSIENT_FAILURES and attempt <= max_retries
                record(attempt, "RETRY" if retryable else "FAILED", failure.kind)
                if not retryable:
                    return {
                        "status": "FAILED",
                        "trace": trace,
                        "failures": [WorkflowFailure(node=node, kind=failure.kind, message=failure.message)],
                    }

    return run


def build_investigation_graph(handlers: NodeHandlers | None = None, options: WorkflowOptions | None = None) -> Any:
    """Builds the linear graph; a failed node ends the run with an explicit FAILED status."""
    opts = options or WorkflowOptions()
    chosen = handlers if handlers is not None else placeholder_handlers
    graph = StateGraph(InvestigationState)
    for node in WORKFLOW_NODES:
        graph.add_node(node, _wrap(node, chosen[node], opts))
    graph.add_edge(START, WORKFLOW_NODES[0])
    for index, node in enumerate(WORKFLOW_NODES):
        following = WORKFLOW_NODES[index + 1] if index + 1 < len(WORKFLOW_NODES) else None

        def route(state: InvestigationState, following: str | None = following) -> str:
            return END if state["status"] == "FAILED" or following is None else following

        graph.add_conditional_edges(node, route, [*([following] if following else []), END])
    return graph.compile(checkpointer=MemorySaver())


async def run_investigation(
    graph: Any, *, investigation_id: str, owner_id: str, question: str = "", thread_id: str | None = None
) -> dict[str, Any]:
    """Runs to the end; `thread_id` makes the run checkpointable."""
    config = {"configurable": {"thread_id": thread_id or investigation_id}}
    result: dict[str, Any] = await graph.ainvoke(initial_state(investigation_id, owner_id, question), config)
    if result["status"] == "FAILED":
        return result
    # COMPLETED only when every node ran and nothing failed; otherwise the run is explicitly PARTIAL.
    ran_all = all(any(t.node == n and t.outcome == "OK" for t in result["trace"]) for n in WORKFLOW_NODES)
    return {**result, "status": "COMPLETED" if ran_all and not result["failures"] else "PARTIAL"}


__all__ = [
    "DEFAULT_MAX_RETRIES", "InvestigationState", "build_investigation_graph", "initial_state",
    "placeholder_handlers", "run_investigation",
]
