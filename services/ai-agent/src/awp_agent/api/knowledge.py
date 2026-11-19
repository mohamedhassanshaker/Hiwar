"""The retrieval test endpoint of the Knowledge screen."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from awp_agent.ingestion import retrieval
from awp_agent.logging import logger

log = logger("awp_agent.main")

router = APIRouter()


class RetrievalQuery(BaseModel):
    """`UC-58.1-01`: one retrieval test."""

    query: str
    collection_id: str
    mode: str = "Hybrid"
    limit: int = 8
    #: The collection's own embedding route (Models & routes). Empty falls back to the
    #: platform default, which is for local development, not for a real collection.
    embedding_route: str = ""


@router.post("/knowledge/retrieve")
async def retrieve(request: RetrievalQuery) -> dict[str, Any]:
    """Retrieve from one collection in the mode the caller asked for.

    503 when the embedding route cannot be reached, which the console turns into the error
    `UC-58.1-06` describes; a Graph-only query does not need the route and still answers.
    """
    try:
        found = await retrieval.search(
            request.query,
            request.collection_id,
            mode=request.mode,
            limit=request.limit,
            embedding_route=request.embedding_route,
        )
    except Exception as problem:
        log.warning("retrieval.failed", problem=str(problem), mode=request.mode)
        raise HTTPException(status_code=503, detail=str(problem)) from problem
    return found.model_dump()
