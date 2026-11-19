"""Bridge mode: one stdio MCP server, offered over Streamable HTTP.

The control process never runs a connector's code. It creates one Deployment per stdio
connector running this same image with `CONNECTOR_MODE=bridge`, and proxies to it — so what
the bridge has to be is an MCP server at `/mcp` whose tools are the child process's tools.

It forwards rather than reimplements: `tools/list` and `tools/call` go straight to the child
over stdio and the child's own result comes back. A tool's schema, annotations and errors are
the server's to decide, and a bridge that reinterpreted them would be lying about what the
connector offers.
"""

from __future__ import annotations

from typing import Any

from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

from awp_connectors.config import settings
from awp_connectors.registry import ConnectorSpec
from awp_connectors.runtime import ConnectorRuntime
from awp_connectors.secrets import environment_for


def bridged_connector() -> ConnectorSpec:
    """The one connector this bridge serves, as the control process configured it.

    :raises ValueError: when the Pod was started without a connector to run.
    """
    spec = settings().connector_spec
    if not spec:
        raise ValueError("CONNECTOR_SPEC is not set: this bridge has no connector to run")
    return ConnectorSpec.model_validate_json(spec).validated()


def bridge_server(connector: ConnectorSpec, runtime: ConnectorRuntime) -> Server[Any, Any]:
    """An MCP server whose tools are the child process's tools."""
    server: Server[Any, Any] = Server(connector.name or connector.connector_id)
    environment = environment_for(connector.env_from_secret)

    # The SDK's low-level decorators carry no annotations.
    @server.list_tools()  # type: ignore[no-untyped-call, untyped-decorator]
    async def _list_tools() -> list[types.Tool]:
        return await runtime.list_tools(connector, environment)

    # The child validated the arguments against its own schema already, and validating them
    # here against a schema this process only forwarded would refuse calls the connector
    # would have accepted.
    @server.call_tool(validate_input=False)  # type: ignore[untyped-decorator]
    async def _call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        return await runtime.call_tool(connector, environment, name, arguments)

    return server


def session_manager(server: Server[Any, Any]) -> StreamableHTTPSessionManager:
    """The Streamable HTTP transport the control process connects to."""
    # Stateless: the control process opens a session per call and the child holds no
    # per-client state, so keeping sessions would only grow a table nothing reads.
    return StreamableHTTPSessionManager(app=server, stateless=True)
