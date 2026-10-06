"""Provider adapters, configuration and composition (port of the TypeScript server-adapters suite)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import anthropic
import httpx
import pytest

from evidenceos.agents.research_agent import research_claim
from evidenceos.db import PsycopgDatabase
from evidenceos.server.adapters.anthropic_llm import classify_provider_error, parse_model_json
from evidenceos.server.adapters.tavily_search import TavilySearch
from evidenceos.server.app import create_app
from evidenceos.server.config import read_server_config
from evidenceos.workflow.types import WorkflowError

from .helpers import ScriptedLlm


class TestModelReplyParsing:
    def test_extracts_json_from_plain_fenced_and_prose_wrapped_replies(self) -> None:
        assert parse_model_json('{"a":1}') == {"a": 1}
        assert parse_model_json('```json\n{"a":1}\n```') == {"a": 1}
        assert parse_model_json('Here you go: {"a":1} Hope that helps.') == {"a": 1}

    def test_reports_malformed_output_as_a_retryable_malformed_output_failure(self) -> None:
        with pytest.raises(WorkflowError) as no_json:
            parse_model_json("no json here")
        assert no_json.value.kind == "MALFORMED_OUTPUT"
        with pytest.raises(WorkflowError) as broken:
            parse_model_json("{broken")
        assert broken.value.kind == "MALFORMED_OUTPUT"

    def test_classifies_provider_failures_without_trusting_their_messages(self) -> None:
        def status(code: int) -> anthropic.APIStatusError:
            response = httpx.Response(code, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
            return anthropic.APIStatusError("provider text that must not be trusted", response=response, body=None)

        assert classify_provider_error(status(401)) == "AUTHENTICATION"
        assert classify_provider_error(status(403)) == "AUTHENTICATION"
        assert classify_provider_error(status(429)) == "RATE_LIMIT"
        assert classify_provider_error(status(503)) == "PROVIDER"
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        assert classify_provider_error(anthropic.APITimeoutError(request=request)) == "TIMEOUT"
        assert classify_provider_error(anthropic.APIConnectionError(request=request)) == "NETWORK"
        assert classify_provider_error(RuntimeError("unknown")) == "WORKFLOW"


def fixed_now() -> datetime:
    return datetime(2026, 1, 1, tzinfo=UTC)


def client_returning(status: int, body: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status, json=body)))


class TestTavilyAdapter:
    async def test_returns_only_provider_supplied_provenance_and_flags_unreadable_results(self) -> None:
        body = {
            "results": [
                {"url": "https://example.org/a", "title": "A study", "content": "short", "raw_content": "Full text of the study.", "published_date": "2022-05-01"},
                {"url": "https://example.org/b", "title": "Empty", "content": ""},
                {"title": "No url", "content": "ignored"},
            ]
        }
        search = TavilySearch("k", client=client_returning(200, body), now=fixed_now)
        outcome = await search.search("claim")
        assert len(outcome.documents) == 1
        d = outcome.documents[0]
        assert (d.url, d.title, d.source_type, d.publisher) == ("https://example.org/a", "A study", "WEB_PAGE", None)
        assert d.published_at == "2022-05-01T00:00:00.000Z"
        assert d.retrieved_at == "2026-01-01T00:00:00.000Z"
        assert d.text == "Full text of the study."
        assert outcome.unavailable == (("https://example.org/b", "no readable text"),)

    @pytest.mark.parametrize(("status", "kind"), [(401, "AUTHENTICATION"), (429, "RATE_LIMIT"), (502, "PROVIDER")])
    async def test_maps_http_failures_to_retryable_or_fatal_kinds(self, status: int, kind: str) -> None:
        with pytest.raises(WorkflowError) as error:
            await TavilySearch("k", client=client_returning(status, {})).search("q")
        assert error.value.kind == kind

    async def test_maps_network_and_timeout_failures(self) -> None:
        def offline(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("fetch failed")

        def slow(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("slow")

        with pytest.raises(WorkflowError) as network:
            await TavilySearch("k", client=httpx.AsyncClient(transport=httpx.MockTransport(offline))).search("q")
        assert network.value.kind == "NETWORK"
        with pytest.raises(WorkflowError) as timeout:
            await TavilySearch("k", client=httpx.AsyncClient(transport=httpx.MockTransport(slow))).search("q")
        assert timeout.value.kind == "TIMEOUT"

    async def test_feeds_the_research_agent_so_a_fabricated_quote_is_still_rejected(self) -> None:
        body = {"results": [{"url": "https://example.org/a", "title": "A", "content": "Real sentence in the source."}]}
        search = TavilySearch("k", client=client_returning(200, body), now=fixed_now)
        llm = ScriptedLlm({"candidates": [{"documentIndex": 0, "excerpt": "Invented sentence.", "relationship": "SUPPORTS", "strength": "STRONG"}]})
        with pytest.raises(WorkflowError) as error:
            await research_claim(llm, search, claim_id="c", statement="claim", max_retries=0)
        assert error.value.kind == "MALFORMED_OUTPUT"

    async def test_never_sends_the_key_anywhere_except_the_authorization_header(self) -> None:
        seen: list[httpx.Request] = []

        def capture(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json={"results": []})

        await TavilySearch("SECRET-KEY", client=httpx.AsyncClient(transport=httpx.MockTransport(capture))).search("claim text")
        assert str(seen[0].url) == "https://api.tavily.com/search"
        assert "SECRET-KEY" not in seen[0].content.decode()
        assert json.loads(seen[0].content)["query"] == "claim text"
        assert seen[0].headers["authorization"] == "Bearer SECRET-KEY"


class TestConfigAndComposition:
    def test_requires_database_url_names_missing_variables_and_never_echoes_values(self) -> None:
        with pytest.raises(ValueError, match="DATABASE_URL"):
            read_server_config({})
        with pytest.raises(ValueError, match="APPLICATION_ENV") as bad_env:
            read_server_config({"DATABASE_URL": "postgres://u:topsecret@h/db", "APPLICATION_ENV": "nope"})
        assert "topsecret" not in str(bad_env.value)
        with pytest.raises(ValueError, match="together"):
            read_server_config({"DATABASE_URL": "x", "DEMO_INVESTIGATION_ID": "only-one"})

    def test_reads_provider_keys_and_model_from_the_environment(self) -> None:
        cfg = read_server_config({"DATABASE_URL": "x", "ANTHROPIC_API_KEY": "a", "TAVILY_API_KEY": "t", "LLM_MODEL": "m"})
        assert cfg.llm is not None and cfg.llm.model == "m" and cfg.research is not None
        assert read_server_config({"DATABASE_URL": "x"}).llm is None

    async def test_treats_missing_provider_keys_as_research_unavailable_rather_than_crashing(self, db: PsycopgDatabase) -> None:
        app = create_app({"DATABASE_URL": "postgres://unused"}, db=db)
        assert app.state.config.llm is None
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://x.example") as http:
            assert (await http.get("/api/health")).status_code == 200
            created = await http.post("/api/investigations", json={"question": "Anything?"})
        assert created.status_code == 503
        assert "not configured" in created.text
