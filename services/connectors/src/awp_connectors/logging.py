"""Structured logging for the connector runtime."""

from __future__ import annotations

import logging
from typing import Any

import structlog

_configured = False


def configure(level: str = "INFO") -> None:
    """Configure structlog once per process."""
    global _configured
    if _configured:
        return
    logging.basicConfig(format="%(message)s", level=getattr(logging, level.upper(), logging.INFO))
    # D296: these log each request's URL, which may carry a connector's API key as a query
    # parameter.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        cache_logger_on_first_use=True,
    )
    _configured = True


def logger(name: str, **initial: Any) -> structlog.stdlib.BoundLogger:
    """A bound logger for a module."""
    bound: structlog.stdlib.BoundLogger = structlog.get_logger(name).bind(**initial)
    return bound
