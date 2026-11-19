"""A stand-in for the platform MCP server, served over Streamable HTTP on a free local port.

The runtime reaches the platform's tools through the library's own MCP client, so a test
that wants the platform toolset exercised needs a real MCP server at the end of a URL. This
is the MCP SDK's server with whatever tools the test gives it; every JSON-RPC method that
reaches it is recorded, so a test can count attempts the way the platform would see them.
"""

from __future__ import annotations

import asyncio
import json
import socket
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import uvicorn
from mcp.server.fastmcp import FastMCP

ASGIApp = Callable[..., Any]


@dataclass
class Served:
    """One running server: where it is, and what reached it."""

    url: str
    #: The JSON-RPC method of every POST, in order (`initialize`, `tools/list`, `tools/call`).
    methods: list[str] = field(default_factory=list)
    #: The bearer each POST carried.
    bearers: list[str] = field(default_factory=list)


def _method(body: bytes) -> str:
    try:
        return str(json.loads(body).get("method", ""))
    except (ValueError, AttributeError):
        return ""


def _recording(
    app: ASGIApp, served: Served, unavailable_for: frozenset[str], refusing: dict[str, str]
) -> ASGIApp:
    """Record each POST's method, answer 503 to the methods in `unavailable_for`, and answer a
    call to a tool in `refusing` with a JSON-RPC error carrying its message, as the platform
    refuses a call it does not permit (`apps/web/src/mcp/server.ts`)."""

    async def wrapped(scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await app(scope, receive, send)
            return
        body = b""
        more = True
        while more:
            message = await receive()
            body += message.get("body", b"")
            more = message.get("more_body", False)
        method = _method(body)
        served.methods.append(method)
        headers = dict(scope.get("headers", []))
        served.bearers.append(headers.get(b"authorization", b"").decode())
        if method in unavailable_for:
            await send({"type": "http.response.start", "status": 503, "headers": []})
            await send({"type": "http.response.body", "body": b"unavailable"})
            return
        request = json.loads(body) if method == "tools/call" else {}
        refusal = refusing.get(str(request.get("params", {}).get("name", "")))
        if refusal is not None:
            error = {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "error": {"code": -32003, "message": refusal},
            }
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": json.dumps(error).encode()})
            return
        delivered = False

        async def replay() -> dict[str, Any]:
            nonlocal delivered
            if delivered:
                return await receive()  # type: ignore[no-any-return]
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        await app(scope, replay, send)

    return wrapped


@asynccontextmanager
async def serving(
    tools: dict[str, Callable[..., Any]] | None = None,
    *,
    unavailable_for: set[str] | None = None,
    refusing: dict[str, str] | None = None,
) -> AsyncIterator[Served]:
    """Serve `tools` as the platform MCP server at `/api/mcp` until the block ends."""
    server = FastMCP("platform", stateless_http=True, streamable_http_path="/api/mcp")
    for name, tool in (tools or {}).items():
        server.add_tool(tool, name=name)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    served = Served(url=f"http://127.0.0.1:{port}/api/mcp")
    web = uvicorn.Server(
        uvicorn.Config(
            _recording(
                server.streamable_http_app(),
                served,
                frozenset(unavailable_for or ()),
                refusing or {},
            ),
            log_level="warning",
            lifespan="on",
            ws="none",
        )
    )
    running = asyncio.create_task(web.serve(sockets=[listener]))
    try:
        while not web.started:
            if running.done():
                running.result()
            await asyncio.sleep(0.01)
        yield served
    finally:
        web.should_exit = True
        await running
        listener.close()
