"""Applies database/migrations/*.sql in order and records them.

Usage: DATABASE_URL=... python -m evidenceos.cli.migrate
Reads DATABASE_URL from the environment; it never prints it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

MIGRATIONS = Path(__file__).resolve().parents[3] / "database" / "migrations"


def apply_migrations(conninfo: str, directory: Path = MIGRATIONS) -> list[str]:
    """Applies pending migrations and returns the names applied."""
    applied_now: list[str] = []
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        applied = {row[0] for row in conn.execute("SELECT name FROM schema_migrations").fetchall()}
        for path in sorted(directory.glob("*.sql")):
            if path.name in applied:
                continue
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", [path.name])
            applied_now.append(path.name)
    return applied_now


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2
    try:
        applied = apply_migrations(url)
    except psycopg.Error as error:
        print(f"migration failed: {str(error).splitlines()[0] if str(error) else 'unknown error'}", file=sys.stderr)
        return 1
    for name in applied:
        print(f"applied {name}")
    print(f"applied {len(applied)} migration(s)" if applied else "database is up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
