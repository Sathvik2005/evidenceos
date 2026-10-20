"""OpenRouter model adapter behind the provider-neutral LlmClient. Server-side only: it holds the key.

OpenRouter and Google Gemini both expose an OpenAI-compatible chat-completions endpoint, so this uses plain httpx
with a configurable URL. Errors are mapped to the
same failure kinds as the Anthropic adapter and provider messages are never surfaced.
"""

from __future__ import annotations

from typing import Any

import httpx

from ...agents.llm import LlmRequest
from ...workflow.types import WorkflowError
from .anthropic_llm import parse_model_json

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"


def kind_for_status(status: int) -> str:
    if status in (401, 403):
        return "AUTHENTICATION"
    if status == 402:
        return "AUTHORIZATION"  # the provider refuses to serve this account (no credit left); retrying cannot help
    if status == 429:
        return "RATE_LIMIT"
    if status == 408:
        return "TIMEOUT"
    return "PROVIDER" if status >= 500 else "WORKFLOW"


class OpenRouterLlm:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        url: str = OPENROUTER_URL,
        max_tokens: int = 4096,
        timeout_seconds: float = 60.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._key = api_key
        self._model = model
        self._url = url
        self._max_tokens = max_tokens
        self._timeout = timeout_seconds
        self._client = client

    async def generate(self, request: LlmRequest) -> Any:
        payload = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "messages": [{"role": "system", "content": request.system}, {"role": "user", "content": request.user}],
        }
        headers = {"authorization": f"Bearer {self._key}", "content-type": "application/json"}
        try:
            if self._client is not None:
                response = await self._client.post(self._url, json=payload, headers=headers, timeout=self._timeout)
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.post(self._url, json=payload, headers=headers, timeout=self._timeout)
        except httpx.TimeoutException as error:
            raise WorkflowError("TIMEOUT", "The language model request failed.") from error
        except httpx.HTTPError as error:
            raise WorkflowError("NETWORK", "The language model request failed.") from error
        if response.status_code >= 400:
            raise WorkflowError(kind_for_status(response.status_code), "The language model request failed.")
        try:
            text = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise WorkflowError("PROVIDER", "The language model sent an unreadable response.") from error
        if not isinstance(text, str):
            raise WorkflowError("PROVIDER", "The language model sent an unreadable response.")
        return parse_model_json(text)
