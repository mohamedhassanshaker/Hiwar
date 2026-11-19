"""The sandbox manager's configuration. Every limit here is a hard limit, not a default."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Stack specification section 9: the sandbox variables."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    namespace: str = Field(default="awp-sandbox", alias="SANDBOX_NAMESPACE")
    image: str = Field(default="localhost:5001/awp/sandbox-workspace:dev", alias="SANDBOX_IMAGE")
    runtime_class: str = Field(default="", alias="SANDBOX_RUNTIME_CLASS")
    service_account: str = Field(default="awp-sandbox-workspace", alias="SANDBOX_SERVICE_ACCOUNT")

    cpu_limit: str = Field(default="1", alias="SANDBOX_CPU_LIMIT")
    memory_limit: str = Field(default="1Gi", alias="SANDBOX_MEMORY_LIMIT")
    ephemeral_storage_limit: str = Field(default="2Gi", alias="SANDBOX_STORAGE_LIMIT")
    max_seconds: int = Field(default=900, alias="SANDBOX_MAX_SECONDS")
    exec_timeout_seconds: int = Field(default=120, alias="SANDBOX_EXEC_TIMEOUT_SECONDS")

    warm_pool_size: int = Field(default=2, alias="SANDBOX_WARM_POOL")
    egress_proxy: str = Field(
        default="http://egress-proxy.awp-app.svc:3128", alias="EGRESS_PROXY_URL"
    )
    node_pool_label: str = Field(default="awp/pool=sandbox", alias="SANDBOX_NODE_POOL")

    # D390: `railway` runs each workspace as a Railway sandbox, where there is no Kubernetes.
    backend: Literal["kubernetes", "railway"] = Field(default="kubernetes", alias="SANDBOX_BACKEND")
    railway_api_url: str = Field(
        default="https://backboard.railway.com/graphql/v2", alias="RAILWAY_API_URL"
    )
    railway_token: str = Field(default="", alias="RAILWAY_API_TOKEN")
    # Railway sets this in every service; sandboxes are created in the same environment.
    railway_environment_id: str = Field(default="", alias="RAILWAY_ENVIRONMENT_ID")
    # The workspace image's lock files, which the Railway template is built from.
    workspace_files: str = Field(default="/app/workspace", alias="SANDBOX_WORKSPACE_FILES")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    @property
    def node_selector(self) -> dict[str, str]:
        """The node pool sandboxes are pinned to, so they never share a node with the app."""
        key, _, value = self.node_pool_label.partition("=")
        return {key: value} if value else {}


@lru_cache(maxsize=1)
def settings() -> Settings:
    """The process-wide settings, read once."""
    return Settings()
