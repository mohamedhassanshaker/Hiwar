"""Structured logging. Every line carries the run id when one is bound."""

from __future__ import annotations

import logging
from typing import Any

import structlog

_configured = False


def configure(level: str = "INFO") -> None:
    """Configure structlog once per process, in JSON for anything but a terminal."""
    global _configured
    if _configured:
        return
    logging.basicConfig(format="%(message)s", level=getattr(logging, level.upper(), logging.INFO))
    # The S3 client's debug output is every request's headers, the access key and signature
    # among them, for each Temporal payload kept in the object store (D287).
    for name in ("botocore", "boto3", "s3transfer"):
        logging.getLogger(name).setLevel(logging.INFO)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
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


def use_selector_event_loop() -> None:
    """Windows defaults to the proactor loop, which psycopg's async mode refuses.

    The containers run on Linux, where this does nothing. It matters for host mode
    (stack specification 8.7), where the service and the workers run on the developer's
    machine against port-forwarded stores.
    """
    import asyncio
    import sys

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
