"""Wait for a dependency to accept connections, then exit.

The init containers of the agent service run this: `python -m awp_agent.wait_for
<target>`, where a target is either `host:port` or an HTTP URL. It exits 0 as soon as the
target answers and non-zero when the deadline passes, so a Pod that cannot reach what it
needs fails visibly instead of crash-looping on its first request.
"""

from __future__ import annotations

import asyncio
import sys
from urllib.parse import urlparse

import httpx

from awp_agent.logging import configure, logger

log = logger("awp_agent.wait_for")

DEFAULT_TIMEOUT = 120.0
PROBE_INTERVAL = 2.0
PROBE_TIMEOUT = 5.0


async def probe_tcp(host: str, port: int) -> bool:
    """True when something accepts a TCP connection on the address."""
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), PROBE_TIMEOUT)
    except (OSError, TimeoutError):
        return False
    writer.close()
    await writer.wait_closed()
    return True


async def probe_http(url: str) -> bool:
    """True when the URL answers with any status below 500."""
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
            response = await client.get(url)
    except httpx.HTTPError:
        return False
    return response.status_code < 500


async def probe(target: str) -> bool:
    """Probe `host:port` as TCP and anything with an http(s) scheme as a request."""
    parsed = urlparse(target)
    if parsed.scheme in ("http", "https"):
        return await probe_http(target)
    host, separator, port = target.rpartition(":")
    if not separator or not port.isdigit():
        raise SystemExit(f"{target} is neither host:port nor an http(s) URL")
    return await probe_tcp(host, int(port))


async def probe_until_ready(target: str) -> int:
    """Probe until the target answers, returning how many attempts it took."""
    attempt = 0
    while True:
        attempt += 1
        if await probe(target):
            return attempt
        await asyncio.sleep(PROBE_INTERVAL)


async def wait_for(target: str, seconds: float = DEFAULT_TIMEOUT) -> bool:
    """Probe until the target answers or `seconds` pass."""
    try:
        async with asyncio.timeout(seconds):
            attempt = await probe_until_ready(target)
    except TimeoutError:
        log.error("wait_for.timeout", target=target, seconds=seconds)
        return False
    log.info("wait_for.ready", target=target, attempt=attempt)
    return True


def main() -> None:
    """`python -m awp_agent.wait_for <target> [timeout-seconds]`."""
    configure()
    if len(sys.argv) < 2:
        raise SystemExit("usage: python -m awp_agent.wait_for <host:port|url> [timeout-seconds]")
    timeout = float(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_TIMEOUT
    if not asyncio.run(wait_for(sys.argv[1], timeout)):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
