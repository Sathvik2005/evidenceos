"""Test fixtures: a real PostgreSQL (embedded, via pgserver) with the repository migrations applied.

One server per test session; each test gets its own database cloned from a migrated template, so tests are
isolated and the migrations run once.
"""

from __future__ import annotations

import itertools
import shutil
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pgserver
import psycopg
import pytest
import pytest_asyncio
from psycopg.conninfo import make_conninfo

from evidenceos.db import PsycopgDatabase, use_selector_event_loop_on_windows

use_selector_event_loop_on_windows()

MIGRATIONS = Path(__file__).resolve().parents[2] / "database" / "migrations"
_names = itertools.count(1)


@pytest.fixture(scope="session")
def pg_uri() -> Iterator[str]:
    data = tempfile.mkdtemp(prefix="evidenceos-pg-")
    server = pgserver.get_server(data, cleanup_mode="stop")
    admin = server.get_uri()
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute("CREATE DATABASE template_evidenceos")
    template = make_conninfo(admin, dbname="template_evidenceos")
    with psycopg.connect(template, autocommit=True) as conn:
        for path in sorted(MIGRATIONS.glob("*.sql")):
            conn.execute(path.read_text(encoding="utf-8"))
    yield admin
    server.cleanup()
    shutil.rmtree(data, ignore_errors=True)  # the WAL alone is tens of MB; never leave data directories behind


async def create_test_database(pg_uri: str) -> tuple[PsycopgDatabase, str]:
    """A fresh database cloned from the migrated template. Returns it and its name (see drop_test_database)."""
    name = f"t{next(_names)}"
    with psycopg.connect(pg_uri, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}" TEMPLATE template_evidenceos')
    database = PsycopgDatabase(make_conninfo(pg_uri, dbname=name))
    await database.open()
    return database, name


async def drop_test_database(pg_uri: str, database: PsycopgDatabase, name: str) -> None:
    await database.close()
    with psycopg.connect(pg_uri, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest_asyncio.fixture
async def db(pg_uri: str) -> AsyncIterator[PsycopgDatabase]:
    database, name = await create_test_database(pg_uri)
    try:
        yield database
    finally:
        await drop_test_database(pg_uri, database, name)


# ---- harness reporting --------------------------------------------------------------------------------------
# When EVIDENCEOS_HARNESS_JSON names a file, every test outcome is written there with its markers so
# scripts/run-harness.mjs can tell a hard-rule failure from a semantic regression or tolerated variance.
_results: list[dict[str, object]] = []


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    if report.when == "call" or (report.when == "setup" and report.outcome != "passed"):
        markers = [m for m in ("hard", "variance", "failure") if m in getattr(report, "keywords", {})]
        detail = ""
        if report.failed and report.longrepr is not None:
            detail = str(getattr(getattr(report.longrepr, "reprcrash", None), "message", report.longrepr))[:300]
        _results.append({"id": report.nodeid, "outcome": report.outcome, "markers": markers, "detail": detail, "phase": report.when})


def pytest_sessionfinish(session: pytest.Session) -> None:
    import json
    import os

    target = os.environ.get("EVIDENCEOS_HARNESS_JSON")
    if target:
        Path(target).write_text(json.dumps({"exitstatus": int(session.exitstatus), "results": _results}), encoding="utf-8")
