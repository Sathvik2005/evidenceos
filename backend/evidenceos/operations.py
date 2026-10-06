"""Server-side persistence operations. Callers are trusted to supply the authenticated `owner_id`.

Every operation validates input, scopes by owner, returns an `ApiResult` and never leaks SQL or internals.
Writes accept an idempotency key so retries and replays cannot duplicate records.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from typing import Any

from .contracts import (
    CLAIM_STATES,
    CONFIDENCE_LEVELS,
    CONFLICT,
    CONSTRAINT_VIOLATION,
    EVIDENCE_RELATIONSHIPS,
    EVIDENCE_STRENGTHS,
    IDEMPOTENCY_CONFLICT,
    INTERNAL_ERROR,
    INVESTIGATION_STATUSES,
    NOT_FOUND,
    REFERENCE_INVALID,
    SOURCE_TYPES,
    VALIDATION_FAILED,
    ApiResult,
    check_enum,
    check_http_url,
    check_optional_text,
    check_page,
    check_text,
    check_uuid,
    fail,
    first_error,
    is_iso_datetime,
    ok,
)
from .db import Database, sqlstate

Row = dict[str, Any]
Record = dict[str, Any]


def iso(value: Any) -> str:
    """JavaScript-style ISO timestamp (UTC, milliseconds, `Z`), which is what the browser parses."""
    moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    moment = moment.astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def iso_or_none(value: Any) -> str | None:
    return None if value is None else iso(value)


def to_investigation(r: Row) -> Record:
    return {
        "id": str(r["id"]), "question": r["question"], "status": r["status"],
        "createdAt": iso(r["created_at"]), "updatedAt": iso(r["updated_at"]),
    }


def to_claim(r: Row) -> Record:
    return {
        "id": str(r["id"]), "investigationId": str(r["investigation_id"]), "ordinal": r["ordinal"],
        "statement": r["statement"], "state": r["state"], "confidence": r["confidence"],
        "assessmentReason": r.get("assessment_reason"),
    }


def to_source(r: Row) -> Record:
    return {
        "id": str(r["id"]), "investigationId": str(r["investigation_id"]), "sourceType": r["source_type"],
        "url": r["url"], "title": r["title"], "publisher": r.get("publisher"),
        "publishedAt": iso_or_none(r.get("published_at")),
    }


def to_evidence(r: Row) -> Record:
    return {
        "id": str(r["id"]), "investigationId": str(r["investigation_id"]), "claimId": str(r["claim_id"]),
        "sourceId": str(r["source_id"]), "relationship": r["relationship"], "strength": r["strength"],
        "excerpt": r["excerpt"], "reasoning": r.get("reasoning"),
    }


def to_change(r: Row) -> Record:
    return {
        "id": str(r["id"]), "investigationId": str(r["investigation_id"]), "claimId": str(r["claim_id"]),
        "previousState": r["previous_state"], "newState": r["new_state"], "reason": r["reason"],
        "triggeringEvidenceId": str(r["triggering_evidence_id"]), "changedAt": iso(r["changed_at"]),
    }


def map_database_error(error: BaseException) -> ApiResult[Any]:
    """Database failures become structured errors without leaking SQL or internals."""
    match sqlstate(error):
        case "23503":
            return fail(REFERENCE_INVALID, "A referenced record does not exist or belongs to a different investigation/claim.")
        case "23505":
            return fail(CONFLICT, "A record with the same unique value already exists.")
        case "23514":
            return fail(CONSTRAINT_VIOLATION, "The request violates a data integrity rule.")
        case "22P02":
            return fail(VALIDATION_FAILED, "A value has an invalid format.")
        case _:
            return fail(INTERNAL_ERROR, "The operation could not be completed.")


async def assert_owned(db: Database, owner_id: str, investigation_id: str) -> ApiResult[Any]:
    owner = check_text(owner_id, "ownerId", 200)
    if not owner.ok:
        return owner
    try:
        rows = await db.query("SELECT 1 FROM investigations WHERE id = $1 AND owner_id = $2", [investigation_id, owner.data])
    except Exception as error:
        return map_database_error(error)
    # Same response for missing and foreign investigations so existence is not leaked.
    return ok(None) if rows else fail(NOT_FOUND, "Investigation not found.")


async def insert_once(
    *,
    idempotency_key: str | None,
    lookup: Callable[[str], Awaitable[Record | None]],
    matches: Callable[[Record], bool],
    insert: Callable[[], Awaitable[Record]],
) -> ApiResult[Record]:
    """With a key, an identical replay returns the stored record, different content is rejected, nothing is duplicated."""
    try:
        if idempotency_key is not None:
            existing = await lookup(idempotency_key)
            if existing is not None:
                if matches(existing):
                    return ok(existing)
                return fail(IDEMPOTENCY_CONFLICT, "The idempotency key was already used with different content.", "idempotencyKey")
        return ok(await insert())
    except Exception as error:
        return map_database_error(error)


def _optional_key(value: object) -> ApiResult[Any]:
    return check_optional_text(value, "idempotencyKey", 200)


async def create_investigation(
    db: Database, owner_id: str, *, question: object, idempotency_key: object = None
) -> ApiResult[Record]:
    owner = check_text(owner_id, "ownerId", 200)
    q = check_text(question, "question", 2000)
    key = _optional_key(idempotency_key)
    bad = first_error(owner, q, key)
    if bad:
        return bad

    async def lookup(k: str) -> Record | None:
        rows = await db.query("SELECT * FROM investigations WHERE owner_id = $1 AND idempotency_key = $2", [owner.data, k])
        return to_investigation(rows[0]) if rows else None

    async def insert() -> Record:
        rows = await db.query(
            "INSERT INTO investigations (owner_id, question, idempotency_key) VALUES ($1, $2, $3) RETURNING *",
            [owner.data, q.data, key.data],
        )
        return to_investigation(rows[0])

    return await insert_once(
        idempotency_key=key.data, lookup=lookup, matches=lambda e: e["question"] == q.data, insert=insert
    )


async def get_investigation(db: Database, owner_id: str, investigation_id: str) -> ApiResult[Record]:
    inv = check_uuid(investigation_id, "investigationId")
    owner = check_text(owner_id, "ownerId", 200)
    bad = first_error(inv, owner)
    if bad:
        return bad
    try:
        rows = await db.query("SELECT * FROM investigations WHERE id = $1 AND owner_id = $2", [inv.data, owner.data])
    except Exception as error:
        return map_database_error(error)
    return ok(to_investigation(rows[0])) if rows else fail(NOT_FOUND, "Investigation not found.")


async def list_investigations(
    db: Database, owner_id: str, limit: object = None, offset: object = None
) -> ApiResult[list[Record]]:
    owner = check_text(owner_id, "ownerId", 200)
    page = check_page(limit, offset)
    bad = first_error(owner, page)
    if bad:
        return bad
    lim, off = page.data
    try:
        rows = await db.query(
            "SELECT * FROM investigations WHERE owner_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3",
            [owner.data, lim, off],
        )
    except Exception as error:
        return map_database_error(error)
    return ok([to_investigation(r) for r in rows])


async def add_claim(
    db: Database, owner_id: str, *, investigation_id: object, ordinal: object, statement: object,
    idempotency_key: object = None,
) -> ApiResult[Record]:
    inv = check_uuid(investigation_id, "investigationId")
    text = check_text(statement, "statement", 2000)
    key = _optional_key(idempotency_key)
    ordinal_ok = isinstance(ordinal, int) and not isinstance(ordinal, bool) and ordinal > 0
    bad = first_error(inv, text, key) or (
        None if ordinal_ok else fail(VALIDATION_FAILED, "ordinal must be a positive integer.", "ordinal")
    )
    if bad:
        return bad
    owned = await assert_owned(db, owner_id, inv.data)
    if not owned.ok:
        return owned

    async def lookup(k: str) -> Record | None:
        rows = await db.query("SELECT * FROM claims WHERE investigation_id = $1 AND idempotency_key = $2", [inv.data, k])
        return to_claim(rows[0]) if rows else None

    async def insert() -> Record:
        rows = await db.query(
            "INSERT INTO claims (investigation_id, ordinal, statement, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING *",
            [inv.data, ordinal, text.data, key.data],
        )
        return to_claim(rows[0])

    return await insert_once(
        idempotency_key=key.data, lookup=lookup,
        matches=lambda e: e["statement"] == text.data and e["ordinal"] == ordinal, insert=insert,
    )


async def add_source(
    db: Database, owner_id: str, *, investigation_id: object, source_type: object, url: object, title: object,
    publisher: object = None, published_at: object = None, idempotency_key: object = None,
) -> ApiResult[Record]:
    inv = check_uuid(investigation_id, "investigationId")
    stype = check_enum(source_type, SOURCE_TYPES, "sourceType")
    link = check_http_url(url, "url")
    name = check_text(title, "title", 1000)
    pub = check_optional_text(publisher, "publisher", 500)
    when = check_optional_text(published_at, "publishedAt", 64)
    key = _optional_key(idempotency_key)
    bad = first_error(inv, stype, link, name, pub, when, key) or (
        fail(VALIDATION_FAILED, "publishedAt must be an ISO date-time.", "publishedAt")
        if when.ok and when.data is not None and not is_iso_datetime(when.data)
        else None
    )
    if bad:
        return bad
    owned = await assert_owned(db, owner_id, inv.data)
    if not owned.ok:
        return owned

    async def lookup(k: str) -> Record | None:
        rows = await db.query("SELECT * FROM sources WHERE investigation_id = $1 AND idempotency_key = $2", [inv.data, k])
        return to_source(rows[0]) if rows else None

    async def insert() -> Record:
        rows = await db.query(
            """INSERT INTO sources (investigation_id, source_type, url, title, publisher, published_at, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *""",
            [inv.data, stype.data, link.data, name.data, pub.data, when.data, key.data],
        )
        return to_source(rows[0])

    return await insert_once(
        idempotency_key=key.data, lookup=lookup,
        matches=lambda e: e["url"] == link.data and e["title"] == name.data and e["sourceType"] == stype.data,
        insert=insert,
    )


async def add_evidence(
    db: Database, owner_id: str, *, investigation_id: object, claim_id: object, source_id: object,
    relationship: object, strength: object, excerpt: object, reasoning: object = None,
    idempotency_key: object = None,
) -> ApiResult[Record]:
    inv = check_uuid(investigation_id, "investigationId")
    claim = check_uuid(claim_id, "claimId")
    source = check_uuid(source_id, "sourceId")
    rel = check_enum(relationship, EVIDENCE_RELATIONSHIPS, "relationship")
    stren = check_enum(strength, EVIDENCE_STRENGTHS, "strength")
    quote = check_text(excerpt, "excerpt", 8000)
    why = check_optional_text(reasoning, "reasoning", 2000)
    key = _optional_key(idempotency_key)
    bad = first_error(inv, claim, source, rel, stren, quote, why, key)
    if bad:
        return bad
    owned = await assert_owned(db, owner_id, inv.data)
    if not owned.ok:
        return owned

    async def lookup(k: str) -> Record | None:
        rows = await db.query("SELECT * FROM evidence WHERE investigation_id = $1 AND idempotency_key = $2", [inv.data, k])
        return to_evidence(rows[0]) if rows else None

    async def insert() -> Record:
        rows = await db.query(
            """INSERT INTO evidence (investigation_id, claim_id, source_id, relationship, strength, excerpt, reasoning, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *""",
            [inv.data, claim.data, source.data, rel.data, stren.data, quote.data, why.data, key.data],
        )
        return to_evidence(rows[0])

    return await insert_once(
        idempotency_key=key.data, lookup=lookup,
        matches=lambda e: e["claimId"] == claim.data and e["sourceId"] == source.data
        and e["relationship"] == rel.data and e["strength"] == stren.data and e["excerpt"] == quote.data,
        insert=insert,
    )


async def record_state_change(
    db: Database, owner_id: str, *, investigation_id: object, claim_id: object, previous_state: object,
    new_state: object, reason: object, triggering_evidence_id: object, idempotency_key: object,
) -> ApiResult[Record]:
    """Appends an immutable state-change record; the database trigger updates the claim atomically."""
    inv = check_uuid(investigation_id, "investigationId")
    claim = check_uuid(claim_id, "claimId")
    evidence = check_uuid(triggering_evidence_id, "triggeringEvidenceId")
    new = check_enum(new_state, CLAIM_STATES, "newState")
    prev = check_enum(previous_state, CLAIM_STATES, "previousState")
    why = check_text(reason, "reason", 4000)
    key = check_text(idempotency_key, "idempotencyKey", 200)
    bad = first_error(inv, claim, evidence, new, prev, why, key) or (
        fail(VALIDATION_FAILED, "newState must differ from previousState.", "newState") if previous_state == new_state else None
    )
    if bad:
        return bad
    owned = await assert_owned(db, owner_id, inv.data)
    if not owned.ok:
        return owned

    async def lookup(k: str) -> Record | None:
        rows = await db.query("SELECT * FROM evidence_changes WHERE investigation_id = $1 AND idempotency_key = $2", [inv.data, k])
        return to_change(rows[0]) if rows else None

    async def insert() -> Record:
        rows = await db.query(
            """INSERT INTO evidence_changes (investigation_id, claim_id, previous_state, new_state, reason, triggering_evidence_id, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *""",
            [inv.data, claim.data, prev.data, new.data, why.data, evidence.data, key.data],
        )
        return to_change(rows[0])

    return await insert_once(
        idempotency_key=key.data, lookup=lookup,
        matches=lambda e: e["claimId"] == claim.data and e["newState"] == new.data
        and e["previousState"] == prev.data and e["triggeringEvidenceId"] == evidence.data,
        insert=insert,
    )


async def _list_owned(
    db: Database, owner_id: str, investigation_id: str, limit: object, offset: object,
    table: str, order: str, mapper: Callable[[Row], Record],
) -> ApiResult[list[Record]]:
    inv = check_uuid(investigation_id, "investigationId")
    page = check_page(limit, offset)
    bad = first_error(inv, page)
    if bad:
        return bad
    owned = await assert_owned(db, owner_id, inv.data)
    if not owned.ok:
        return owned
    lim, off = page.data
    try:
        # `table` and `order` are internal constants, never request input.
        rows = await db.query(f"SELECT * FROM {table} WHERE investigation_id = $1 ORDER BY {order} LIMIT $2 OFFSET $3", [inv.data, lim, off])
    except Exception as error:
        return map_database_error(error)
    return ok([mapper(r) for r in rows])


async def list_claims(db: Database, owner_id: str, investigation_id: str, limit: object = None, offset: object = None) -> ApiResult[list[Record]]:
    return await _list_owned(db, owner_id, investigation_id, limit, offset, "claims", "ordinal", to_claim)


async def list_sources(db: Database, owner_id: str, investigation_id: str, limit: object = None, offset: object = None) -> ApiResult[list[Record]]:
    return await _list_owned(db, owner_id, investigation_id, limit, offset, "sources", "created_at, id", to_source)


async def list_evidence(db: Database, owner_id: str, investigation_id: str, limit: object = None, offset: object = None) -> ApiResult[list[Record]]:
    return await _list_owned(db, owner_id, investigation_id, limit, offset, "evidence", "created_at, id", to_evidence)


async def list_evidence_changes(db: Database, owner_id: str, investigation_id: str, limit: object = None, offset: object = None) -> ApiResult[list[Record]]:
    return await _list_owned(db, owner_id, investigation_id, limit, offset, "evidence_changes", "changed_at, id", to_change)


async def set_investigation_status(db: Database, owner_id: str, investigation_id: str, status: str) -> ApiResult[Record]:
    inv = check_uuid(investigation_id, "investigationId")
    nxt = check_enum(status, INVESTIGATION_STATUSES, "status")
    bad = first_error(inv, nxt)
    if bad:
        return bad
    owned = await assert_owned(db, owner_id, inv.data)
    if not owned.ok:
        return owned
    try:
        rows = await db.query("UPDATE investigations SET status = $2 WHERE id = $1 RETURNING *", [inv.data, nxt.data])
    except Exception as error:
        return map_database_error(error)
    return ok(to_investigation(rows[0])) if rows else fail(NOT_FOUND, "Investigation not found.")


async def record_claim_assessment(
    db: Database, owner_id: str, *, investigation_id: str, claim_id: str, confidence: str, reason: str,
    initial_state: str | None = None,
) -> ApiResult[Record]:
    """Stores the assessed confidence and reason, and the claim's FIRST state. Later changes go through record_state_change."""
    inv = check_uuid(investigation_id, "investigationId")
    claim = check_uuid(claim_id, "claimId")
    conf = check_enum(confidence, CONFIDENCE_LEVELS, "confidence")
    why = check_text(reason, "reason", 4000)
    first = ok(None) if initial_state is None else check_enum(initial_state, CLAIM_STATES, "initialState")
    bad = first_error(inv, claim, conf, why, first)
    if bad:
        return bad
    owned = await assert_owned(db, owner_id, inv.data)
    if not owned.ok:
        return owned
    try:
        rows = await db.query(
            # The first state may be set here; once set, only evidence_changes can alter it (DB-enforced).
            "UPDATE claims SET confidence = $3, assessment_reason = $4, state = COALESCE(state, $5::claim_state) "
            "WHERE investigation_id = $1 AND id = $2 RETURNING *",
            [inv.data, claim.data, conf.data, why.data, first.data],
        )
    except Exception as error:
        return map_database_error(error)
    return ok(to_claim(rows[0])) if rows else fail(NOT_FOUND, "Claim not found.")


async def claim_investigation_run(
    db: Database, owner_id: str, investigation_id: str, allowed_from: Sequence[str],
    stale_after_minutes: int | None = None,
) -> ApiResult[Record]:
    """Atomically moves an investigation into RESEARCHING, only from an allowed status.

    This is the single gate that prevents two workflow runs for the same investigation.
    """
    inv = check_uuid(investigation_id, "investigationId")
    if not inv.ok:
        return inv
    owned = await assert_owned(db, owner_id, inv.data)
    if not owned.ok:
        return owned
    try:
        rows = await db.query(
            # A run that made no progress for `stale_after_minutes` (e.g. the function was cut off) may be taken over.
            """UPDATE investigations SET status = 'RESEARCHING'
               WHERE id = $1 AND (status::text = ANY($2::text[])
                 OR ($3::int IS NOT NULL AND status::text IN ('CREATED', 'RESEARCHING', 'ANALYZING')
                     AND updated_at < now() - make_interval(mins => $3::int)))
               RETURNING *""",
            [inv.data, list(allowed_from), stale_after_minutes],
        )
    except Exception as error:
        return map_database_error(error)
    return ok(to_investigation(rows[0])) if rows else fail(CONFLICT, "A run is already in progress for this investigation.")
