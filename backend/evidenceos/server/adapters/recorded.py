"""Recorded retrieval for the demo.

Replays documents that were genuinely fetched and verified earlier. It is a SearchProvider like any other, so
every downstream integrity check still runs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ...agents.research_agent import RetrievedDocument, SearchOutcome


@dataclass(frozen=True)
class RecordedDocument:
    document: RetrievedDocument
    #: The demo step at which this document becomes available (1 = initial, 2 = new evidence).
    phase: int


def load_corpus(path: Path) -> list[RecordedDocument]:
    """Reads demo/corpus.json (the same file the TypeScript prototype used)."""
    raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return [
        RecordedDocument(
            RetrievedDocument(
                url=d["url"], title=d["title"], source_type=d["sourceType"], publisher=d.get("publisher"),
                published_at=d.get("publishedAt"), retrieved_at=d["retrievedAt"], text=d["text"],
            ),
            int(d["phase"]),
        )
        for d in raw["documents"]
    ]


class RecordedSearch:
    def __init__(self, documents: list[RecordedDocument], phase: int) -> None:
        self._documents = documents
        self._phase = phase

    async def search(self, query: str) -> SearchOutcome:
        return SearchOutcome(documents=tuple(d.document for d in self._documents if d.phase <= self._phase))
