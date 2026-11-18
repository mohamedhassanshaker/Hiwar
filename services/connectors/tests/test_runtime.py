"""The session lifecycle: a connector that cannot be reached says so, every time.

The MCP client context managers open anyio task groups, and an anyio cancel scope may only
be exited by the task that entered it. These check the consequence that mattered: a failed
handshake has to arrive as `ConnectorError` with the reason, not as a `RuntimeError` about
cancel scopes that reaches the Connectors screen as a 500 with nothing in it.
"""

from __future__ import annotations

import httpx
import pytest

from awp_connectors import runtime as runtime_module
from awp_connectors.registry import ConnectorSpec
from awp_connectors.runtime import ConnectorError, ConnectorRuntime, _reason


def _unreachable() -> ConnectorSpec:
    return ConnectorSpec(
        connector_id="nowhere",
        name="Nowhere",
        transport="http",
        url="https://mcp.nothing.invalid/mcp",
    )


async def test_an_unreachable_server_reports_the_handshake_error() -> None:
    """`UC-54.1-05`: the admin is shown why, and may add the connector as Disabled."""
    runtime = ConnectorRuntime()
    with pytest.raises(ConnectorError, match="did not start"):
        await runtime.list_tools(_unreachable(), {})
    await runtime.stop_all()


async def test_a_failed_handshake_is_not_cached_as_a_dead_session() -> None:
    """The server may come back; a second attempt has to try again rather than reuse it."""
    runtime = ConnectorRuntime()
    for _ in range(2):
        with pytest.raises(ConnectorError):
            await runtime.list_tools(_unreachable(), {})
    await runtime.stop_all()


async def test_stopping_a_connector_that_never_started_is_not_an_error() -> None:
    """Reload stops every connector it is replacing, including ones that never came up."""
    runtime = ConnectorRuntime()
    with pytest.raises(ConnectorError):
        await runtime.list_tools(_unreachable(), {})
    # Called from a different task than the one that opened the session, which is the case
    # that used to unwind in the wrong cancel scope.
    await runtime.stop("nowhere")
    await runtime.stop_all()


def test_the_reason_comes_from_inside_the_task_group() -> None:
    """A failure arrives wrapped; "unhandled errors in a TaskGroup" helps nobody."""
    lost = OSError("Name or service not known")
    group = ExceptionGroup("unhandled errors in a TaskGroup", [lost])
    assert _reason(group) == "OSError: Name or service not known"
    # Nested groups and duplicates collapse to the distinct reasons.
    nested = ExceptionGroup("outer", [group, ExceptionGroup("inner", [lost])])
    assert _reason(nested) == "OSError: Name or service not known"


async def test_an_http_session_sends_the_credential_and_never_reports_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D296: the headers and query parameter reach the server; a refusal quoting them does not."""
    seen: list[httpx.Request] = []

    def refuse(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(401, request=request)

    def client(headers: dict[str, str] | None = None) -> httpx.AsyncClient:
        return httpx.AsyncClient(headers=headers, transport=httpx.MockTransport(refuse))

    monkeypatch.setattr(runtime_module, "create_mcp_http_client", client)
    spec = ConnectorSpec(
        connector_id="erp",
        name="ERP",
        transport="http",
        url="https://erp.test/mcp",
        headers={"authorization": "Bearer h-s3cret"},
        query={"key": "q-s3cret"},
    )
    runtime = ConnectorRuntime()
    with pytest.raises(ConnectorError) as refused:
        await runtime.list_tools(spec, {})
    await runtime.stop_all()

    assert seen
    assert seen[0].headers["authorization"] == "Bearer h-s3cret"
    assert seen[0].url.params["key"] == "q-s3cret"
    assert "s3cret" not in str(refused.value)
