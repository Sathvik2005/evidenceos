"""Typed contracts and validators for the EvidenceOS persistence API.

Enum values mirror database/migrations/001_initial_schema.sql. Records are plain dicts with the
camelCase keys the HTTP API returns, so there is one representation from database to browser.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Generic, TypeVar
from urllib.parse import urlsplit

CLAIM_STATES = ("SUPPORTED", "PARTIALLY_SUPPORTED", "CONFLICTING", "INSUFFICIENT")
CONFIDENCE_LEVELS = ("HIGH", "MEDIUM", "LOW")
EVIDENCE_RELATIONSHIPS = ("SUPPORTS", "CONTRADICTS", "PARTIALLY_SUPPORTS", "INSUFFICIENT")
EVIDENCE_STRENGTHS = ("STRONG", "MODERATE", "WEAK")
SOURCE_TYPES = ("WEB_PAGE", "JOURNAL_ARTICLE", "BOOK", "REPORT", "DATASET", "OTHER")
INVESTIGATION_STATUSES = ("CREATED", "RESEARCHING", "ANALYZING", "READY", "REVIEW_REQUIRED", "ERROR")

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 25

# Error codes, as documented in docs/api-contracts.md.
VALIDATION_FAILED = "VALIDATION_FAILED"
NOT_FOUND = "NOT_FOUND"
REFERENCE_INVALID = "REFERENCE_INVALID"
CONFLICT = "CONFLICT"
IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
CONSTRAINT_VIOLATION = "CONSTRAINT_VIOLATION"
INTERNAL_ERROR = "INTERNAL_ERROR"

T = TypeVar("T")


@dataclass(frozen=True)
class ApiError:
    code: str
    message: str
    field: str | None = None

    def to_json(self) -> dict[str, str]:
        out = {"code": self.code, "message": self.message}
        if self.field is not None:
            out["field"] = self.field
        return out


@dataclass(frozen=True)
class ApiResult(Generic[T]):
    """Either `data` (ok) or `error`. Every operation returns one of these; none raises for expected failures."""

    ok: bool
    data: T | None = None
    error: ApiError | None = None


def ok(data: T) -> ApiResult[T]:
    return ApiResult(True, data=data)


def fail(code: str, message: str, field: str | None = None) -> ApiResult[Any]:
    return ApiResult(False, error=ApiError(code, message, field))


def invalid(field: str, message: str) -> ApiResult[Any]:
    return fail(VALIDATION_FAILED, message, field)


_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def check_text(value: object, field: str, max_length: int = 4000) -> ApiResult[Any]:
    if not isinstance(value, str) or len(value.strip()) == 0:
        return invalid(field, f"{field} must be a non-empty string.")
    if len(value) > max_length:
        return invalid(field, f"{field} must be at most {max_length} characters.")
    return ok(value.strip())


def check_optional_text(value: object, field: str, max_length: int = 4000) -> ApiResult[Any]:
    return ok(None) if value is None else check_text(value, field, max_length)


def check_uuid(value: object, field: str) -> ApiResult[Any]:
    if isinstance(value, str) and _UUID.match(value):
        return ok(value.lower())
    return invalid(field, f"{field} must be a UUID.")


def check_enum(value: object, allowed: tuple[str, ...], field: str) -> ApiResult[Any]:
    if isinstance(value, str) and value in allowed:
        return ok(value)
    return invalid(field, f"{field} must be one of: {', '.join(allowed)}.")


def check_http_url(value: object, field: str) -> ApiResult[Any]:
    text = check_text(value, field, 2048)
    if not text.ok:
        return text
    try:
        parts = urlsplit(text.data)
        valid = parts.scheme in ("http", "https") and bool(parts.hostname) and not parts.username and not parts.password
    except ValueError:
        valid = False
    return text if valid else invalid(field, f"{field} must be an http(s) URL without credentials.")


def check_page(limit: object = None, offset: object = None) -> ApiResult[Any]:
    lim = DEFAULT_PAGE_SIZE if limit is None else limit
    off = 0 if offset is None else offset
    if isinstance(lim, bool) or not isinstance(lim, int) or lim < 1 or lim > MAX_PAGE_SIZE:
        return invalid("limit", f"limit must be an integer between 1 and {MAX_PAGE_SIZE}.")
    if isinstance(off, bool) or not isinstance(off, int) or off < 0:
        return invalid("offset", "offset must be a non-negative integer.")
    return ok((lim, off))


def is_iso_datetime(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def first_error(*results: ApiResult[Any]) -> ApiResult[Any] | None:
    for result in results:
        if not result.ok:
            return result
    return None
