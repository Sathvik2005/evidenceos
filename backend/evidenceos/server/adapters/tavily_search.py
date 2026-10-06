"""Tavily retrieval adapter behind SearchProvider.

It returns only what the provider returned: every URL, title, date and text below comes from the response,
never from a model.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from ...agents.research_agent import RetrievedDocument, SearchOutcome
from ...workflow.types import WorkflowError

TAVILY_URL = "https://api.tavily.com/search"


def kind_for_status(status: int) -> str:
    if status in (401, 403):
        return "AUTHENTICATION"
    if status == 429:
        return "RATE_LIMIT"
    if status == 408:
        return "TIMEOUT"
    return "PROVIDER" if status >= 500 else "WORKFLOW"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _iso(moment: datetime) -> str:
    moment = moment.astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _parse_published(value: str) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _iso(parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC))


class TavilySearch:
    def __init__(
        self,
        api_key: str,
        *,
        max_results: int = 6,
        timeout_seconds: float = 20.0,
        client: httpx.AsyncClient | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._api_key = api_key
        self._max_results = max_results
        self._timeout = timeout_seconds
        self._client = client
        self._now = now or (lambda: datetime.now(UTC))

    async def search(self, query: str) -> SearchOutcome:
        payload = {"query": query, "max_results": self._max_results, "include_raw_content": "text", "search_depth": "basic"}
        headers = {"content-type": "application/json", "authorization": f"Bearer {self._api_key}"}
        try:
            if self._client is not None:
                response = await self._client.post(TAVILY_URL, json=payload, headers=headers, timeout=self._timeout)
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.post(TAVILY_URL, json=payload, headers=headers, timeout=self._timeout)
        except httpx.TimeoutException as error:
            raise WorkflowError("TIMEOUT", "The search request failed.") from error
        except httpx.HTTPError as error:
            raise WorkflowError("NETWORK", "The search request failed.") from error
        if response.status_code >= 400:
            raise WorkflowError(kind_for_status(response.status_code), f"The search provider returned HTTP {response.status_code}.")

        try:
            body = response.json()
        except ValueError as error:
            raise WorkflowError("PROVIDER", "The search provider sent an unreadable response.") from error
        results = body.get("results") if isinstance(body, dict) else None
        results = results if isinstance(results, list) else []

        documents: list[RetrievedDocument] = []
        unavailable: list[tuple[str, str]] = []
        for result in results:
            if not isinstance(result, dict):
                continue
            url = _text(result.get("url"))
            text = _text(result.get("raw_content")) or _text(result.get("content"))
            if not url:
                continue
            if not text:
                unavailable.append((url, "no readable text"))
                continue
            documents.append(
                RetrievedDocument(
                    url=url,
                    title=_text(result.get("title")) or url,
                    source_type="WEB_PAGE",
                    publisher=None,
                    published_at=_parse_published(_text(result.get("published_date"))),
                    retrieved_at=_iso(self._now()),
                    text=text,
                )
            )
        return SearchOutcome(documents=tuple(documents), unavailable=tuple(unavailable))
