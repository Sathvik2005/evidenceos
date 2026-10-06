"""Local, no-keys development server: the real HTTP API over an embedded PostgreSQL, seeded with the demo data.

    npm run dev:api             (or: python -m evidenceos.cli.devserver)
    then, in another terminal:  npm run dev --workspace=@evidenceos/frontend
    POST /dev/advance           reveals the seeded "new evidence" (development only, 127.0.0.1 only)

Research is reported as unavailable (no provider keys); reads work. To start over, stop the server and delete
the `.data/` folder. The embedded PostgreSQL comes from the optional `pgserver` development dependency.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from ..db import PsycopgDatabase
from ..operations import list_investigations
from ..server.adapters.recorded import load_corpus
from ..server.app import create_app, serve
from ..server.config import ServerConfig
from ..server.http import DemoRef
from ..server.seed import seed_advance, seed_initial
from .migrate import apply_migrations

ROOT = Path(__file__).resolve().parents[3]
OWNER = "seed-owner"
PORT = int(os.environ.get("PORT", "8787"))


def build_dev_app() -> FastAPI:
    import pgserver  # development dependency; imported lazily so production never needs it

    data = ROOT / ".data" / "postgres"
    data.mkdir(parents=True, exist_ok=True)
    server = pgserver.get_server(str(data), cleanup_mode="stop")
    url = server.get_uri()
    apply_migrations(url)
    corpus = load_corpus(ROOT / "demo" / "corpus.json")
    db = PsycopgDatabase(url)
    app = create_app(config=ServerConfig("development", url, None, None, None), db=db)
    state: dict[str, str] = {}

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        await db.open()
        existing = await list_investigations(db, OWNER)
        state["id"] = existing.data[0]["id"] if existing.ok and existing.data else await seed_initial(db, OWNER, corpus)
        application.state.deps.demo = DemoRef(state["id"], OWNER)
        print(f"demo investigation {state['id']}", flush=True)
        try:
            yield
        finally:
            await db.close()

    app.router.lifespan_context = lifespan

    @app.post("/dev/advance")
    async def advance() -> dict[str, dict[str, bool]]:
        await seed_advance(db, OWNER, state["id"], corpus)
        return {"data": {"advanced": True}}

    return app


def main() -> None:
    print(f"EvidenceOS dev API on http://127.0.0.1:{PORT}  (research disabled: no provider keys)", flush=True)
    serve(build_dev_app(), host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()
