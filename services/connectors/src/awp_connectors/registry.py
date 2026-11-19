"""The connector registry: what each connector is, and how it is started.

A connector is one MCP server. Remote connectors already speak Streamable HTTP, so the runtime
only proxies them. A stdio connector is a command, and the runtime runs each one in its own Pod
in `awp-app` and speaks stdio to it over an exec channel — one process per connector, never a
shared one, so a misbehaving connector can affect nothing but itself.

A stdio connector's secrets are a mounted Secret the runtime reads at start. An HTTP connector's
credential arrives from the web app as the headers its requests carry (D296): held in memory only,
left out of everything this model serialises (the state kept for a restart, the bridge's spec), and
never returned.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Transport = Literal["stdio", "http"]


class ConnectorSpec(BaseModel):
    """One connector as the Connectors screen configures it."""

    connector_id: str
    name: str
    transport: Transport = "stdio"
    command: list[str] = Field(default_factory=list)
    args: list[str] = Field(default_factory=list)
    url: str = ""
    env_from_secret: str = ""
    allowed_domains: list[str] = Field(default_factory=list)
    enabled: bool = True
    #: D296: the headers and query parameters an HTTP connector's requests carry for its credential.
    headers: dict[str, str] = Field(default_factory=dict, exclude=True, repr=False)
    query: dict[str, str] = Field(default_factory=dict, exclude=True, repr=False)
    #: Kept for a restart, so a runtime that lost `headers` refuses rather than calls without them.
    needs_credential: bool = False

    @property
    def credential_missing(self) -> bool:
        """Whether this connector needs a credential the runtime does not hold."""
        return self.needs_credential and not self.headers and not self.query

    def redact(self, text: str) -> str:
        """`text` with every credential value hidden, for an error a caller or a log sees."""
        for value in (*self.headers.values(), *self.query.values()):
            if value:
                text = text.replace(value, "••••••")
        return text

    def validated(self) -> ConnectorSpec:
        """A connector that cannot be started is a configuration error, not a runtime one."""
        if self.transport == "stdio" and not self.command:
            raise ValueError(f"{self.connector_id} is a stdio connector with no command")
        if self.transport == "http" and not self.url:
            raise ValueError(f"{self.connector_id} is an HTTP connector with no URL")
        return self


class Registry:
    """The connectors this runtime serves, kept in memory and reloaded on save."""

    def __init__(self) -> None:
        self._connectors: dict[str, ConnectorSpec] = {}

    def replace(self, connectors: list[ConnectorSpec]) -> list[str]:
        """Hot reload: the new set replaces the old one, and the ids are returned."""
        self._connectors = {
            connector.connector_id: connector.validated()
            for connector in connectors
            if connector.enabled
        }
        return sorted(self._connectors)

    def get(self, connector_id: str) -> ConnectorSpec:
        """One connector, or a KeyError naming it."""
        if connector_id not in self._connectors:
            raise KeyError(f"no connector {connector_id} is configured")
        return self._connectors[connector_id]

    def ids(self) -> list[str]:
        """Every configured connector id."""
        return sorted(self._connectors)
