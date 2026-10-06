"""The recorded demo corpus and the seed: the signature PARTIALLY_SUPPORTED -> CONFLICTING moment on real documents.

Only the model is scripted. Documents, validation, persistence and change detection are the product's own.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from evidenceos.agents.llm import LlmRequest
from evidenceos.agents.research_agent import sanitize_documents
from evidenceos.db import PsycopgDatabase
from evidenceos.operations import create_investigation, list_claims, list_evidence, list_evidence_changes, list_sources
from evidenceos.server.adapters.recorded import RecordedSearch, load_corpus
from evidenceos.server.seed import seed_advance, seed_initial
from evidenceos.text import normalize_url
from evidenceos.workflow.handlers import WorkflowDeps
from evidenceos.workflow.run import run_investigation_workflow

from .helpers import FixtureLlm

CORPUS_PATH = Path(__file__).resolve().parents[2] / "demo" / "corpus.json"
CORPUS = load_corpus(CORPUS_PATH)


class TestRecordedCorpus:
    def test_contains_only_well_formed_https_dated_documents_that_survive_provider_hygiene(self) -> None:
        documents = [d.document for d in CORPUS]
        assert len(sanitize_documents(documents)) == len(documents)
        assert all(d.url.startswith("https://") for d in documents)
        assert all(item.phase in (1, 2) for item in CORPUS)

    async def test_reveals_the_new_evidence_only_at_phase_2(self) -> None:
        assert len((await RecordedSearch(CORPUS, 1).search("q")).documents) == 1
        assert len((await RecordedSearch(CORPUS, 2).search("q")).documents) == 3


def corpus_research(request: LlmRequest) -> dict[str, Any]:
    candidates = []
    for match in re.finditer(r'<document index="(\d+)">\n(.*?)\n</document>', request.user, re.DOTALL):
        text = match.group(2)
        first_sentence = re.split(r"(?<=\.)\s", text)[0]
        relationship = "PARTIALLY_SUPPORTS" if "modestly better" in text else "CONTRADICTS"
        candidates.append({"documentIndex": int(match.group(1)), "excerpt": first_sentence, "relationship": relationship, "strength": "MODERATE"})
    return {"candidates": candidates}


async def test_partially_supported_then_new_evidence_then_conflicting_with_real_excerpts_and_a_recorded_trigger(
    db: PsycopgDatabase,
) -> None:
    created = await create_investigation(db, "demo", question="Does remote learning improve student outcomes?")
    assert created.ok
    inv = created.data["id"]
    llm = FixtureLlm(
        claims=["Remote learning changes student academic outcomes compared with in-person instruction"], research=corpus_research
    )

    async def run(phase: int) -> dict[str, Any]:
        deps = WorkflowDeps(db=db, llm=llm, search=RecordedSearch(CORPUS, phase))
        return await run_investigation_workflow(deps, investigation_id=inv, owner_id="demo")

    async def state_of() -> Any:
        return (await db.query("SELECT state FROM claims WHERE investigation_id = $1", [inv]))[0]["state"]

    assert (await run(1))["status"] == "COMPLETED"
    assert await state_of() == "PARTIALLY_SUPPORTED"
    assert (await run(2))["status"] == "COMPLETED"
    assert await state_of() == "CONFLICTING"

    rows = await db.query(
        """SELECT ch.previous_state, ch.new_state, e.excerpt, s.url FROM evidence_changes ch
           JOIN evidence e ON e.id = ch.triggering_evidence_id JOIN sources s ON s.id = e.source_id
           WHERE ch.investigation_id = $1""",
        [inv],
    )
    assert len(rows) == 1
    assert (rows[0]["previous_state"], rows[0]["new_state"]) == ("PARTIALLY_SUPPORTED", "CONFLICTING")
    # The trigger is a real, retrieved contradicting source, not an invented one.
    assert any(normalize_url(c.document.url) == rows[0]["url"] and rows[0]["excerpt"] in c.document.text for c in CORPUS)
    assert "sri.com" not in rows[0]["url"]


async def test_the_seed_writes_real_records_through_the_hard_rules_and_is_idempotent(db: PsycopgDatabase) -> None:
    inv = await seed_initial(db, "seed-owner", CORPUS)
    assert await seed_initial(db, "seed-owner", CORPUS) == inv  # re-running creates nothing new

    claims = (await list_claims(db, "seed-owner", inv)).data
    assert [(c["ordinal"], c["state"], c["confidence"]) for c in claims] == [
        (1, "PARTIALLY_SUPPORTED", "LOW"), (2, "INSUFFICIENT", "LOW")
    ]
    assert (await list_evidence_changes(db, "seed-owner", inv)).data == []  # first assessments are not changes
    assert len((await list_evidence(db, "seed-owner", inv)).data) == 1
    assert (await db.query("SELECT status FROM investigations WHERE id = $1", [inv]))[0]["status"] == "READY"

    await seed_advance(db, "seed-owner", inv, CORPUS)
    await seed_advance(db, "seed-owner", inv, CORPUS)  # advancing twice adds no second change
    claims = (await list_claims(db, "seed-owner", inv)).data
    assert (claims[0]["state"], claims[0]["confidence"]) == ("CONFLICTING", "MEDIUM")
    changes = (await list_evidence_changes(db, "seed-owner", inv)).data
    assert [(c["previousState"], c["newState"]) for c in changes] == [("PARTIALLY_SUPPORTED", "CONFLICTING")]
    evidence = (await list_evidence(db, "seed-owner", inv)).data
    assert sorted(e["relationship"] for e in evidence) == ["CONTRADICTS", "CONTRADICTS", "PARTIALLY_SUPPORTS"]
    assert all(e["reasoning"].startswith("Seed fixture") for e in evidence)  # authored data is labelled as such
    assert len((await list_sources(db, "seed-owner", inv)).data) == 3
