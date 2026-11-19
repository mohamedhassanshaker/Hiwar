"""Requests to customer websites and HTTP tools, with a guard against internal addresses.

A crawl URL or an HTTP tool endpoint is customer input. Without a guard it could reach the
cloud metadata endpoint, the database or another service on the private network. Every
hop, including each redirect, resolves the host and refuses loopback, private, link-local,
reserved and multicast addresses.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx

from hiwar_agent.config import settings

MAX_REDIRECTS = 5
MAX_BYTES = 5_000_000


class EgressRefused(Exception):
    """The address is not allowed, or the response is too large."""


async def _check_host(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise EgressRefused(f"Only http and https addresses are allowed: {url}")
    if settings.allow_private_egress:
        return
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(parts.hostname, parts.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as problem:
        raise EgressRefused(f"The address {parts.hostname} does not resolve") from problem
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            raise EgressRefused(f"The address {parts.hostname} points to a private network")


async def fetch(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json: object | None = None,
    params: dict[str, str] | None = None,
    timeout: float = 15.0,
) -> httpx.Response:
    """One request with the guard on every redirect hop; the body is capped at 5 MB."""
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            await _check_host(current)
            response = await client.request(method, current, headers=headers, json=json, params=params)
            if response.is_redirect and "location" in response.headers:
                current = urljoin(current, response.headers["location"])
                method, json, params = "GET", None, None
                continue
            if len(response.content) > MAX_BYTES:
                raise EgressRefused("The response is larger than 5 MB")
            return response
        raise EgressRefused("Too many redirects")
