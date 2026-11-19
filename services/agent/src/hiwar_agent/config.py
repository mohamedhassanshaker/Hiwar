"""Settings from the environment."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://hiwar:hiwar@localhost:5433/hiwar"
    model_base_url: str = "http://localhost:8090/v1"
    model_api_key: str = "stub"
    #: Provider model names per tier (AGT-001 FR-015).
    model_fast: str = "gpt-5-mini"
    model_standard: str = "gpt-5"
    model_advanced: str = "gpt-5-pro"
    embed_model: str = "text-embedding-3-small"
    embed_dimensions: int = 1024
    #: AED per million input and output tokens per tier, for the cost shown per turn.
    price_fast: tuple[float, float] = (0.92, 7.35)
    price_standard: tuple[float, float] = (4.6, 36.7)
    price_advanced: tuple[float, float] = (55.0, 440.0)
    web_callback_url: str = "http://localhost:3000"
    agent_service_token: str = "dev-agent-token"
    files_dir: str = "../../.data/files"
    #: Allows HTTP tools and crawls to reach private addresses. Development only.
    allow_private_egress: bool = False
    #: Retrieval score under which an answer counts as low confidence.
    low_confidence_below: float = 0.2


settings = Settings()
