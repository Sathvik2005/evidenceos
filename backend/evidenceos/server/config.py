"""Server configuration from the environment. Names are reported when missing; values never are."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

APP_ENVS = ("development", "test", "demo", "production")
DEFAULT_LLM_MODEL = "claude-sonnet-5-5"


@dataclass(frozen=True)
class LlmConfig:
    api_key: str
    model: str


@dataclass(frozen=True)
class ResearchConfig:
    provider: str
    api_key: str


@dataclass(frozen=True)
class DemoConfig:
    investigation_id: str
    owner_id: str


@dataclass(frozen=True)
class ServerConfig:
    app_env: str
    database_url: str
    llm: LlmConfig | None
    research: ResearchConfig | None
    demo: DemoConfig | None


def read_server_config(env: Mapping[str, str | None]) -> ServerConfig:
    app_env = env.get("APPLICATION_ENV") or env.get("APP_ENV") or "development"
    if app_env not in APP_ENVS:
        raise ValueError(f"APPLICATION_ENV must be one of: {', '.join(APP_ENVS)}.")

    database_url = env.get("DATABASE_URL")
    if not database_url:
        raise ValueError("Missing required environment variable DATABASE_URL.")

    provider = env.get("RESEARCH_PROVIDER") or "tavily"
    if provider != "tavily":
        raise ValueError('RESEARCH_PROVIDER must be "tavily".')

    demo_id = env.get("DEMO_INVESTIGATION_ID")
    demo_owner = env.get("DEMO_OWNER_ID")
    if bool(demo_id) != bool(demo_owner):
        raise ValueError("DEMO_INVESTIGATION_ID and DEMO_OWNER_ID must be set together.")

    anthropic_key = env.get("ANTHROPIC_API_KEY")
    tavily_key = env.get("TAVILY_API_KEY")
    return ServerConfig(
        app_env=app_env,
        database_url=database_url,
        # Providers are optional so reads and the health check work without them; research is then
        # reported as unavailable instead of failing mysteriously.
        llm=LlmConfig(anthropic_key, env.get("LLM_MODEL") or DEFAULT_LLM_MODEL) if anthropic_key else None,
        research=ResearchConfig("tavily", tavily_key) if tavily_key else None,
        demo=DemoConfig(demo_id, demo_owner) if demo_id and demo_owner else None,
    )
