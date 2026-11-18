"""The ingestion workflow, on the `ingestion` task queue.

One workflow per collection run. Each document is parsed, indexed and extracted in turn, and
the progress the Knowledge screen polls is a workflow query, so the screen never needs a
database row that could disagree with the workflow.
"""

from __future__ import annotations

from datetime import timedelta

from pydantic import BaseModel, Field
from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from awp_agent.ingestion.activities import (
        DocumentRef,
        IndexedDocument,
        IngestionConfig,
        count_entities,
        extract_graph,
        index_document,
        parse_document,
    )

def _reason(problem: BaseException) -> str:
    """Why a document failed, in the words the Knowledge screen shows.

    An activity that raises reaches the workflow as `ActivityError: Activity task failed`,
    which names nothing. The cause chain carries what actually happened — the gateway's
    own 404, the parser's own message — so it is read out here rather than left in a
    worker log the console cannot reach.
    """
    seen: list[str] = []
    current: BaseException | None = problem
    while current is not None and len(seen) < 4:
        text = str(current).strip()
        if text and text not in seen:
            seen.append(text)
        current = current.__cause__
    return ": ".join(seen) if seen else type(problem).__name__


PARSE_TIMEOUT = timedelta(minutes=15)
INDEX_TIMEOUT = timedelta(minutes=30)
#: Graph extraction makes several model calls per chunk, measured at about 40 s each on the
#: cluster, so a long document takes hours. The heartbeat after each chunk is what bounds a
#: stalled call; a retry resumes from the last chunk done (D276).
GRAPH_TIMEOUT = timedelta(hours=6)
GRAPH_HEARTBEAT = timedelta(minutes=5)
RETRY = RetryPolicy(maximum_attempts=3)


class IngestionInput(BaseModel):
    """One ingestion run: the documents and the collection's configuration."""

    collection_id: str
    documents: list[DocumentRef]
    config: IngestionConfig
    extraction_route: str


class IngestionProgress(BaseModel):
    """What the Knowledge screen shows while the run is going."""

    total: int = 0
    done: int = 0
    stage: str = "queued"
    current: str = ""


class IngestionResult(BaseModel):
    """The totals the collection records when the run finishes."""

    collection_id: str
    documents: int = 0
    chunks: int = 0
    # The episodes handed to Graphiti, and the entities it extracted from them. The
    # Knowledge screen shows documents, chunks and entities.
    episodes: int = 0
    entities: int = 0
    failures: list[str] = Field(default_factory=list)


@workflow.defn(name="IngestionWorkflow")
class IngestionWorkflow:
    """Parse, index and extract every document of one ingestion run."""

    def __init__(self) -> None:
        self._progress = IngestionProgress()

    @workflow.query(name="progress")
    def progress(self) -> IngestionProgress:
        """The current stage, for the ingestion progress bar."""
        return self._progress

    @workflow.run
    async def run(self, request: IngestionInput) -> IngestionResult:
        """Parse, index and, when the collection asks for it, graph-extract each document.

        Each stage is an activity retried up to 3 times. A document that still fails is
        listed in `failures` with its reason and the run goes on to the next. With graph
        extraction on, the entity count is read from the graph at the end.
        """
        result = IngestionResult(collection_id=request.collection_id)
        self._progress = IngestionProgress(total=len(request.documents), stage="parsing")

        for document in request.documents:
            self._progress.current = document.filename or document.key
            try:
                parsed = await workflow.execute_activity(
                    parse_document,
                    (document, request.config),
                    start_to_close_timeout=PARSE_TIMEOUT,
                    retry_policy=RETRY,
                )

                self._progress.stage = "indexing"
                indexed: IndexedDocument = await workflow.execute_activity(
                    index_document,
                    (parsed, request.config),
                    start_to_close_timeout=INDEX_TIMEOUT,
                    retry_policy=RETRY,
                )
                result.chunks += indexed.chunks

                if request.config.extract_graph:
                    self._progress.stage = "extracting"
                    extracted = await workflow.execute_activity(
                        extract_graph,
                        (parsed, request.config, request.extraction_route),
                        start_to_close_timeout=GRAPH_TIMEOUT,
                        heartbeat_timeout=GRAPH_HEARTBEAT,
                        retry_policy=RETRY,
                    )
                    result.episodes += extracted.episodes

                result.documents += 1
            except Exception as problem:  # noqa: BLE001 - one bad document never fails the run
                result.failures.append(f"{document.filename or document.key}: {_reason(problem)}")
            finally:
                self._progress.done += 1

        if request.config.extract_graph:
            # Graphiti decides how many entities a batch of episodes produced, so the
            # figure is read from the graph once, not guessed from the episode count.
            result.entities = await workflow.execute_activity(
                count_entities,
                request.collection_id,
                start_to_close_timeout=INDEX_TIMEOUT,
                retry_policy=RETRY,
            )

        self._progress.stage = "done"
        return result
