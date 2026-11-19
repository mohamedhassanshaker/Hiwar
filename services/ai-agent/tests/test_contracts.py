"""Contract tests: the platform MCP server, the AG-UI event stream and the gateway client.

They assert the shape of what the agent service sends and expects, so a change on either side
of a boundary is caught here rather than in a kind cluster.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, cast

import pytest
from ag_ui.core import EventType, TextMessageContentEvent, ToolCallStartEvent
from mcp.types import CallToolResult, TextContent

from awp_agent.clients import events, gateway_client, platform_mcp
from awp_agent.harness.tools import builtin
from awp_agent.harness.types import Actor


class _Session:
    """A stand-in MCP session that records what was asked of it."""

    def __init__(self, result: CallToolResult) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult:
        self.calls.append((name, arguments))
        return self.result


@pytest.fixture
def fake_session(monkeypatch: pytest.MonkeyPatch) -> _Session:
    """Replace the Streamable HTTP session with a recorder."""
    from contextlib import asynccontextmanager

    session = _Session(
        CallToolResult(
            content=[TextContent(type="text", text="ok")],
            structuredContent={"id": "x-1"},
        )
    )

    @asynccontextmanager
    async def fake(token: str, url: str | None = None) -> Any:
        session.calls.append(("__session__", {"token": token, "url": url}))
        yield session

    monkeypatch.setattr(platform_mcp, "session", fake)
    return session


async def test_a_platform_tool_call_carries_the_actor_s_token(fake_session: _Session) -> None:
    """Specification section 4.2: the agent acts as a person, never as itself."""
    result = await platform_mcp.call_tool("token-1", "work_item_create", {"title": "Check"})
    assert result == {"id": "x-1"}
    assert ("__session__", {"token": "token-1", "url": None}) in fake_session.calls
    assert ("work_item_create", {"title": "Check"}) in fake_session.calls


async def test_a_refusal_is_raised_not_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """When the platform refuses, the agent is told plainly instead of carrying on."""
    from contextlib import asynccontextmanager

    refused = CallToolResult(
        content=[TextContent(type="text", text="You do not have access")], isError=True
    )

    @asynccontextmanager
    async def fake(token: str, url: str | None = None) -> Any:
        yield _Session(refused)

    monkeypatch.setattr(platform_mcp, "session", fake)
    with pytest.raises(platform_mcp.PlatformMcpError, match="You do not have access"):
        await platform_mcp.call_tool("token-1", "person_delete", {})


def test_the_builtin_tools_are_all_declared_with_a_schema() -> None:
    """Every tool the model is offered carries a JSON Schema it can fill in."""
    for tool in builtin.BUILTIN_TOOLS:
        assert tool.parameters_json_schema.get("type") == "object"
        assert tool.description


def test_an_agui_event_is_encoded_in_the_shape_the_browser_expects() -> None:
    """The console's AG-UI client reads camelCase fields and a `type` discriminator."""
    payload = json.loads(events.encode(TextMessageContentEvent(message_id="m-1", delta="Hello")))
    assert payload["type"] == EventType.TEXT_MESSAGE_CONTENT
    assert payload["messageId"] == "m-1"
    assert payload["delta"] == "Hello"


def test_a_tool_call_event_names_the_tool() -> None:
    """The room shows which tool an agent is running while it runs."""
    payload = json.loads(
        events.encode(ToolCallStartEvent(tool_call_id="c-1", tool_call_name="close_request"))
    )
    assert payload["toolCallId"] == "c-1"
    assert payload["toolCallName"] == "close_request"


def test_the_event_stream_is_per_run() -> None:
    """Two runs in the same room never see each other's events."""
    assert events.stream_key("r-1") != events.stream_key("r-2")
    assert events.stream_key("r-1") == "run:r-1:agui"


def test_cost_is_estimated_to_four_decimal_places() -> None:
    """Money in this platform is `numeric(18,4)` and always an estimate."""
    cost = gateway_client.estimate_cost_aed(1000, 1000)
    assert cost == Decimal("0.0440")
    assert cost.as_tuple().exponent == -4


def test_the_route_alias_is_the_model_name() -> None:
    """LiteLLM resolves the alias and its fallback chain; the harness never names a provider."""
    model = gateway_client.model_for_route("default-balanced")
    assert model.model_name == "default-balanced"


def test_an_actor_is_required_for_every_tool_call() -> None:
    """There is no service identity: a tool call always belongs to a person."""
    actor = Actor(person_id="p-1", mcp_token="t-1")
    assert actor.mcp_token


