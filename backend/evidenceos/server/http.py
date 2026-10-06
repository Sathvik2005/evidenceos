"""Framework-agnostic HTTP API over the typed operations. Server-side only.

`handle_api_request` takes plain values and returns an `ApiResponse`, so it runs the same behind FastAPI, a
serverless function, or a test. Identity is an anonymous HttpOnly cookie that scopes every record and grants
nothing else.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from ..contracts import ApiError, ApiResult, fail
from ..db import Database
from ..operations import (
    claim_investigation_run,
    create_investigation,
    get_investigation,
    list_claims,
    list_evidence,
    list_evidence_changes,
    list_sources,
)

STATUS_BY_CODE = {
    "VALIDATION_FAILED": 400,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "IDEMPOTENCY_CONFLICT": 409,
    "REFERENCE_INVALID": 422,
    "CONSTRAINT_VIOLATION": 422,
    "INTERNAL_ERROR": 500,
}

COOKIE = "eos_uid"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
MAX_BODY_CHARS = 16 * 1024
#: A run with no status progress for this long is treated as abandoned and may be resumed.
STALE_RUN_MINUTES = 10
BASE_HEADERS = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
}

StartWorkflow = Callable[[str, str], Awaitable[None]]


@dataclass(frozen=True)
class DemoRef:
    investigation_id: str
    owner_id: str


@dataclass
class ApiDeps:
    db: Database
    #: Runs the workflow; scheduled to execute after the response is sent.
    start_workflow: StartWorkflow
    #: When set, this investigation (owned by demo.owner_id) is readable, never writable, by everyone.
    demo: DemoRef | None = None
    secure_cookies: bool = False
    #: False when model or retrieval credentials are missing: runs are refused up front, honestly.
    research_available: bool = True
    log: Callable[[dict[str, Any]], None] | None = None


@dataclass
class ApiResponse:
    status: int
    body: Any
    headers: dict[str, str] = field(default_factory=dict)
    #: Coroutines to run after the response is sent.
    background: list[Awaitable[None]] = field(default_factory=list)

    def encoded(self) -> bytes:
        return json.dumps(self.body).encode("utf-8")


def _json(status: int, body: Any, extra: Mapping[str, str] | None = None) -> ApiResponse:
    return ApiResponse(status, body, {**BASE_HEADERS, **(extra or {})})


def _api_error(error: ApiError, extra: Mapping[str, str] | None = None) -> ApiResponse:
    # Internal details never reach the client: only the code, message and offending field.
    return _json(STATUS_BY_CODE[error.code], {"error": error.to_json()}, extra)


def read_cookie(header: str | None) -> str | None:
    for part in (header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE:
            return value.lower() if _UUID.match(value) else None
    return None


def read_json(content_type: str | None, raw: bytes) -> ApiResult[Any]:
    if "application/json" not in (content_type or ""):
        return fail("VALIDATION_FAILED", "Content-Type must be application/json.")
    text = raw.decode("utf-8", errors="replace")
    if len(text) > MAX_BODY_CHARS:
        return fail("VALIDATION_FAILED", "The request body is too large.")
    try:
        parsed = json.loads(text)
    except ValueError:
        parsed = None
    if isinstance(parsed, dict):
        return ApiResult(True, data=parsed)
    return fail("VALIDATION_FAILED", "The request body must be a JSON object.")


def same_origin(origin: str | None, host: str) -> bool:
    """Blocks cross-site writes: cookies identify the caller, so a foreign Origin must not mutate."""
    if not origin:
        return True
    try:
        return urlsplit(origin).netloc == host
    except ValueError:
        return False


def _page(query: Mapping[str, str]) -> tuple[Any, Any]:
    def number(raw: str) -> Any:
        try:
            return int(raw)
        except ValueError:
            return raw  # not an integer: the page check rejects it with the offending field

    limit = query.get("limit")
    offset = query.get("offset")
    return (100 if limit is None else number(limit)), (None if offset is None else number(offset))


def _not_allowed(cookie: Mapping[str, str]) -> ApiResponse:
    return _json(405, {"error": {"code": "VALIDATION_FAILED", "message": "Method not allowed."}}, cookie)


async def handle_api_request(
    *,
    method: str,
    path: str,
    query: Mapping[str, str],
    headers: Mapping[str, str],
    body: bytes,
    host: str,
    deps: ApiDeps,
) -> ApiResponse:
    started = time.monotonic()
    path = re.sub(r"/+$", "", re.sub(r"^/api", "", path)) or "/"
    segments = [s for s in path.split("/") if s]

    # Identity: an anonymous, HttpOnly per-browser id. It scopes every record; it grants nothing else.
    existing = read_cookie(headers.get("cookie"))
    owner_id = existing or str(uuid.uuid4())
    cookie: dict[str, str] = {}
    if not existing:
        secure = "; Secure" if deps.secure_cookies else ""
        cookie = {"set-cookie": f"{COOKIE}={owner_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000{secure}"}

    def respond(response: ApiResponse) -> ApiResponse:
        if deps.log:
            deps.log({"evt": "api", "method": method, "path": path, "status": response.status, "ms": round((time.monotonic() - started) * 1000)})
        return response

    try:
        if path == "/health":
            if method != "GET":
                return respond(_json(405, {"error": {"code": "VALIDATION_FAILED", "message": "Method not allowed."}}))
            try:
                await deps.db.query("SELECT 1 AS ok")
                return respond(_json(200, {"status": "ok"}))
            except Exception:
                return respond(_json(503, {"status": "unavailable"}))

        if path == "/demo":
            if method != "GET":
                return respond(_not_allowed(cookie))
            return respond(_json(200, {"data": {"investigationId": deps.demo.investigation_id if deps.demo else None}}, cookie))

        if not segments or segments[0] != "investigations":
            return respond(_json(404, {"error": {"code": "NOT_FOUND", "message": "Not found."}}, cookie))
        is_write = method == "POST"
        if method != "GET" and not is_write:
            return respond(_not_allowed(cookie))
        if is_write and not same_origin(headers.get("origin"), host):
            return respond(_json(403, {"error": {"code": "VALIDATION_FAILED", "message": "Cross-origin writes are not allowed."}}, cookie))

        # POST /investigations
        if len(segments) == 1:
            if not is_write:
                return respond(_not_allowed(cookie))
            if not deps.research_available:
                return respond(_json(503, {"error": {"code": "INTERNAL_ERROR", "message": "Research is not configured on this server, so new investigations cannot run."}}, cookie))
            parsed = read_json(headers.get("content-type"), body)
            if not parsed.ok:
                return respond(_api_error(parsed.error, cookie))  # type: ignore[arg-type]
            payload = parsed.data
            created = await create_investigation(
                deps.db, owner_id, question=payload.get("question"),
                idempotency_key=payload.get("idempotencyKey") if isinstance(payload.get("idempotencyKey"), str) else None,
            )
            if not created.ok:
                return respond(_api_error(created.error, cookie))  # type: ignore[arg-type]
            response = _json(201, {"data": created.data}, cookie)
            # A replay of an already-started request must not start a second run.
            if created.data["status"] == "CREATED":
                claimed = await claim_investigation_run(deps.db, owner_id, created.data["id"], ["CREATED"])
                if claimed.ok:
                    response.background.append(deps.start_workflow(created.data["id"], owner_id))
            return respond(response)

        investigation_id = segments[1]
        resource = segments[2] if len(segments) > 2 else None
        if len(segments) > 3:
            return respond(_json(404, {"error": {"code": "NOT_FOUND", "message": "Not found."}}, cookie))

        if resource == "refresh":
            if not is_write:
                return respond(_not_allowed(cookie))
            if not deps.research_available:
                return respond(_json(503, {"error": {"code": "INTERNAL_ERROR", "message": "Research is not configured on this server."}}, cookie))
            # Atomic: only one run can be claimed; a busy investigation is refused, not double-started.
            claimed = await claim_investigation_run(
                deps.db, owner_id, investigation_id, ["READY", "REVIEW_REQUIRED", "ERROR"], STALE_RUN_MINUTES
            )
            if not claimed.ok:
                return respond(_api_error(claimed.error, cookie))  # type: ignore[arg-type]
            response = _json(202, {"data": claimed.data}, cookie)
            response.background.append(deps.start_workflow(investigation_id, owner_id))
            return respond(response)
        if is_write:
            return respond(_not_allowed(cookie))

        limit, offset = _page(query)

        async def read(owner: str) -> ApiResult[Any]:
            if resource is None:
                return await get_investigation(deps.db, owner, investigation_id)
            readers = {
                "claims": list_claims, "evidence": list_evidence, "sources": list_sources, "changes": list_evidence_changes,
            }
            reader = readers.get(resource)
            if reader is None:
                return fail("NOT_FOUND", "Not found.")
            return await reader(deps.db, owner, investigation_id, limit, offset)

        result = await read(owner_id)
        if (
            not result.ok and result.error is not None and result.error.code == "NOT_FOUND"
            and deps.demo is not None and investigation_id.lower() == deps.demo.investigation_id.lower()
        ):
            result = await read(deps.demo.owner_id)  # the public demo is read-only for everyone
        if result.ok:
            return respond(_json(200, {"data": result.data}, cookie))
        return respond(_api_error(result.error, cookie))  # type: ignore[arg-type]
    except Exception:
        return respond(_json(500, {"error": {"code": "INTERNAL_ERROR", "message": "The operation could not be completed."}}, cookie))
