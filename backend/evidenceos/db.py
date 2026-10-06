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


class PsycopgDatabase:
    """A small async pool. Autocommit: each statement is its own transaction, so triggers see one statement."""

    def __init__(self, conninfo: str, *, max_size: int = 5) -> None:
        self._opened = False
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
