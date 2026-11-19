"""The FastAPI app: the AG-UI endpoint and the health probe.

`/agui/runs` starts a run, `/agui/runs/{id}/stream` is the AG-UI event stream the console's
CopilotKit runtime attaches to, and `/agui/runs/{id}/approve`, `/answer` and `/cancel` send the
signals that resume or stop it. Nothing here touches the domain database: a run is a Temporal
workflow and every record it writes goes through the platform MCP server.
"""

from __future__ import annotations

from fastapi import FastAPI

from awp_agent.api import classification, documents, health, ingestion, knowledge, runs
from awp_agent.api.temporal import lifespan
from awp_agent.logging import use_selector_event_loop

# At import time, before uvicorn builds its event loop: on Windows the default loop is the
# one psycopg's async mode refuses, and the lifespan hook already runs inside a loop.
use_selector_event_loop()

app = FastAPI(title="AWP agent service", version="0.1.0", lifespan=lifespan)
app.include_router(runs.router)
app.include_router(ingestion.router)
app.include_router(knowledge.router)
app.include_router(classification.router)
app.include_router(documents.router)
app.include_router(health.router)
