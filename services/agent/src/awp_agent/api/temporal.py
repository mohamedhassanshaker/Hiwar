"""The Temporal client the routes share, connected for the lifetime of the app."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from temporalio.client import Client

from awp_agent.config import settings
from awp_agent.logging import configure, logger
from awp_agent.worker import AGENT_RUNS, connect, run_worker

log = logger("awp_agent.main")

_client: Client | None = None


async def temporal() -> Client:
    """The shared Temporal client."""
    if _client is None:
        raise HTTPException(status_code=503, detail="temporal is not connected")
    return _client


def connected() -> bool:
    """Whether the lifespan hook has connected the shared client."""
    return _client is not None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Connect to Temporal, and in development also serve the task queue in-process."""
    global _client
    configure(settings().log_level)
    _client = await connect()
    worker_task: asyncio.Task[None] | None = None
    if os.environ.get("AWP_WORKER_IN_PROCESS") == "1":
        worker_task = asyncio.create_task(run_worker(AGENT_RUNS))
        log.info("worker.in_process", task_queue=AGENT_RUNS)
    try:
        yield
    finally:
        if worker_task is not None:
            worker_task.cancel()
        _client = None
