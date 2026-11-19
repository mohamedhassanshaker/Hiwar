"""The control-mode HTTP surface of the connector runtime.

Each endpoint is called through FastAPI's test client without the lifespan, so no
Kubernetes API is reached and no workload is created. The MCP calls to a connector are
replaced at the runtime object, which is where the network starts.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from mcp.types import CallToolResult, TextContent, Tool, ToolAnnotations

from awp_connectors import main
from awp_connectors.registry import ConnectorSpec
from awp_connectors.runtime import ConnectorError

HTTP_CONNECTOR = {
    "connector_id": "erp",
    "name": "ERP",
    "transport": "http",
    "url": "http://erp.test/mcp",
}


@pytest.fixture
def api() -> Iterator[TestClient]:
    main.registry.replace([])
    yield TestClient(main.app)
    main.registry.replace([])


def _serve(*connectors: dict[str, Any]) -> None:
    main.registry.replace([ConnectorSpec(**connector) for connector in connectors])


def test_a_reload_replaces_the_set_and_reports_no_failures(api: TestClient) -> None:
    _serve({**HTTP_CONNECTOR, "connector_id": "old"})

    answer = api.put("/connectors", json={"connectors": [HTTP_CONNECTOR]})

    assert answer.status_code == 200
    assert answer.json() == {"connectors": ["erp"], "failed": {}}
    assert main.registry.ids() == ["erp"]


def test_a_disabled_connector_is_not_served(api: TestClient) -> None:
    answer = api.put("/connectors", json={"connectors": [{**HTTP_CONNECTOR, "enabled": False}]})

    assert answer.json() == {"connectors": [], "failed": {}}


def test_a_connector_that_cannot_start_is_refused(api: TestClient) -> None:
    answer = api.put(
        "/connectors",
        json={"connectors": [{"connector_id": "bad", "name": "Bad", "transport": "http"}]},
    )

    assert answer.status_code == 422
    assert answer.json() == {"detail": "bad is an HTTP connector with no URL"}


def test_the_list_names_each_connector_and_hides_its_environment(api: TestClient) -> None:
    _serve(HTTP_CONNECTOR)

    answer = api.get("/connectors")

    assert answer.status_code == 200
    assert answer.json() == {
        "mode": "control",
        "connectors": [{"id": "erp", "transport": "http", "env": {}}],
    }


def test_the_tools_carry_the_server_s_own_hints(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _serve(HTTP_CONNECTOR)

    async def list_tools(connector: ConnectorSpec, environment: dict[str, str]) -> list[Tool]:
        return [
            Tool(
                name="claims.read",
                description="Read a claim.",
                inputSchema={"type": "object", "properties": {"id": {"type": "string"}}},
                annotations=ToolAnnotations(readOnlyHint=True),
            ),
            Tool(name="claims.write", inputSchema={"type": "object"}),
        ]

    monkeypatch.setattr(main.runtime, "list_tools", list_tools)

    answer = api.get("/mcp/erp/tools")

    assert answer.status_code == 200
    assert answer.json() == {
        "tools": [
            {
                "name": "claims.read",
                "description": "Read a claim.",
                "readOnlyHint": True,
                "destructiveHint": None,
                "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}},
            },
            {
                "name": "claims.write",
                "description": "",
                "readOnlyHint": None,
                "destructiveHint": None,
                "inputSchema": {"type": "object"},
            },
        ]
    }


def test_the_tools_of_an_unknown_connector_are_not_found(api: TestClient) -> None:
    answer = api.get("/mcp/nope/tools")

    assert answer.status_code == 404
    assert answer.json() == {"detail": "'no connector nope is configured'"}


def test_a_connector_that_does_not_answer_is_a_bad_gateway(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _serve(HTTP_CONNECTOR)

    async def list_tools(connector: ConnectorSpec, environment: dict[str, str]) -> list[Tool]:
        raise ConnectorError("erp did not answer the handshake")

    monkeypatch.setattr(main.runtime, "list_tools", list_tools)

    answer = api.get("/mcp/erp/tools")

    assert answer.status_code == 502
    assert answer.json() == {"detail": "erp did not answer the handshake"}


def _calling(monkeypatch: pytest.MonkeyPatch, result: CallToolResult | Exception) -> list[Any]:
    seen: list[Any] = []

    async def call_tool(
        connector: ConnectorSpec, environment: dict[str, str], name: str, arguments: dict[str, Any]
    ) -> CallToolResult:
        seen.append((connector.connector_id, name, arguments))
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(main.runtime, "call_tool", call_tool)
    return seen


def test_a_tool_call_returns_its_text_and_structured_content(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _serve(HTTP_CONNECTOR)
    seen = _calling(
        monkeypatch,
        CallToolResult(
            content=[
                TextContent(type="text", text="EXP-1042"),
                TextContent(type="text", text="Open"),
            ],
            structuredContent={"key": "EXP-1042"},
        ),
    )

    answer = api.post("/mcp/erp", json={"name": "claims.read", "arguments": {"key": "EXP-1042"}})

    assert answer.status_code == 200
    body = answer.json()
    assert body["content"] == "EXP-1042\nOpen"
    assert body["structured"] == {"key": "EXP-1042"}
    assert body["raw"]["isError"] is False
    assert seen == [("erp", "claims.read", {"key": "EXP-1042"})]


def test_a_tool_that_reports_an_error_is_a_bad_request(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _serve(HTTP_CONNECTOR)
    _calling(monkeypatch, CallToolResult(content=[], isError=True))

    answer = api.post("/mcp/erp", json={"name": "claims.write"})

    assert answer.status_code == 400
    assert answer.json() == {"detail": "claims.write failed"}


def test_a_tool_call_the_connector_cannot_take_is_a_bad_gateway(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _serve(HTTP_CONNECTOR)
    _calling(monkeypatch, ConnectorError("erp closed the session"))

    answer = api.post("/mcp/erp", json={"name": "claims.read"})

    assert answer.status_code == 502


def test_a_tool_call_to_an_unknown_connector_is_not_found(api: TestClient) -> None:
    assert api.post("/mcp/nope", json={"name": "x"}).status_code == 404


def test_a_tool_call_without_a_name_is_refused(api: TestClient) -> None:
    assert api.post("/mcp/erp", json={}).status_code == 422


def test_health_reports_the_mode_and_the_count(api: TestClient) -> None:
    _serve(HTTP_CONNECTOR)

    assert api.get("/healthz").json() == {"status": "ok", "mode": "control", "connectors": 1}


def test_a_connector_restored_without_its_credential_is_refused_not_called(api: TestClient) -> None:
    """D296: after a restart the web app sends the headers again on a 409.

    The call does not go out without them.
    """
    _serve({**HTTP_CONNECTOR, "needs_credential": True})

    assert api.get("/mcp/erp/tools").status_code == 409
    assert api.post("/mcp/erp", json={"name": "read", "arguments": {}}).status_code == 409
