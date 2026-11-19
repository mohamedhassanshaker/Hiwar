"""The client for the platform MCP server at `src/app/api/mcp/`.

Specification section 4.2, ownership rule: the agent service never connects to the domain
database. Every read and every change to domain data goes through this client, carrying the
acting person's run token, so it passes the same permission checks, validation and audit as a
person using the console. There is deliberately no database driver in this package.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.shared.exceptions import McpError
from mcp.types import CallToolResult, TextContent

from awp_agent.config import settings
from awp_agent.logging import logger

log = logger("awp_agent.clients.platform_mcp")


class PlatformMcpError(RuntimeError):
    """The platform refused a tool call, or the call failed in transit."""


@asynccontextmanager
async def session(token: str, url: str | None = None) -> AsyncIterator[ClientSession]:
    """An MCP session against the platform server, authenticated as the run's actor."""
    endpoint = url or settings().platform_mcp_url
    headers = {"authorization": f"Bearer {token or settings().platform_mcp_token}"}
    async with (
        streamablehttp_client(endpoint, headers=headers) as (read, write, _),
        ClientSession(read, write) as client,
    ):
        await client.initialize()
        yield client


def result_text(result: CallToolResult) -> str:
    """The text content of a tool result, joined."""
    return "\n".join(
        block.text for block in result.content if isinstance(block, TextContent)
    ).strip()


async def call_tool(
    token: str,
    name: str,
    arguments: dict[str, Any],
    url: str | None = None,
) -> Any:
    """Call one platform tool and return its structured content, or its text."""
    refusal: McpError | None = None
    async with session(token, url) as client:
        # The platform refuses with a JSON-RPC error. Raised out of the session it would leave
        # the transport's task group as an ExceptionGroup that no caller catches (D360).
        try:
            result = await client.call_tool(name, arguments)
        except McpError as refused:
            refusal = refused
    if refusal is not None:
        raise PlatformMcpError(refusal.error.message or f"{name} was refused") from refusal
    if result.isError:
        raise PlatformMcpError(result_text(result) or f"{name} was refused")
    if result.structuredContent is not None:
        return result.structuredContent
    return result_text(result)


async def list_tools(token: str, url: str | None = None) -> list[str]:
    """The tool names the platform offers this actor."""
    async with session(token, url) as client:
        listed = await client.list_tools()
    return [tool.name for tool in listed.tools]
