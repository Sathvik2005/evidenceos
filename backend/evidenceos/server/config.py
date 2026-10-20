"""Server configuration from the environment. Names are reported when missing; values never are."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

APP_ENVS = ("development", "test", "demo", "production")
DEFAULT_LLM_MODEL = "claude-sonnet-5-5"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


@dataclass(frozen=True)
class LlmConfig:
    api_key: str
    model: str
    #: "anthropic", "openrouter" or "gemini"
    provider: str = "anthropic"


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
    openrouter_key = env.get("OPENROUTER_API_KEY")
    gemini_key = env.get("GEMINI_API_KEY")
    tavily_key = env.get("TAVILY_API_KEY")
    llm: LlmConfig | None = None
    if openrouter_key:
        # OpenRouter model ids vary ("vendor/model"), so there is deliberately no default to guess.
        model = env.get("LLM_MODEL")
        if not model:
            raise ValueError("LLM_MODEL is required when OPENROUTER_API_KEY is set (an OpenRouter model id).")
        llm = LlmConfig(openrouter_key, model, "openrouter")
    elif gemini_key:
        llm = LlmConfig(gemini_key, env.get("LLM_MODEL") or DEFAULT_GEMINI_MODEL, "gemini")
    elif anthropic_key:
        llm = LlmConfig(anthropic_key, env.get("LLM_MODEL") or DEFAULT_LLM_MODEL, "anthropic")
    return ServerConfig(
        app_env=app_env,
        database_url=database_url,
        # Providers are optional so reads and the health check work without them; research is then
        # reported as unavailable instead of failing mysteriously.
        llm=llm,
        research=ResearchConfig("tavily", tavily_key) if tavily_key else None,
        demo=DemoConfig(demo_id, demo_owner) if demo_id and demo_owner else None,
    )
