"""Database access boundary.

Operations receive a `Database`: anything with an async `query(sql, params)` that returns rows as dicts.
SQL uses numbered placeholders (`$1`, `$2`, ...) which may repeat; they are translated to psycopg's named form.
"""

from __future__ import annotations

import asyncio
import re
import sys
from collections.abc import Sequence
from typing import Any, Protocol, cast

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

_PLACEHOLDER = re.compile(r"\$(\d+)")


class Database(Protocol):
    async def query(self, sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]: ...


def translate(sql: str, params: Sequence[Any] | None) -> tuple[str, dict[str, Any]]:
    """`$1` -> `%(p1)s`; returns the SQL and the named parameter dict."""
    values = {f"p{i + 1}": v for i, v in enumerate(params or [])}
    # A literal percent sign (e.g. in LIKE) must be doubled once psycopg interprets the statement.
    return _PLACEHOLDER.sub(lambda m: f"%(p{m.group(1)})s", sql.replace("%", "%%")), values


def classify_db_error(error: BaseException) -> str:
    """A coarse, safe category for a database failure. The raw message is never returned: it can hold the host."""
    text = str(error).lower()
    checks = (
        ("auth", ("password authentication", "authentication failed", "tenant or user not found", "tenant/user", "no pg_hba", "invalid password")),
        ("dns", ("could not translate host", "name or service not known", "getaddrinfo", "nodename nor servname", "temporary failure in name")),
        ("network", ("network is unreachable", "no route to host", "connection refused", "cannot assign requested", "connection failed")),
        ("timeout", ("timeout", "timed out", "couldn't get a connection")),
        ("ssl", ("ssl", "tls")),
        ("database", ("does not exist",)),
    )
    for name, needles in checks:
        if any(n in text for n in needles):
            return name
    return "unknown" if text else type(error).__name__.lower()


def network_detail(error: BaseException) -> str:
    """Splits the coarse 'network' category: unreachable (typically IPv6-only), refused (wrong port or host) or other."""
    text = str(error).lower()
    if "network is unreachable" in text or "no route to host" in text or "cannot assign requested" in text:
        return "unreachable"
    if "connection refused" in text:
        return "refused"
    if "timeout" in text or "timed out" in text:
        return "timeout"
    return "other"


def scrubbed_message(error: BaseException, conninfo: str) -> str:
    """The error text with every connection detail removed (host, user, password, database, addresses, quoted text)."""
    from psycopg.conninfo import conninfo_to_dict

    text = " ".join(str(error).split())
    try:
        info = conninfo_to_dict(conninfo)
    except Exception:
        info = {}
    for key in ("password", "user", "host", "hostaddr", "dbname"):
        value = str(info.get(key) or "")
        if len(value) >= 3:
            text = text.replace(value, f"<{key}>")
    text = re.sub(r"\"[^\"]*\"|'[^']*'", "<quoted>", text)
    text = re.sub(r"\d{1,3}(?:\.\d{1,3}){3}", "<ip>", text)
    text = re.sub(r"\[?[0-9a-fA-F:]{6,}\]?", "<addr>", text)
    text = re.sub(r"[\w.-]+\.(?:com|co|app|io|net|org|dev)", "<host>", text)
    return text[:240]


def describe_target(conninfo: str) -> dict[str, str]:
    """Non-secret facts about where we are connecting: host kind and port. Never the host name, user or password."""
    from psycopg.conninfo import conninfo_to_dict

    try:
        info = conninfo_to_dict(conninfo)
    except Exception:
        return {"host_kind": "unparseable"}
    host = str(info.get("host", ""))
    if host.endswith(".supabase.co") and host.startswith("db."):
        kind = "supabase-direct (IPv6 only: use the Session pooler string)"
    elif "pooler.supabase.com" in host:
        kind = "supabase-pooler"
    elif host.endswith(".neon.tech"):
        kind = "neon"
    elif not host:
        kind = "missing-host"
    else:
        kind = "other"
    return {"host_kind": kind, "port": str(info.get("port", "5432 (default)")), "sslmode": str(info.get("sslmode", "not set"))}


class PsycopgDatabase:
    """A small async pool. Autocommit: each statement is its own transaction, so triggers see one statement."""

    def __init__(self, conninfo: str, *, max_size: int = 5) -> None:
        self._opened = False
        self._conninfo = conninfo
        self._pool = AsyncConnectionPool(
            conninfo,
            min_size=1,
            max_size=max_size,
            timeout=10,
            open=False,
            # prepare_threshold=None: no server-side prepared statements, so it also works behind transaction
            # poolers (e.g. Supabase / PgBouncer); the cost is negligible for these small statements.
            kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": None},
        )

    async def open(self) -> None:
        await self._pool.open()
        self._opened = True

    async def query(self, sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
        # Opened on first use: serverless hosts do not always run application startup hooks.
        if not self._opened:
            await self.open()
        text, values = translate(sql, params)
        async with self._pool.connection() as conn:
            cur = await conn.execute(text, values)
            if not cur.description:
                return []
            return cast("list[dict[str, Any]]", await cur.fetchall())  # the pool uses the dict_row factory

    async def probe(self) -> str:
        """One direct connection attempt (5 s) and the coarse category of its failure; 'connected' if it works."""
        try:
            conn = await psycopg.AsyncConnection.connect(self._conninfo, connect_timeout=5, autocommit=True)
        except Exception as error:
            reason = classify_db_error(error)
            return f"{reason}:{network_detail(error)}" if reason == "network" else reason
        await conn.close()
        return "connected"

    def target(self) -> dict[str, str]:
        return describe_target(self._conninfo)

    async def probe_message(self) -> str:
        """A scrubbed failure message from one direct connection attempt (empty when it connects)."""
        try:
            conn = await psycopg.AsyncConnection.connect(self._conninfo, connect_timeout=5, autocommit=True)
        except Exception as error:
            return scrubbed_message(error, self._conninfo)
        await conn.close()
        return ""

    async def close(self) -> None:
        await self._pool.close()


def sqlstate(error: BaseException) -> str | None:
    """The PostgreSQL SQLSTATE of a database error, if it has one."""
    if isinstance(error, psycopg.Error):
        return error.sqlstate
    return None


def use_selector_event_loop_on_windows() -> None:
    """psycopg's async mode cannot run on Windows' default ProactorEventLoop; call once before the loop starts."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
