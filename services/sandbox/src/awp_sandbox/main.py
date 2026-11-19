"""The sandbox manager's HTTP surface.

`/sandboxes` is the manager's API, used by the agent's skill-script tools
(`services/agent/src/awp_agent/mission/sandbox.py`). A file crosses it in base64.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from awp_sandbox.config import settings
from awp_sandbox.logging import configure, logger
from awp_sandbox.manager import (
    ExecRequest,
    ExecResult,
    Sandbox,
    SandboxError,
    SandboxManager,
    WriteRequest,
)
from awp_sandbox.railway import RailwaySandboxManager

log = logger("awp_sandbox.main")

#: A run id is a Pod label value, so it is held to Kubernetes' label syntax.
RUN_ID_PATTERN = r"^[A-Za-z0-9]([A-Za-z0-9_.-]{0,61}[A-Za-z0-9])?$"

WARM_POOL_INTERVAL_SECONDS = 30

_manager: SandboxManager | RailwaySandboxManager | None = None


def build_manager() -> SandboxManager | RailwaySandboxManager:
    """The backend the deployment runs on: Kubernetes Pods, or Railway sandboxes (D390)."""
    if settings().backend == "railway":
        return RailwaySandboxManager()
    return SandboxManager()


def manager() -> SandboxManager | RailwaySandboxManager:
    """The process-wide manager."""
    if _manager is None:
        raise HTTPException(status_code=503, detail="the sandbox manager is not connected")
    return _manager


async def _keep_pool_warm() -> None:
    """Top the warm pool up for as long as the service runs."""
    while True:
        try:
            if _manager is not None:
                await _manager.ensure_warm_pool()
        except Exception as problem:  # noqa: BLE001 - the pool is an optimisation, not a must
            log.warning("warm_pool.failed", error=str(problem))
        await asyncio.sleep(WARM_POOL_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Connect to the sandbox backend and keep the warm pool topped up."""
    global _manager
    configure(settings().log_level)
    _manager = build_manager()
    task = asyncio.create_task(_keep_pool_warm())
    try:
        yield
    finally:
        task.cancel()
        _manager = None


app = FastAPI(title="AWP sandbox manager", version="0.1.0", lifespan=lifespan)


class CreateRequest(BaseModel):
    """Which run the sandbox is for."""

    run_id: str = Field(pattern=RUN_ID_PATTERN)


@app.post("/sandboxes", response_model=Sandbox)
async def create(request: CreateRequest) -> Sandbox:
    """Give a run its workspace: the one it already has while that is running, else a new one."""
    try:
        return await manager().create(request.run_id)
    except SandboxError as problem:
        raise HTTPException(status_code=503, detail=str(problem)) from problem


@app.delete("/sandboxes")
async def destroy_for_run(run_id: str = Query(pattern=RUN_ID_PATTERN)) -> dict[str, int]:
    """Destroy every workspace of a run, when the run has ended."""
    return {"destroyed": await manager().destroy_for_run(run_id)}


@app.delete("/sandboxes/{sandbox_id}")
async def destroy(sandbox_id: str) -> dict[str, str]:
    """Destroy a workspace. A sandbox is never reused between runs."""
    await manager().destroy(sandbox_id)
    return {"status": "destroyed"}


@app.post("/sandboxes/{sandbox_id}/exec", response_model=ExecResult)
async def execute(sandbox_id: str, request: ExecRequest) -> ExecResult:
    """Run a command in a workspace, with a hard timeout."""
    try:
        return await manager().execute(sandbox_id, request)
    except SandboxError as problem:
        raise HTTPException(status_code=404, detail=str(problem)) from problem


@app.post("/sandboxes/{sandbox_id}/files", response_model=ExecResult)
async def write_file(sandbox_id: str, request: WriteRequest) -> ExecResult:
    """Put a file into a workspace."""
    try:
        return await manager().write_file(sandbox_id, request)
    except SandboxError as problem:
        raise HTTPException(status_code=404, detail=str(problem)) from problem


@app.get("/sandboxes/{sandbox_id}/files", response_model=ExecResult)
async def read_file(sandbox_id: str, path: str) -> ExecResult:
    """Read a file out of a workspace; `stdout` holds its bytes in base64."""
    try:
        return await manager().read_file(sandbox_id, path)
    except SandboxError as problem:
        raise HTTPException(status_code=404, detail=str(problem)) from problem


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    """The readiness probe."""
    return {"status": "ok" if _manager is not None else "degraded"}