class TestGatewayBaseUrl:
    """The URL every model call is built from.

    `AGW_LLM_URL` names agentgateway's listener, not its OpenAI-compatible API. The OpenAI
    client appends `/chat/completions` to whatever base it is handed, so a base without
    `/v1` sent every call to a path agentgateway answers `404 route not found` on — while
    the health probe, which spells out `/v1/models` itself, went on reporting the gateway
    up. Health was green and no agent could produce a word.
    """

    def test_the_base_carries_the_version_segment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from awp_agent import config
        from awp_agent.clients import gateway_client

        monkeypatch.setenv("AGW_LLM_URL", "http://ai-gateway.awp-ai.svc.cluster.local:8080")
        config.settings.cache_clear()

        assert gateway_client.openai_base_url().endswith("/v1")
        assert gateway_client.openai_base_url() == (
            "http://ai-gateway.awp-ai.svc.cluster.local:8080/v1"
        )

    def test_the_neo4j_credential_comes_from_the_one_the_deployment_carries(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The chart puts Neo4j's own `user/password` value in the environment.

        Without reading it the driver sent no credentials and Neo4j refused every graph
        call with "Unsupported authentication token".
        """
        from awp_agent import config

        monkeypatch.setenv("NEO4J_AUTH", "neo4j/a-password")
        monkeypatch.delenv("NEO4J_USER", raising=False)
        monkeypatch.delenv("NEO4J_PASSWORD", raising=False)
        config.settings.cache_clear()

        assert config.settings().neo4j_user == "neo4j"
        assert config.settings().neo4j_password == "a-password"

    def test_an_explicit_user_and_password_win(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A developer pointing the service at a database of their own says so directly."""
        from awp_agent import config

        monkeypatch.setenv("NEO4J_AUTH", "neo4j/a-password")
        monkeypatch.setenv("NEO4J_USER", "someone")
        monkeypatch.setenv("NEO4J_PASSWORD", "another")
        config.settings.cache_clear()

        assert config.settings().neo4j_user == "someone"
        assert config.settings().neo4j_password == "another"

    def test_the_graph_client_is_built_on_the_same_base(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Graphiti appends its own paths too, so it needs the API rather than the listener.

        Pointed at the listener, every Graph and Hybrid retrieval came back as
        `route not found` while Vector went on answering.
        """
        from graphiti_core.embedder import OpenAIEmbedder

        from awp_agent import config
        from awp_agent.clients import gateway_client
        from awp_agent.ingestion import graph

        monkeypatch.setenv("AGW_LLM_URL", "http://ai-gateway.awp-ai.svc.cluster.local:8080")
        config.settings.cache_clear()
        graph.client.cache_clear()

        built = graph.client()
        wanted = gateway_client.openai_base_url()
        assert str(built.llm_client.config.base_url) == wanted
        # `EmbedderClient` is the declared type and carries no `config`; the OpenAI one does.
        embedder = cast(OpenAIEmbedder, built.embedder)
        assert str(embedder.config.base_url) == wanted

    def test_a_trailing_slash_does_not_double_the_separator(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from awp_agent import config
        from awp_agent.clients import gateway_client

        monkeypatch.setenv("AGW_LLM_URL", "http://ai-gateway.awp-ai.svc.cluster.local:8080/")
        config.settings.cache_clear()

        assert gateway_client.openai_base_url() == (
            "http://ai-gateway.awp-ai.svc.cluster.local:8080/v1"
        )


def test_every_activity_the_mission_runs_is_registered_on_the_worker() -> None:
    """A worker rejects an activity it was not registered with.

    `register_delegated_run` was once missing from the registry and nothing noticed:
    every workflow test passed because the test worker registers its own fakes, so the
    omission would only have appeared on the cluster, as the first delegation of the
    first mission that tried one.

    This reads the mission workflow's source for the activity functions it names and
    checks each against what `worker.py` registers, so the next activity added cannot be
    half-wired the same way. The agent's own activities — the model request and the
    toolsets — are registered by `PydanticAIPlugin` from the agent itself and are not
    named here.
    """
    import ast
    import re
    from pathlib import Path

    source = Path("src/awp_agent/mission/runtime.py").read_text(encoding="utf-8")
    executed: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "execute_activity"):
            continue
        if node.args and isinstance(node.args[0], ast.Name):
            executed.add(node.args[0].id)

    assert executed, "no execute_activity calls found; the parser needs updating"

    worker_source = Path("src/awp_agent/worker.py").read_text(encoding="utf-8")
    registered_block = worker_source[worker_source.index("AGENT_RUNS: (") :]
    registered = set(re.findall(r"[a-z_]+", registered_block.split("),")[0]))

    assert executed <= registered, f"not registered on the worker: {sorted(executed - registered)}"
