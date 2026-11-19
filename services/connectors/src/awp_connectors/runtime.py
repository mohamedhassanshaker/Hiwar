"""Run one MCP server per connector and offer it over Streamable HTTP.

A stdio connector is started as a child process in its own Pod and spoken to over stdio; an
HTTP connector is called where it lives. Either way the harness sees one Streamable HTTP
endpoint per connector, which is what keeps the tool pool in the agent service simple.

Sessions are cached per connector, because starting a stdio server costs a process start and a
handshake, and an agent usually calls a connector several times in one run.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack, suppress
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client
from mcp.types import CallToolResult, Tool

from awp_connectors.logging import logger
from awp_connectors.registry import ConnectorSpec

log = logger("awp_connectors.runtime")

#: How long a stop waits for the session's own task to unwind before cancelling it.
STOP_TIMEOUT_SECONDS = 10.0

_Work = tuple[Callable[[ClientSession], Awaitable[Any]], "asyncio.Future[Any]"]


class ConnectorError(RuntimeError):
    """The connector could not be started or could not be reached."""


def _reason(problem: BaseException) -> str:
    """The message an admin can act on.

    The MCP transports run inside task groups, so a connection failure arrives wrapped in an
    `ExceptionGroup` whose own text is "unhandled errors in a TaskGroup" — true, and no use
    to someone deciding whether they typed the URL wrong. The leaves carry the real reason.
    """
    if isinstance(problem, BaseExceptionGroup):
        leaves = [_reason(leaf) for leaf in problem.exceptions]
        return "; ".join(dict.fromkeys(filter(None, leaves))) or str(problem)
    return f"{type(problem).__name__}: {problem}" if str(problem) else type(problem).__name__


class _Connection:
    """One connector's MCP session, opened and closed by a single task.

    The MCP client context managers open anyio task groups, and an anyio cancel scope may
    only be exited by the task that entered it. A session cached across requests and closed
    by whichever request happened to trigger the reload therefore unwinds with "Attempted to
    exit cancel scope in a different task", which reaches the caller as a 500 with no reason
    instead of the handshake error the Connectors screen needs. So one task owns the whole
    lifecycle and every caller hands it work through a queue.
    """

    def __init__(self, connector: ConnectorSpec, environment: dict[str, str]) -> None:
        """Start the task that opens the session; `started()` waits for its handshake.

        Must be called inside a running event loop.
        """
        self._connector = connector
        self._environment = environment
        self._work: asyncio.Queue[_Work | None] = asyncio.Queue()
        self._ready: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._task = asyncio.create_task(
            self._serve(), name=f"connector-{connector.connector_id}"
        )

    @property
    def alive(self) -> bool:
        """Whether the session's task is still serving work."""
        return not self._task.done()

    async def started(self) -> None:
        """Wait for the handshake.

        :raises ConnectorError: when the server could not be started or reached.
        """
        await self._ready

    async def run(self, call: Callable[[ClientSession], Awaitable[Any]]) -> Any:
        """Run one call against the session, from any task."""
        if self._task.done():
            raise ConnectorError(f"{self._connector.connector_id} is not running")
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        await self._work.put((call, future))
        return await future

    async def stop(self) -> None:
        """Ask the session's task to close, and cancel it if it will not."""
        if self._task.done():
            return
        await self._work.put(None)
        try:
            await asyncio.wait_for(asyncio.shield(self._task), STOP_TIMEOUT_SECONDS)
        except TimeoutError:
            # Cancellation is delivered to the task that entered the scope, so it still
            # unwinds in the right place.
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task

    async def _serve(self) -> None:
        """Open the session, resolve the handshake, serve queued calls, then close it.

        A stdio connector is started as a child process with the connector's environment;
        any other is reached over Streamable HTTP with its credential headers and query. Every
        way the task ends fails the handshake, if still pending, and the calls still queued,
        with a `ConnectorError` whose reason has the credential redacted.
        """
        connector = self._connector
        try:
            async with AsyncExitStack() as stack:
                if connector.transport == "stdio":
                    parameters = StdioServerParameters(
                        command=connector.command[0],
                        args=[*connector.command[1:], *connector.args],
                        env=self._environment,
                    )
                    read, write = await stack.enter_async_context(stdio_client(parameters))
                else:
                    # D296: the credential's headers; the SDK closes only a client it made.
                    client = await stack.enter_async_context(
                        create_mcp_http_client(headers=connector.headers or None)
                    )
                    client.params = client.params.merge(connector.query)
                    read, write, _ = await stack.enter_async_context(
                        streamable_http_client(connector.url, http_client=client)
                    )
                session = await stack.enter_async_context(ClientSession(read, write))
                await session.initialize()
                if not self._ready.done():
                    self._ready.set_result(None)
                await self._work_loop(session)
        except asyncio.CancelledError:
            self._fail(ConnectorError(f"{connector.connector_id} was stopped"))
            raise
        except Exception as problem:  # noqa: BLE001 - the task body must fail its callers, not die silently
            stage = "did not start" if not self._ready.done() else "failed"
            reason = connector.redact(_reason(problem))
            failure = ConnectorError(f"{connector.connector_id} {stage}: {reason}")
            log.warning("connector %s %s: %s", connector.connector_id, stage, reason)
            self._fail(failure)
        else:
            self._fail(ConnectorError(f"{connector.connector_id} was stopped"))

    async def _work_loop(self, session: ClientSession) -> None:
        """Serve calls until a stop arrives. A failing call fails only its own caller."""
        while True:
            item = await self._work.get()
            if item is None:
                return
            call, future = item
            try:
                result = await call(session)
            except Exception as problem:  # noqa: BLE001 - a failing call fails its caller, not the session
                if not future.done():
                    future.set_exception(problem)
            else:
                if not future.done():
                    future.set_result(result)

    def _fail(self, failure: ConnectorError) -> None:
        """Hand the error to the handshake and to everything still queued."""
        if not self._ready.done():
            self._ready.set_exception(failure)
        else:
            # Nobody is waiting on a resolved handshake; retrieving it keeps asyncio from
            # reporting it as an exception that was never consumed.
            self._ready.exception()
        while not self._work.empty():
            item = self._work.get_nowait()
            if item is None:
                continue
            _, future = item
            if not future.done():
                future.set_exception(failure)


