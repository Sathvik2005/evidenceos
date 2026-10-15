"""Vercel `backend` service entry point: every /api/* request is served by the EvidenceOS FastAPI application.

Configuration comes from environment variables (see docs/DEPLOYMENT.md). If it is wrong, the function answers
503 with a generic message instead of crashing, and never echoes a value.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from evidenceos.server.app import create_app

try:
    app = create_app()
except Exception:  # misconfiguration, e.g. DATABASE_URL missing
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def not_configured(path: str) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": "INTERNAL_ERROR", "message": "The server is not configured correctly."}},
            status_code=503,
            headers={"cache-control": "no-store"},
        )
