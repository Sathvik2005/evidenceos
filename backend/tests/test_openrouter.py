"""OpenRouter adapter and provider selection."""

from __future__ import annotations

import json

import httpx
import pytest

from evidenceos.agents.llm import LlmRequest
from evidenceos.server.adapters.openrouter_llm import OpenRouterLlm
from evidenceos.server.config import read_server_config
from evidenceos.workflow.types import WorkflowError

REQUEST = LlmRequest(system="sys", user="usr", schema_name="x")


def client_with(handler: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=handler)


async def test_sends_the_key_only_in_the_authorization_header_and_parses_a_fenced_reply() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        reply = {"choices": [{"message": {"content": '```json\n{"a": 1}\n```'}}]}
        return httpx.Response(200, json=reply)

    llm = OpenRouterLlm("SECRET", "vendor/model", client=client_with(httpx.MockTransport(handler)))
    assert await llm.generate(REQUEST) == {"a": 1}
    body = json.loads(seen[0].content)
    assert body["model"] == "vendor/model"
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert "SECRET" not in seen[0].content.decode()
    assert seen[0].headers["authorization"] == "Bearer SECRET"


@pytest.mark.parametrize(("status", "kind"), [(401, "AUTHENTICATION"), (429, "RATE_LIMIT"), (502, "PROVIDER")])
async def test_maps_http_failures_without_surfacing_provider_text(status: int, kind: str) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(status, json={"error": "leaky detail"}))
    with pytest.raises(WorkflowError) as error:
        await OpenRouterLlm("k", "m", client=client_with(transport)).generate(REQUEST)
    assert error.value.kind == kind
    assert "leaky" not in error.value.message


async def test_rejects_an_unreadable_reply_as_a_provider_failure() -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"unexpected": True}))
    with pytest.raises(WorkflowError) as error:
        await OpenRouterLlm("k", "m", client=client_with(transport)).generate(REQUEST)
    assert error.value.kind == "PROVIDER"


def test_config_selects_openrouter_and_requires_a_model_id() -> None:
    with pytest.raises(ValueError, match="LLM_MODEL"):
        read_server_config({"DATABASE_URL": "x", "OPENROUTER_API_KEY": "k"})
    cfg = read_server_config(
        {"DATABASE_URL": "x", "OPENROUTER_API_KEY": "k", "LLM_MODEL": "vendor/model", "ANTHROPIC_API_KEY": "a"}
    )
    assert cfg.llm is not None
    assert (cfg.llm.provider, cfg.llm.model) == ("openrouter", "vendor/model")
    anthropic_only = read_server_config({"DATABASE_URL": "x", "ANTHROPIC_API_KEY": "a"})
    assert anthropic_only.llm is not None and anthropic_only.llm.provider == "anthropic"
