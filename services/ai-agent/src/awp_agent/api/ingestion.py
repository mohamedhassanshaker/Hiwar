"""The knowledge-ingestion endpoints: start a collection's ingestion and follow it."""

from __future__ import annotations

from contextlib import suppress

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from temporalio.client import WorkflowExecutionStatus, WorkflowFailureError
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.service import RPCError

from awp_agent.api.temporal import temporal
from awp_agent.ingestion import graph, vectors
from awp_agent.ingestion.activities import DocumentRef, IngestionConfig
from awp_agent.ingestion.workflow import (
    IngestionInput,
    IngestionProgress,
    IngestionResult,
    IngestionWorkflow,
)
from awp_agent.worker import INGESTION

router = APIRouter()


class StartIngestionRequest(BaseModel):
    """What the console sends to index a collection's documents (`UC-57.1-01`)."""

    collection_id: str
    documents: list[DocumentRef]
    config: IngestionConfig
    extraction_route: str = "reasoning-default"


class StartIngestionResponse(BaseModel):
    """The workflow the console then polls for progress."""

    workflow_id: str


class RemoveDocumentsRequest(BaseModel):
    """The documents of a collection whose source the console is removing."""

    doc_ids: list[str]


class RemovedDocuments(BaseModel):
    """How many passages left the vector store."""

    chunks: int


def ingestion_workflow_id(collection_id: str) -> str:
    """One ingestion workflow per collection, so a second start joins the first."""
    return f"ingest-{collection_id}"


@router.post("/ingestion/runs", response_model=StartIngestionResponse)
async def start_ingestion(request: StartIngestionRequest) -> StartIngestionResponse:
    """`UC-57.1-01`, `-04` and `-06`: index or re-index a collection's documents."""
    client = await temporal()
    workflow_id = ingestion_workflow_id(request.collection_id)
    # One workflow per collection: a second start joins the run already going rather than
    # failing the caller, which is what two people pressing Re-index at once does.
    with suppress(WorkflowAlreadyStartedError):
        await client.start_workflow(
            IngestionWorkflow.run,
            IngestionInput(
                collection_id=request.collection_id,
                documents=request.documents,
                config=request.config,
                extraction_route=request.extraction_route,
            ),
            id=workflow_id,
            task_queue=INGESTION,
        )
    return StartIngestionResponse(workflow_id=workflow_id)


@router.get("/ingestion/runs/{collection_id}", response_model=IngestionProgress)
async def ingestion_progress(collection_id: str) -> IngestionProgress:
    """`UC-56.2-03`: how far the running ingestion has got.

    The progress is a workflow query rather than a row, so the screen can never show a
    figure the run has already moved past.
    """
    client = await temporal()
    handle = client.get_workflow_handle(ingestion_workflow_id(collection_id))
    try:
        progress: IngestionProgress = await handle.query("progress")
        return progress
    except RPCError:
        # Nothing is running, which is not an error: the collection is simply at rest.
        return IngestionProgress(stage="idle")


@router.get("/ingestion/runs/{collection_id}/result", response_model=IngestionResult)
async def ingestion_result(collection_id: str) -> IngestionResult:
    """`UC-56.2-04`: what the last run produced, including the documents it could not read."""
    client = await temporal()
    handle = client.get_workflow_handle(ingestion_workflow_id(collection_id))
    try:
        result: IngestionResult = await handle.result()
        return result
    except (RPCError, WorkflowFailureError) as problem:
        raise HTTPException(status_code=404, detail=str(problem)) from problem


async def _after_ingestion(collection_id: str) -> None:
    """Refuse with 409 while the collection is being indexed: the running ingestion would
    write passages back after a removal (D258)."""
    client = await temporal()
    handle = client.get_workflow_handle(ingestion_workflow_id(collection_id))
    try:
        description = await handle.describe()
    except RPCError:
        return  # never ingested
    if description.status == WorkflowExecutionStatus.RUNNING:
        raise HTTPException(
            status_code=409,
            detail="The collection is being indexed; try again when indexing has finished.",
        )


@router.post("/ingestion/collections/{collection_id}/removals", response_model=RemovedDocuments)
async def remove_documents(collection_id: str, request: RemoveDocumentsRequest) -> RemovedDocuments:
    """`UC-57.1-05`: a removed source's chunks leave the vector store, and its graph episodes
    leave the graph with the facts only they asserted (D258)."""
    await _after_ingestion(collection_id)
    chunk_ids = await vectors.chunk_ids_of(collection_id, request.doc_ids)
    await graph.remove_chunks(chunk_ids)
    return RemovedDocuments(chunks=await vectors.delete_documents(collection_id, request.doc_ids))


@router.delete("/ingestion/collections/{collection_id}", status_code=204)
async def drop_collection(collection_id: str) -> None:
    """A deleted collection's passages, index and graph group go with it (D258)."""
    await _after_ingestion(collection_id)
    await graph.drop(collection_id)
    await vectors.drop(collection_id)