class ConnectorRuntime:
    """The live sessions, one per connector."""

    def __init__(self) -> None:
        self._connections: dict[str, _Connection] = {}
        self._lock = asyncio.Lock()

    async def session(
        self, connector: ConnectorSpec, environment: dict[str, str]
    ) -> _Connection:
        """The session of one connector, started on first use.

        :raises ConnectorError: when the server could not be started or reached.
        """
        async with self._lock:
            existing = self._connections.get(connector.connector_id)
            if existing is not None and existing.alive:
                connection = existing
            else:
                connection = _Connection(connector, environment)
                self._connections[connector.connector_id] = connection

        try:
            # Outside the lock: one unreachable connector must not hold up every other.
            await connection.started()
        except ConnectorError:
            async with self._lock:
                if self._connections.get(connector.connector_id) is connection:
                    del self._connections[connector.connector_id]
            raise
        return connection

    async def list_tools(
        self, connector: ConnectorSpec, environment: dict[str, str]
    ) -> list[Tool]:
        """The tools one connector offers, as the Connectors screen lists them."""
        connection = await self.session(connector, environment)
        listed = await connection.run(lambda session: session.list_tools())
        return list(listed.tools)

    async def call_tool(
        self,
        connector: ConnectorSpec,
        environment: dict[str, str],
        name: str,
        arguments: dict[str, Any],
    ) -> CallToolResult:
        """Call one tool on one connector."""
        connection = await self.session(connector, environment)
        result: CallToolResult = await connection.run(
            lambda session: session.call_tool(name, arguments)
        )
        return result

    async def stop(self, connector_id: str) -> None:
        """Stop one connector's server. Called on save, so a changed connector restarts."""
        async with self._lock:
            connection = self._connections.pop(connector_id, None)
        if connection is not None:
            await connection.stop()

    async def stop_all(self) -> None:
        """Stop every connector, on shutdown."""
        for connector_id in list(self._connections):
            await self.stop(connector_id)
