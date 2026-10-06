"""Test doubles for the model boundary. Never used by application code."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from evidenceos.agents.llm import LlmRequest
from evidenceos.agents.research_agent import RetrievedDocument, SearchOutcome, SearchProvider

DEFAULT_CLAIMS = (
    "Remote learning changes standardized test scores",
    "Remote learning changes student attendance rates",
    "Remote learning changes student wellbeing",
)


class ScriptedLlm:
    """Replays scripted outputs in order (the last repeats); an Exception instance is raised instead of returned."""

    def __init__(self, *outputs: Any) -> None:
        self.outputs = outputs
        self.requests: list[LlmRequest] = []

    async def generate(self, request: LlmRequest) -> Any:
        self.requests.append(request)
        nxt = self.outputs[min(len(self.requests) - 1, len(self.outputs) - 1)]
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


_DOCUMENT = re.compile(r'<document index="(\d+)">\n(.*?)\n</document>', re.DOTALL)
_EVIDENCE = re.compile(r'<evidence id="([^"]+)" relationship="([^"]+)"')


def _research_answer(request: LlmRequest) -> dict[str, Any]:
    candidates = []
    for match in _DOCUMENT.finditer(request.user):
        text = match.group(2)
        relationship = (
            "CONTRADICTS" if re.search(r"declined|fell", text)
            else "PARTIALLY_SUPPORTS" if re.search(r"partly", text)
            else "SUPPORTS"
        )
        candidates.append(
            {"documentIndex": int(match.group(1)), "excerpt": text, "relationship": relationship, "strength": "MODERATE"}
        )
    return {"candidates": candidates}


def _assessment_answer(request: LlmRequest) -> dict[str, Any]:
    items = [(m.group(1), m.group(2)) for m in _EVIDENCE.finditer(request.user)]
    supports = any(rel == "SUPPORTS" for _, rel in items)
    partial = any(rel == "PARTIALLY_SUPPORTS" for _, rel in items)
    contradicts = any(rel == "CONTRADICTS" for _, rel in items)
    if contradicts and (supports or partial):
        state = "CONFLICTING"
    elif supports and not contradicts:
        state = "SUPPORTED"
    elif partial:
        state = "PARTIALLY_SUPPORTED"
    else:
        state = "INSUFFICIENT"
    return {
        "proposedState": state,
        "confidence": "MEDIUM",
        "rationale": "Assessment derived from the supplied evidence.",
        "evidenceIds": [i for i, _ in items],
        "causalStatus": "CORRELATION",
        "scopeNotes": [],
        "uncertainties": [],
    }


class FixtureLlm:
    """Deterministic double for the whole model boundary: reads only what the prompts contain, answers by schema."""

    def __init__(
        self,
        claims: tuple[str, ...] | list[str] | None = None,
        research: Callable[[LlmRequest], Any] | None = None,
    ) -> None:
        self.claims = list(claims) if claims is not None else list(DEFAULT_CLAIMS)
        self.research = research
        self.calls: dict[str, int] = {}

    async def generate(self, request: LlmRequest) -> Any:
        self.calls[request.schema_name] = self.calls.get(request.schema_name, 0) + 1
        match request.schema_name:
            case "claim_decomposition":
                return {"claims": [{"statement": s} for s in self.claims]}
            case "research_candidates":
                override = self.research(request) if self.research else None
                return override if override is not None else _research_answer(request)
            case "evidence_assessment":
                return _assessment_answer(request)
            case "evaluation":
                return {
                    "scores": {
                        "evidenceQuality": 2, "grounding": 2, "contradictionHandling": 2,
                        "stateJustification": 2, "uncertaintyHandling": 2,
                    },
                    "criticalFailures": [],
                    "findings": [],
                }
            case _:
                raise AssertionError(f"Unexpected schema {request.schema_name}")


def doc(slug: str, text: str) -> RetrievedDocument:
    return RetrievedDocument(
        url=f"https://example.org/{slug}", title=f"Source {slug}", source_type="JOURNAL_ARTICLE",
        publisher="Example Journal", published_at="2022-05-01T00:00:00.000Z",
        retrieved_at="2026-01-01T00:00:00.000Z", text=text,
    )


class Corpus:
    """Controlled fixture corpus keyed by a word in the claim."""

    async def search(self, query: str) -> SearchOutcome:
        if "test scores" in query:
            return SearchOutcome(
                documents=(
                    doc("scores-up", "Remote students improved reading scores in one district."),
                    doc("scores-down", "Average math scores declined after the move to remote learning."),
                )
            )
        if "attendance" in query:
            return SearchOutcome(documents=(doc("attendance", "Remote students improved attendance rates in rural schools."),))
        return SearchOutcome()  # wellbeing: nothing retrievable


class FunctionSearch:
    def __init__(self, fn: Callable[[str], SearchOutcome]) -> None:
        self.fn = fn

    async def search(self, query: str) -> SearchOutcome:
        return self.fn(query)


def search_provider(corpus: Any) -> SearchProvider:
    return corpus
