"""The connector runtime's HTTP surface.

The same image runs in two modes.

**`control`** — the service the web app and the harness talk to. `/connectors` is the control
plane the web app calls when a connector is saved; `/mcp/{id}` is the endpoint the harness
calls for tools. For a stdio connector it creates one Deployment and Service per connector and
proxies to it, so no connector's code ever runs in this process.

**`bridge`** — one connector, named by `CONNECTOR_ID`. It starts that one stdio MCP server as
its child and serves `/mcp` for it. This is what the per-connector Pod runs.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from mcp.types import TextContent
from pydantic import BaseModel
from starlette.types import Receive, Scope, Send

from awp_connectors.bridge import bridge_server, bridged_connector, session_manager
from awp_connectors.config import settings
from awp_connectors.logging import configure, logger
from awp_connectors.pods import PodError, PodManager
from awp_connectors.registry import ConnectorSpec, Registry
from awp_connectors.runtime import ConnectorError, ConnectorRuntime
from awp_connectors.secrets import environment_for, redact

log = logger("awp_connectors.main")

registry = Registry()
runtime = ConnectorRuntime()
pods: PodManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start with no connectors; the web app pushes the set on boot and on every save."""
    global pods
    config = settings()
    configure(config.log_level)
    if config.mode == "control":
        try:
            pods = PodManager(config.bridge_image)
        except Exception as problem:  # noqa: BLE001 - outside a cluster there is no API to reach
            log.warning("pods.unavailable", error=str(problem))
            pods = None
        await _restore()
        try:
            yield
        finally:
            await runtime.stop_all()
            pods = None
        return

    # Bridge mode: one connector, served at /mcp for the control process to proxy to.
    connector = bridged_connector()
    registry.replace([connector])
    manager = session_manager(bridge_server(connector, runtime))
    log.info("bridge.start", connector=connector.connector_id)
    async with manager.run():
        app.state.mcp = manager.handle_request
        try:
            yield
        finally:
            await runtime.stop_all()


app = FastAPI(title="AWP connector runtime", version="0.1.0", lifespan=lifespan)


async def _bridged_mcp(scope: Scope, receive: Receive, send: Send) -> None:
    """The bridged connector's own MCP endpoint, as a plain ASGI app."""
    handle = getattr(app.state, "mcp", None)
    if handle is None:
        await PlainTextResponse("this runtime is not a connector bridge", status_code=503)(
            scope, receive, send
        )
        return
    await handle(scope, receive, send)


if settings().mode == "bridge":
    # Mounted only in bridge mode: in control mode `/mcp/{id}` and `/mcp/{id}/tools` are
    # the routes, and a mount on the same prefix would swallow both.
    app.mount("/mcp", _bridged_mcp)


class ReloadRequest(BaseModel):
    """The whole set of connectors. Hot reload replaces, it does not merge."""

    connectors: list[ConnectorSpec]


class ToolCallRequest(BaseModel):
    """One tool call against one connector."""

    name: str
    arguments: dict[str, Any] = {}


@app.put("/connectors")
async def reload(request: ReloadRequest) -> dict[str, Any]:
    """Replace the configured connectors and restart what changed (S-54, hot reload on save)."""
    before = set(registry.ids())
    try:
        ids = registry.replace(request.connectors)
    except ValueError as problem:
        raise HTTPException(status_code=422, detail=str(problem)) from problem

    for connector_id in before:
        await runtime.stop(connector_id)

    failures: dict[str, str] = {}
    if pods is not None:
        for connector_id in sorted(before - set(ids)):
            await _remove_pod(connector_id)
        for connector_id in ids:
            connector = registry.get(connector_id)
            if connector.transport == "stdio":
                reason = await _ensure_pod(connector)
                if reason:
                    failures[connector_id] = reason

    if pods is not None:
        try:
            await pods.save_configuration([registry.get(one) for one in ids])
        except PodError as problem:
            # The save itself stands; what is lost is only the recovery after a restart.
            log.error("state.save_failed", error=str(problem))

    # A connector whose workload could not be created is not configured, whatever the
    # registry now holds: reporting the whole save as a success would leave the console
    # showing it Connected and the admin finding out from a DNS error at the handshake.
    return {"connectors": ids, "failed": failures}


