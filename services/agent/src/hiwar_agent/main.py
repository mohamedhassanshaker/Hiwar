"""HTTP surface of the agent service. Every route except /healthz needs the shared service token."""

from __future__ import annotations

import secrets
from contextlib import asynccontextmanager
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from hiwar_agent.config import settings
from hiwar_agent.ingest import IngestRequest, delete_source, ingest
from hiwar_agent.store import pool
from hiwar_agent.turn import ToolSpec, TurnRequest, TurnResult, run_http_tool, run_turn


@asynccontextmanager
async def lifespan(_: FastAPI):
    await pool.open()
    yield
    await pool.close()


app = FastAPI(title="Hiwar agent service", lifespan=lifespan)


def authorized(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {settings.agent_service_token}"
    if not secrets.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/turn", dependencies=[Depends(authorized)])
async def turn(request: TurnRequest) -> TurnResult:
    return await run_turn(request)


@app.post("/ingest", status_code=202, dependencies=[Depends(authorized)])
async def ingest_source(request: IngestRequest, background: BackgroundTasks) -> dict[str, str]:
    background.add_task(ingest, request)
    return {"status": "queued"}


@app.delete("/sources/{source_id}", dependencies=[Depends(authorized)])
async def remove_source(source_id: str, org_id: str) -> dict[str, str]:
    await delete_source(org_id, source_id)
    return {"status": "deleted"}


class ToolRunRequest(BaseModel):
    tool: ToolSpec
    inputs: dict[str, Any]


class ToolRunResult(BaseModel):
    ok: bool
    result: Any
    duration_ms: int


@app.post("/tools/run", dependencies=[Depends(authorized)])
async def tools_run(request: ToolRunRequest) -> ToolRunResult:
    """Runs an approved HTTP tool once with the shown inputs (INB-003 FR-004)."""
    ok, result, duration = await run_http_tool(request.tool, request.inputs)
    return ToolRunResult(ok=ok, result=result, duration_ms=duration)
