"""HTTP API contract tests (port of the TypeScript http-api suite), plus FastAPI wiring tests."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
import pytest_asyncio

from evidenceos.db import PsycopgDatabase
from evidenceos.operations import create_investigation, set_investigation_status
from evidenceos.server.app import create_app
from evidenceos.server.config import ServerConfig
from evidenceos.server.http import ApiDeps, ApiResponse, DemoRef, handle_api_request

from .conftest import create_test_database, drop_test_database
from .helpers import Corpus, FixtureLlm

DEMO_OWNER = "11111111-1111-4111-8111-111111111111"
STRANGER = "eos_uid=22222222-2222-4222-8222-222222222222"
HOST = "evidenceos.example"


@dataclass
class Api:
    db: PsycopgDatabase
    demo_id: str
    started: list[tuple[str, str]] = field(default_factory=list)

    def deps(self, **overrides: Any) -> ApiDeps:
        async def start(investigation_id: str, owner_id: str) -> None:
            self.started.append((investigation_id, owner_id))

        base = ApiDeps(db=self.db, start_workflow=start, demo=DemoRef(self.demo_id, DEMO_OWNER))
        for key, value in overrides.items():
            setattr(base, key, value)
        return base

    async def call(
        self, path: str, *, method: str = "GET", body: Any = None, raw: bytes | None = None, cookie: str | None = None,
        headers: dict[str, str] | None = None, deps: ApiDeps | None = None,
    ) -> ApiResponse:
        payload = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        all_headers = {**({"content-type": "application/json"} if payload else {}), **({"cookie": cookie} if cookie else {}), **(headers or {})}
        response = await handle_api_request(
            method=method, path=f"/api{path}", query={}, headers=all_headers, body=payload, host=HOST, deps=deps or self.deps()
        )
        for work in response.background:  # the real app runs these after the response
            await work
        return response

    async def post(self, path: str, body: Any, cookie: str | None = None, headers: dict[str, str] | None = None) -> ApiResponse:
        return await self.call(path, method="POST", body=body, cookie=cookie, headers=headers)


def cookie_of(response: ApiResponse) -> str:
    return response.headers.get("set-cookie", "").split(";")[0]


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def api(pg_uri: str) -> AsyncIterator[Api]:
    database, name = await create_test_database(pg_uri)
    try:
        demo = await create_investigation(database, DEMO_OWNER, question="Public demo question?")
        assert demo.ok
        yield Api(database, demo.data["id"])
    finally:
        await drop_test_database(pg_uri, database, name)


async def test_reports_health_and_degrades_honestly_when_the_database_is_down(api: Api) -> None:
    assert (await api.call("/health")).status == 200

    class Broken:
        async def query(self, sql: str, params: Any = None) -> list[dict[str, Any]]:
            raise RuntimeError("connection refused to postgres://user:secret@host")

    broken = await api.call("/health", deps=api.deps(db=Broken()))
    assert broken.status == 503
    assert "secret" not in broken.encoded().decode()


async def test_creates_an_investigation_assigns_an_httponly_owner_cookie_and_starts_the_workflow_once(api: Api) -> None:
    before = len(api.started)
    response = await api.post("/investigations", {"question": "Does remote learning improve student outcomes?", "idempotencyKey": "k-1"})
    assert response.status == 201
    assert "HttpOnly; SameSite=Lax" in response.headers["set-cookie"]
    created = response.body["data"]
    assert len(api.started) == before + 1

    replay = await api.post(
        "/investigations", {"question": "Does remote learning improve student outcomes?", "idempotencyKey": "k-1"}, cookie_of(response)
    )
    assert replay.status == 201
    assert replay.body["data"]["id"] == created["id"]
    assert len(api.started) == before + 1  # no second run for a replayed request


async def test_isolates_owners_another_browser_cannot_read_or_refresh_someone_elses_investigation(api: Api) -> None:
    created = await api.post("/investigations", {"question": "Private question?"})
    owner, inv = cookie_of(created), created.body["data"]["id"]
    assert (await api.call(f"/investigations/{inv}", cookie=owner)).status == 200
    assert (await api.call(f"/investigations/{inv}", cookie=STRANGER)).status == 404
    assert (await api.post(f"/investigations/{inv}/refresh", {}, STRANGER)).status == 404
    assert (await api.call(f"/investigations/{inv}/claims", cookie=STRANGER)).status == 404


async def test_serves_the_configured_demo_investigation_read_only_to_everyone(api: Api) -> None:
    assert (await api.call(f"/investigations/{api.demo_id}", cookie=STRANGER)).status == 200
    assert (await api.call(f"/investigations/{api.demo_id}/claims", cookie=STRANGER)).status == 200
    assert (await api.post(f"/investigations/{api.demo_id}/refresh", {}, STRANGER)).status == 404


async def test_refreshes_only_idle_investigations_and_refuses_a_second_concurrent_run(api: Api) -> None:
    created = await api.post("/investigations", {"question": "Refresh me?"})
    cookie, inv = cookie_of(created), created.body["data"]["id"]
    owner = cookie.split("=")[1]
    # The creation already claimed the run, so a refresh now conflicts.
    assert (await api.post(f"/investigations/{inv}/refresh", {}, cookie)).status == 409

    await set_investigation_status(api.db, owner, inv, "READY")
    before = len(api.started)
    assert (await api.post(f"/investigations/{inv}/refresh", {}, cookie)).status == 202
    assert len(api.started) == before + 1
    assert (await api.post(f"/investigations/{inv}/refresh", {}, cookie)).status == 409
    assert len(api.started) == before + 1


async def test_lets_a_stalled_run_be_resumed_but_never_one_that_is_still_making_progress(api: Api) -> None:
    created = await api.post("/investigations", {"question": "Stalled?"})
    cookie, inv = cookie_of(created), created.body["data"]["id"]
    assert (await api.post(f"/investigations/{inv}/refresh", {}, cookie)).status == 409  # fresh run: refused
    await api.db.query("ALTER TABLE investigations DISABLE TRIGGER investigations_update_updated_at")  # else it resets updated_at
    await api.db.query("UPDATE investigations SET updated_at = now() - interval '30 minutes' WHERE id = $1", [inv])
    await api.db.query("ALTER TABLE investigations ENABLE TRIGGER investigations_update_updated_at")
    before = len(api.started)
    assert (await api.post(f"/investigations/{inv}/refresh", {}, cookie)).status == 202  # abandoned run: taken over
    assert len(api.started) == before + 1


async def test_tells_the_browser_which_investigation_is_the_public_demo_or_none(api: Api) -> None:
    assert (await api.call("/demo")).body["data"]["investigationId"] == api.demo_id
    assert (await api.call("/demo", deps=api.deps(demo=None))).body["data"]["investigationId"] is None
    assert (await api.call("/demo", method="POST", body={})).status == 405


async def test_refuses_new_investigations_honestly_when_research_is_not_configured(api: Api) -> None:
    refused = await api.post("/investigations", {"question": "No keys?"})
    assert refused.status == 201  # configured in this fixture
    unconfigured = await api.call("/investigations", method="POST", body={"question": "No keys?"}, deps=api.deps(research_available=False))
    assert unconfigured.status == 503


async def test_validates_input_and_rejects_abuse_with_structured_errors(api: Api) -> None:
    empty = await api.post("/investigations", {"question": "   "})
    assert empty.status == 400 and empty.body["error"]["field"] == "question"
    assert (await api.call("/investigations", method="POST", raw=b"{not json")).status == 400
    assert (await api.call("/investigations", method="POST", raw=b"question=x", headers={"content-type": "text/plain"})).status == 400
    assert (await api.post("/investigations", {"question": "x" * 20000})).status == 400
    assert (await api.post("/investigations", {"question": "Cross-site?"}, headers={"origin": "https://evil.example"})).status == 403
    assert (await api.call("/investigations/not-a-uuid")).status == 400
    assert (await api.call("/nope")).status == 404
    assert (await api.call("/investigations", method="DELETE")).status == 405
    assert (await api.call(f"/investigations/{api.demo_id}/claims/extra/segments")).status == 404
    bad_limit = await api.call(f"/investigations/{api.demo_id}/claims?limit=abc".split("?")[0])
    assert bad_limit.status == 200  # sanity: the plain read works


async def test_never_leaks_internals_on_unexpected_failures(api: Api) -> None:
    class Exploding:
        async def query(self, sql: str, params: Any = None) -> list[dict[str, Any]]:
            raise RuntimeError('pg: password authentication failed for user "postgres"')

    response = await api.call("/investigations/11111111-1111-4111-8111-111111111111", deps=api.deps(db=Exploding()))
    assert response.status in (404, 500)
    text = response.encoded().decode()
    assert "password" not in text.lower() and "postgres" not in text.lower()


async def test_rejects_non_numeric_paging_with_the_offending_field(api: Api) -> None:
    response = await handle_api_request(
        method="GET", path=f"/api/investigations/{api.demo_id}/claims", query={"limit": "abc"},
        headers={}, body=b"", host=HOST, deps=api.deps(),
    )
    assert response.status == 400 and response.body["error"]["field"] == "limit"


# ---- FastAPI wiring: routing, cookies, headers and the background workflow -------------------------------------


@pytest_asyncio.fixture
async def client(db: PsycopgDatabase) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(config=ServerConfig("test", "unused", None, None, None), db=db, llm=FixtureLlm(), search=Corpus())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=f"http://{HOST}") as http:
        yield http


async def test_the_fastapi_app_serves_the_api_end_to_end_and_runs_the_workflow_after_the_response(client: httpx.AsyncClient) -> None:
    health = await client.get("/api/health")
    assert health.status_code == 200
    assert health.headers["cache-control"] == "no-store" and health.headers["x-content-type-options"] == "nosniff"

    created = await client.post("/api/investigations", json={"question": "Does remote learning improve student outcomes?"})
    assert created.status_code == 201
    assert "eos_uid" in created.headers["set-cookie"] and "HttpOnly" in created.headers["set-cookie"]
    inv = created.json()["data"]["id"]

    # ASGITransport waits for background tasks, so the workflow has finished by now.
    status = (await client.get(f"/api/investigations/{inv}")).json()["data"]["status"]
    assert status == "READY"
    claims = (await client.get(f"/api/investigations/{inv}/claims")).json()["data"]
    assert [c["state"] for c in claims] == ["CONFLICTING", "SUPPORTED", "INSUFFICIENT"]
    evidence = (await client.get(f"/api/investigations/{inv}/evidence")).json()["data"]
    assert sorted(e["relationship"] for e in evidence) == ["CONTRADICTS", "SUPPORTS", "SUPPORTS"]
    assert all(e["excerpt"] for e in evidence)

    other = httpx.AsyncClient(transport=client._transport, base_url=f"http://{HOST}")
    assert (await other.get(f"/api/investigations/{inv}")).status_code == 404  # another browser: no cookie
    await other.aclose()
