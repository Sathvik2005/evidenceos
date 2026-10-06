"""Anthropic model adapter behind the provider-neutral LlmClient. Server-side only: it holds the key."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import anthropic

from ...agents.llm import LlmRequest
from ...workflow.types import WorkflowError

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)


def parse_model_json(text: str) -> Any:
    """Extracts the JSON value from a model reply that may be wrapped in a code fence or prose."""
    fenced = _FENCE.search(text)
    body = (fenced.group(1) if fenced else text).strip()
    opening = re.search(r"[{\[]", body)
    start = opening.start() if opening else -1
    end = max(body.rfind("}"), body.rfind("]"))
    if start == -1 or end <= start:
        raise WorkflowError("MALFORMED_OUTPUT", "The model reply contained no JSON.")
    try:
        return json.loads(body[start : end + 1])
    except json.JSONDecodeError as error:
        raise WorkflowError("MALFORMED_OUTPUT", "The model reply was not valid JSON.") from error


def classify_provider_error(error: BaseException) -> str:
    if isinstance(error, anthropic.APITimeoutError):
        return "TIMEOUT"
    if isinstance(error, anthropic.APIConnectionError):
        return "NETWORK"
    if isinstance(error, anthropic.APIStatusError):
        status = error.status_code
        if status in (401, 403):
            return "AUTHENTICATION"
        if status == 429:
            return "RATE_LIMIT"
        if status == 408:
            return "TIMEOUT"
        if status >= 500:
            return "PROVIDER"
    return "WORKFLOW"


@dataclass
class AnthropicLlm:
    api_key: str
    model: str
    max_tokens: int = 4096
    timeout_seconds: float = 60.0

    def __post_init__(self) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=self.api_key, timeout=self.timeout_seconds, max_retries=0)

    async def generate(self, request: LlmRequest) -> Any:
        try:
            response = await self._client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=request.system,
                messages=[{"role": "user", "content": request.user}],
            )
            text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
        except Exception as error:
            # The provider message can echo request details, so only the classified kind is surfaced.
            raise WorkflowError(classify_provider_error(error), "The language model request failed.") from error
        return parse_model_json(text)
