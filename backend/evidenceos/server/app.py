"""Composition root: wires configuration, adapters, the workflow and the HTTP API into a FastAPI application."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import AsyncIterator, Awaitable, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Request, Response

from ..agents.llm import LlmClient
from ..agents.research_agent import SearchProvider
from ..db import Database, PsycopgDatabase, use_selector_event_loop_on_windows
from ..operations import set_investigation_status
from ..workflow.handlers import WorkflowDeps
from ..workflow.run import run_investigation_workflow
from ..workflow.types import TraceEntry, WorkflowOptions
from .adapters.anthropic_llm import AnthropicLlm
from .adapters.tavily_search import TavilySearch
from .config import ServerConfig, read_server_config
from .http import ApiDeps, DemoRef, handle_api_request


def log(entry: dict[str, Any]) -> None:
    """One structured line per event; never contains request bodies, source text or credentials."""
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    sys.stdout.write(json.dumps({"ts": stamp, **entry}) + "\n")
    sys.stdout.flush()


async def _await(work: Awaitable[None]) -> None:
    await work


def create_app(
    env: Mapping[str, str | None] | None = None,
    *,
    config: ServerConfig | None = None,
    db: Database | None = None,
    llm: LlmClient | None = None,
    search: SearchProvider | None = None,
) -> FastAPI:
    """Builds the API. `db`, `llm` and `search` can be injected (tests, the local demo server)."""
    cfg = config or read_server_config(env if env is not None else os.environ)
    owned_pool = PsycopgDatabase(cfg.database_url) if db is None else None
    database: Database = db if db is not None else owned_pool  # type: ignore[assignment]
    model = llm if llm is not None else (AnthropicLlm(cfg.llm.api_key, cfg.llm.model) if cfg.llm else None)
    retrieval = search if search is not None else (TavilySearch(cfg.research.api_key) if cfg.research else None)

    async def run_workflow(investigation_id: str, owner_id: str) -> None:
        if model is None or retrieval is None:
            return
        try:
            def trace(entry: TraceEntry) -> None:
                log({"evt": "workflow", **entry.to_log()})

            await run_investigation_workflow(
                WorkflowDeps(db=database, llm=model, search=retrieval),
                investigation_id=investigation_id, owner_id=owner_id, options=WorkflowOptions(log=trace),
            )
        except Exception:
            log({"evt": "workflow-crash", "investigationId": investigation_id})
            await set_investigation_status(database, owner_id, investigation_id, "ERROR")

    deps = ApiDeps(
        db=database,
        start_workflow=run_workflow,
        demo=DemoRef(cfg.demo.investigation_id, cfg.demo.owner_id) if cfg.demo else None,
        secure_cookies=cfg.app_env == "production",
        research_available=bool(model and retrieval),
        log=log,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if owned_pool is not None:
            await owned_pool.open()
        try:
            yield
        finally:
            if owned_pool is not None:
                await owned_pool.close()

    app = FastAPI(title="EvidenceOS API", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.config = cfg
    app.state.deps = deps  # lets a host (e.g. the local dev server) attach the demo once it exists

    @app.api_route("/api", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def api(request: Request, background: BackgroundTasks, rest: str = "") -> Response:
        result = await handle_api_request(
            method=request.method,
            path=request.url.path,
            query=dict(request.query_params),
            headers={k.lower(): v for k, v in request.headers.items()},
            body=await request.body(),
            host=request.headers.get("host", request.url.netloc),
            deps=deps,
        )
        for work in result.background:
            background.add_task(_await, work)
        response = Response(content=result.encoded(), status_code=result.status, headers=result.headers)
        response.background = background
        return response

    return app


def serve(app: FastAPI, *, host: str, port: int) -> None:
    """Runs uvicorn on an event loop psycopg can use (Windows' default Proactor loop cannot)."""
    import asyncio

    import uvicorn

    use_selector_event_loop_on_windows()
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="warning", loop="none"))
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(server.serve())


__all__ = ["create_app", "log", "serve"]
