"""Entry point that runs the full investigation workflow."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from ..operations import set_investigation_status
from .graph import build_investigation_graph, run_investigation
from .handlers import WorkflowDeps, create_workflow_handlers
from .types import WorkflowOptions


async def run_investigation_workflow(
    deps: WorkflowDeps, *, investigation_id: str, owner_id: str, question: str = "", options: WorkflowOptions | None = None
) -> dict[str, Any]:
    """Runs the full workflow. A failed run is persisted as ERROR; partial progress already saved is kept."""
    opts = replace(options or WorkflowOptions(), max_retries=deps.max_retries)
    graph = build_investigation_graph(create_workflow_handlers(deps), opts)
    result = await run_investigation(graph, investigation_id=investigation_id, owner_id=owner_id, question=question)
    if result["status"] == "FAILED":
        # Best effort: if even this write fails, the FAILED snapshot is still returned to the caller.
        await set_investigation_status(deps.db, owner_id, investigation_id, "ERROR")
    return result
