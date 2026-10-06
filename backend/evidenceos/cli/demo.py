"""Demo driver: real workflow runs over recorded, verified source documents (demo/corpus.json).

    python -m evidenceos.cli.demo seed       creates the demo investigation and runs the first research pass
    python -m evidenceos.cli.demo advance    makes the recorded NEW evidence available and re-runs the workflow

Nothing is edited by hand: every state, evidence row and history entry is produced by the product. Needs
DATABASE_URL, ANTHROPIC_API_KEY and DEMO_OWNER_ID (and DEMO_INVESTIGATION_ID for `advance`).
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from ..db import PsycopgDatabase, use_selector_event_loop_on_windows
from ..operations import create_investigation, get_investigation, list_claims, list_evidence_changes
from ..server.adapters.anthropic_llm import AnthropicLlm
from ..server.adapters.recorded import RecordedSearch, load_corpus
from ..server.config import DEFAULT_LLM_MODEL
from ..workflow.handlers import WorkflowDeps
from ..workflow.run import run_investigation_workflow
from ..workflow.types import TraceEntry, WorkflowOptions

CORPUS = Path(__file__).resolve().parents[3] / "demo" / "corpus.json"
QUESTION = "Does remote learning improve student outcomes?"


def need(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"Missing required environment variable {name}.", file=sys.stderr)
        raise SystemExit(2)
    return value


async def run(command: str | None) -> int:
    db = PsycopgDatabase(need("DATABASE_URL"))
    llm = AnthropicLlm(need("ANTHROPIC_API_KEY"), os.environ.get("LLM_MODEL") or DEFAULT_LLM_MODEL)
    owner = need("DEMO_OWNER_ID")
    corpus = load_corpus(CORPUS)
    await db.open()

    async def execute(investigation_id: str, phase: int) -> None:
        def trace(entry: TraceEntry) -> None:
            print(f"  {entry.node} ({entry.outcome})")

        result = await run_investigation_workflow(
            WorkflowDeps(db=db, llm=llm, search=RecordedSearch(corpus, phase)),
            investigation_id=investigation_id, owner_id=owner, options=WorkflowOptions(log=trace),
        )
        failures = result["failures"]
        print(f"run status: {result['status']}{f', {len(failures)} failure(s)' if failures else ''}")
        for failure in failures:
            print(f"  - [{failure.node}] {failure.kind}: {failure.message}")
        claims = await list_claims(db, owner, investigation_id)
        if claims.ok:
            for claim in claims.data:
                print(f"  claim {claim['ordinal']}: {claim['state'] or 'not assessed'} ({claim['confidence'] or '-'}) {claim['statement']}")

    try:
        if command == "seed":
            created = await create_investigation(db, owner, question=QUESTION, idempotency_key="demo-v1")
            if not created.ok:
                raise RuntimeError(created.error.message)  # type: ignore[union-attr]
            print(f"demo investigation {created.data['id']}")
            await execute(created.data["id"], 1)
            print(f"\nSet DEMO_INVESTIGATION_ID={created.data['id']} (and DEMO_OWNER_ID) in the deployment environment.")
        elif command == "advance":
            investigation_id = need("DEMO_INVESTIGATION_ID")
            existing = await get_investigation(db, owner, investigation_id)
            if not existing.ok:
                raise RuntimeError(existing.error.message)  # type: ignore[union-attr]
            await execute(investigation_id, 2)
            changes = await list_evidence_changes(db, owner, investigation_id)
            if changes.ok and changes.data:
                for change in changes.data:
                    print(f"  change: {change['previousState']} -> {change['newState']}")
            else:
                print("  no state change was recorded (the model did not change any claim state this time)")
        else:
            print("Usage: python -m evidenceos.cli.demo seed | advance", file=sys.stderr)
            return 2
        return 0
    except Exception as error:
        print(str(error) or "demo command failed", file=sys.stderr)
        return 1
    finally:
        await db.close()


def main() -> int:
    use_selector_event_loop_on_windows()
    return asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else None))


if __name__ == "__main__":
    raise SystemExit(main())
