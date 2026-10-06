"""The API returns exactly the record shapes the frontend expects (frontend/tests/fixtures/wire.json)."""

from __future__ import annotations

import json
from pathlib import Path

from evidenceos.db import PsycopgDatabase
from evidenceos.operations import get_investigation, list_claims, list_evidence, list_evidence_changes, list_sources
from evidenceos.server.seed import seed_advance, seed_initial

from .test_demo import CORPUS

WIRE = json.loads((Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "wire.json").read_text(encoding="utf-8"))


async def test_every_record_type_has_exactly_the_keys_the_frontend_expects(db: PsycopgDatabase) -> None:
    inv = await seed_initial(db, "wire-owner", CORPUS)
    await seed_advance(db, "wire-owner", inv, CORPUS)  # produces a change record as well

    def keys(record: dict[str, object]) -> list[str]:
        return sorted(record)

    investigation = (await get_investigation(db, "wire-owner", inv)).data
    claims = (await list_claims(db, "wire-owner", inv)).data
    sources = (await list_sources(db, "wire-owner", inv)).data
    evidence = (await list_evidence(db, "wire-owner", inv)).data
    changes = (await list_evidence_changes(db, "wire-owner", inv)).data

    assert keys(investigation) == sorted(WIRE["investigation"])
    assert keys(claims[0]) == sorted(WIRE["claim"])
    assert keys(sources[0]) == sorted(WIRE["source"])
    assert keys(evidence[0]) == sorted(WIRE["evidence"])
    assert keys(changes[0]) == sorted(WIRE["change"])
