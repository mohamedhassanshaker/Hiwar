"""Bridge mode against a real stdio MCP server.

The bridge is what makes a Local MCP connector work at all: the control process never runs a
connector's code, so everything `UC-54.1-02` shows for a stdio connector comes back through
here. These start an actual child process and read what it offers.
"""

from __future__ import annotations

import sys

import pytest

from awp_connectors.bridge import bridge_server, bridged_connector
from awp_connectors.config import settings
from awp_connectors.registry import ConnectorSpec
from awp_connectors.runtime import ConnectorRuntime

SERVER = """
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

server = FastMCP("probe")


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def claims_read() -> str:
    "Read a claim."
    return "a claim"


@server.tool(annotations=ToolAnnotations(destructiveHint=True))
def claims_close() -> str:
    "Close a claim."
    return "closed"


server.run()
"""


def _connector() -> ConnectorSpec:
    return ConnectorSpec(
        connector_id="probe",
        name="Probe",
        transport="stdio",
        command=[sys.executable, "-c", SERVER],
    )


async def test_the_bridge_offers_the_child_process_tools() -> None:
    """`UC-54.1-02`: the handshake lists what the server actually offers."""
    runtime = ConnectorRuntime()
    try:
        tools = await runtime.list_tools(_connector(), {})
    finally:
        await runtime.stop_all()

    assert sorted(tool.name for tool in tools) == ["claims_close", "claims_read"]


async def test_the_annotations_that_decide_a_tier_survive_the_trip() -> None:
    """`UC-54.1-07` and `-08`: a tool the server calls destructive must arrive as such."""
    runtime = ConnectorRuntime()
    try:
        tools = {tool.name: tool for tool in await runtime.list_tools(_connector(), {})}
    finally:
        await runtime.stop_all()

    assert tools["claims_read"].annotations is not None
    assert tools["claims_read"].annotations.readOnlyHint is True
    assert tools["claims_close"].annotations is not None
    assert tools["claims_close"].annotations.destructiveHint is True


async def test_a_tool_call_returns_the_child_process_result() -> None:
    """The bridge forwards; it does not reinterpret what a tool answered."""
    runtime = ConnectorRuntime()
    try:
        result = await runtime.call_tool(_connector(), {}, "claims_read", {})
    finally:
        await runtime.stop_all()

    assert result.isError is False
    assert "a claim" in str(result.content)


def test_a_bridge_with_no_connector_says_so_rather_than_serving_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Pod started without CONNECTOR_SPEC would answer every call with a silent 404."""
    monkeypatch.delenv("CONNECTOR_SPEC", raising=False)
    settings.cache_clear()
    with pytest.raises(ValueError, match="CONNECTOR_SPEC"):
        bridged_connector()


def test_the_bridge_serves_the_connector_it_was_given(monkeypatch: pytest.MonkeyPatch) -> None:
    """The spec arrives as JSON on the Pod; the secret's name travels, its value does not."""
    spec = _connector().model_copy(update={"env_from_secret": "sap"})
    monkeypatch.setenv("CONNECTOR_SPEC", spec.model_dump_json())
    settings.cache_clear()
    connector = bridged_connector()
    assert connector.connector_id == "probe"
    assert connector.env_from_secret == "sap"
    assert bridge_server(connector, ConnectorRuntime()) is not None
    settings.cache_clear()
