"""The AG-UI event bus, on a Valkey stream per run.

A run is a Temporal workflow, and the activity that produces an event may run on any worker,
while the browser is attached to one FastAPI replica. Events therefore travel over the stream
`run:<id>:agui` (stack specification 7.2), and `/agui/runs/{id}/stream` reads it.

A stream, not pub/sub: every event keeps an offset, so a browser that attaches a moment late,
reconnects, or joins a run that is already half way through, replays from where it left off
instead of losing what it missed (4.3.4).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from ag_ui.core import BaseEvent
from valkey.asyncio import Valkey

from awp_agent.config import settings
from awp_agent.logging import logger

log = logger("awp_agent.clients.events")

# How many events one run keeps, and for how long. A run that nobody reads is swept by the
# expiry; the cap bounds a long one.
BACKLOG_LIMIT = 5_000
BACKLOG_TTL_SECONDS = 60 * 60 * 6
# How long one read waits for the next event before looping, in milliseconds.
READ_BLOCK_MS = 15_000
# The offset meaning "everything from the beginning of the stream".
START = "0-0"

FIELD = "event"


def stream_key(run_id: str) -> str:
    """The AG-UI stream of one run."""
    return f"run:{run_id}:agui"


def _client(socket_timeout: float = 5) -> Valkey:
    client: Valkey = Valkey.from_url(
        settings().valkey_url, decode_responses=True, socket_timeout=socket_timeout
    )
    return client


def encode(event: BaseEvent) -> str:
    """One AG-UI event as the JSON the browser receives."""
    return event.model_dump_json(by_alias=True, exclude_none=True)


async def publish(run_id: str, event: BaseEvent) -> str:
    """Append an event to the run's stream. Returns the offset it was written at."""
    payload = encode(event)
    client = _client()
    try:
        offset: str = await client.xadd(
            stream_key(run_id), {FIELD: payload}, maxlen=BACKLOG_LIMIT, approximate=True
        )
        await client.expire(stream_key(run_id), BACKLOG_TTL_SECONDS)
        return offset
    finally:
        await client.aclose()


async def backlog(run_id: str, after: str = START) -> list[str]:
    """Every event published for a run so far, oldest first."""
    client = _client()
    try:
        # `(` makes the bound exclusive, so a reconnect never replays what it already has.
        lower = "-" if after == START else f"({after}"
        entries = await client.xrange(stream_key(run_id), min=lower)
        return [fields[FIELD] for _offset, fields in entries]
    finally:
        await client.aclose()


async def stream(run_id: str, after: str = START) -> AsyncIterator[str]:
    """The run's events from an offset, then every event published from now on.

    `after` is the offset of the last event the caller already has, so a reconnect passes
    the one it saw last and receives exactly what it missed.

    The read blocks the Valkey connection itself for `READ_BLOCK_MS`, which needs a client
    socket timeout longer than that — the default of 5s otherwise fires first on every run
    whose next event is more than 5s away, which a real model call routinely is, and the
    stream dies with `TimeoutError` before Valkey's own BLOCK would ever time out.
    """
    client = _client(socket_timeout=READ_BLOCK_MS / 1000 + 5)
    key = stream_key(run_id)
    offset = after
    try:
        while True:
            response: Any = await client.xread({key: offset}, count=200, block=READ_BLOCK_MS)
            if not response:
                continue
            for _key, entries in response:
                for entry_offset, fields in entries:
                    offset = entry_offset
                    payload = fields.get(FIELD)
                    if payload is not None:
                        yield payload
    finally:
        await client.aclose()


async def bus_healthy() -> bool:
    """True when Valkey answers a ping."""
    client = _client()
    try:
        return bool(await client.ping())
    except Exception:  # noqa: BLE001 - a health probe reports, it never raises
        return False
    finally:
        await client.aclose()