async def _restore() -> None:
    """Take back the set this runtime was last given.

    Without it a restarted control process serves no connector, and every agent tool call
    answers 404 until somebody happens to save a connector in the console.
    """
    if pods is None:
        return
    try:
        connectors = await pods.load_configuration()
    except PodError as problem:
        log.error("state.load_failed", error=str(problem))
        return
    if not connectors:
        return
    registry.replace(connectors)
    for connector in connectors:
        if connector.transport == "stdio":
            reason = await _ensure_pod(connector)
            if reason:
                log.error("pod.failed", connector=connector.connector_id, error=reason)
    log.info("state.restored", connectors=len(connectors))


@app.get("/connectors")
async def list_connectors() -> dict[str, Any]:
    """What this runtime is serving, with every secret value hidden."""
    return {
        "mode": settings().mode,
        "connectors": [
            {
                "id": connector_id,
                "transport": registry.get(connector_id).transport,
                "env": redact(environment_for(registry.get(connector_id).env_from_secret)),
            }
            for connector_id in registry.ids()
        ],
    }


@app.get("/mcp/{connector_id}/tools")
async def list_tools(connector_id: str) -> dict[str, Any]:
    """The tools one connector offers, for the Connectors screen's tool list."""
    connector = _connector(connector_id)
    try:
        tools = await runtime.list_tools(connector, environment_for(connector.env_from_secret))
    except ConnectorError as problem:
        raise HTTPException(status_code=502, detail=str(problem)) from problem
    return {
        "tools": [
            {
                "name": tool.name,
                "description": tool.description or "",
                # The two hints the console turns into a starting tier: a tool the server
                # itself calls destructive never starts unattended, and one that cannot
                # change anything may. Dropping them would make every tool unannotated.
                "readOnlyHint": _hint(tool, "readOnlyHint"),
                "destructiveHint": _hint(tool, "destructiveHint"),
                # What the platform MCP server tells an agent the tool takes (D223).
                "inputSchema": tool.inputSchema,
            }
            for tool in tools
        ]
    }


def _hint(tool: Any, name: str) -> bool | None:
    """One MCP tool annotation, or None when the server did not set it."""
    return getattr(tool.annotations, name, None) if tool.annotations else None


@app.post("/mcp/{connector_id}")
async def call_tool(connector_id: str, request: ToolCallRequest) -> dict[str, Any]:
    """Call one tool on one connector."""
    connector = _connector(connector_id)
    try:
        result = await runtime.call_tool(
            connector,
            environment_for(connector.env_from_secret),
            request.name,
            request.arguments,
        )
    except ConnectorError as problem:
        raise HTTPException(status_code=502, detail=str(problem)) from problem
    text = "\n".join(block.text for block in result.content if isinstance(block, TextContent))
    if result.isError:
        raise HTTPException(status_code=400, detail=text or f"{request.name} failed")
    return {
        "content": text,
        "structured": result.structuredContent,
        "raw": json.loads(result.model_dump_json()),
    }


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    """The readiness probe."""
    return {"status": "ok", "mode": settings().mode, "connectors": len(registry.ids())}


def _connector(connector_id: str) -> ConnectorSpec:
    """The registered connector to call, as this process reaches it.

    404 for an unknown id, 409 for one restored without its credential. In control mode a
    stdio connector is returned as an HTTP one at its bridge Pod's service.
    """
    try:
        connector = registry.get(connector_id)
    except KeyError as problem:
        raise HTTPException(status_code=404, detail=str(problem)) from problem
    if connector.credential_missing:
        # D296: restored after a restart without the headers it needs; the web app sends them again.
        raise HTTPException(status_code=409, detail=f"{connector_id} has no credential loaded")
    if settings().mode == "control" and connector.transport == "stdio":
        # The control process proxies; it never runs a connector's code itself.
        return connector.model_copy(
            update={"transport": "http", "url": _bridge_url(connector_id)}
        )
    return connector


def _bridge_url(connector_id: str) -> str:
    from awp_connectors.pods import service_url

    return service_url(connector_id)


async def _ensure_pod(connector: ConnectorSpec) -> str | None:
    """Create one stdio connector's workload. Returns the reason when it could not be."""
    if pods is None:
        return None
    try:
        await pods.ensure(connector)
    except PodError as problem:
        log.error("pod.failed", connector=connector.connector_id, error=str(problem))
        return str(problem)
    return None


async def _remove_pod(connector_id: str) -> None:
    """Delete one stdio connector's workload; a failure is logged, not raised."""
    if pods is None:
        return
    try:
        await pods.remove(connector_id)
    except PodError as problem:
        log.error("pod.remove_failed", connector=connector_id, error=str(problem))
