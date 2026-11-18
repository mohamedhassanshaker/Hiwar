"""The connector runtime's configuration."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Stack specification section 9: the connector-runtime variables."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    # `control` runs the registry and proxies; `bridge` runs exactly one stdio server.
    mode: Literal["control", "bridge"] = Field(default="control", alias="CONNECTOR_MODE")
    connector_id: str = Field(default="", alias="CONNECTOR_ID")
    # The whole `ConnectorSpec` as JSON, so a bridge knows what to start. It carries a
    # secret's name, never its value; the value arrives as a mounted Secret.
    connector_spec: str = Field(default="", alias="CONNECTOR_SPEC")
    bridge_image: str = Field(
        default="localhost:5001/awp/connector-runtime:dev", alias="CONNECTOR_IMAGE"
    )
    namespace: str = Field(default="awp-app", alias="CONNECTOR_NAMESPACE")
    # The same policy the chart gives every other workload. Local development rebuilds one
    # tag, so a bridge left on IfNotPresent keeps running the image it first pulled.
    image_pull_policy: str = Field(default="IfNotPresent", alias="CONNECTOR_IMAGE_PULL_POLICY")
    secrets_path: str = Field(default="/run/secrets/connectors", alias="CONNECTOR_SECRETS_PATH")
    egress_proxy: str = Field(
        default="http://egress-proxy.awp-app.svc:3128", alias="EGRESS_PROXY_URL"
    )
    call_timeout_seconds: int = Field(default=60, alias="CONNECTOR_TIMEOUT_SECONDS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")


@lru_cache(maxsize=1)
def settings() -> Settings:
    """The process-wide settings, read once."""
    return Settings()
