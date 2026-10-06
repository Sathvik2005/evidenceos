"""Seeds the demo data into the database named by DATABASE_URL (no model or search keys needed).

    python -m evidenceos.cli.seed            stage 1: claims, first evidence, first assessments
    python -m evidenceos.cli.seed advance    stage 2: new evidence arrives and the first claim changes state

Data is written through the product's operations and hard rules; see evidenceos/server/seed.py.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from ..db import PsycopgDatabase, use_selector_event_loop_on_windows
from ..operations import list_investigations
from ..server.adapters.recorded import load_corpus
from ..server.seed import seed_advance, seed_initial

CORPUS = Path(__file__).resolve().parents[3] / "demo" / "corpus.json"


async def run(command: str | None) -> int:
    url, owner = os.environ.get("DATABASE_URL"), os.environ.get("DEMO_OWNER_ID")
    if not url or not owner:
        print("DATABASE_URL and DEMO_OWNER_ID must be set.", file=sys.stderr)
        return 2
    db = PsycopgDatabase(url)
    await db.open()
    try:
        corpus = load_corpus(CORPUS)
        if command == "advance":
            existing = await list_investigations(db, owner)
            found = existing.data[0]["id"] if existing.ok and existing.data else None
            if not found:
                raise RuntimeError("No seeded investigation found; run the initial seed first.")
            await seed_advance(db, owner, found, corpus)
            print(f"advanced {found}")
        else:
            created = await seed_initial(db, owner, corpus)
            print(f"seeded {created}\nSet DEMO_INVESTIGATION_ID={created} and DEMO_OWNER_ID={owner} in the deployment environment.")
        return 0
    except Exception as error:
        print(str(error) or "seed failed", file=sys.stderr)
        return 1
    finally:
        await db.close()


def main() -> int:
    use_selector_event_loop_on_windows()
    return asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else None))


if __name__ == "__main__":
    raise SystemExit(main())
