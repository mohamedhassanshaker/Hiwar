"""The HTTP surface of the agent service, with Temporal, Valkey and the models stubbed.

Each endpoint is called through FastAPI's test client. Temporal is replaced at
`Client.connect`, the event bus at `events`, and retrieval, classification, parsing and the
health probes at the modules that reach the network, so the routing, status codes and
response shapes are what is under test.
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from temporalio.client import Client, WorkflowExecutionStatus, WorkflowFailureError
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.service import RPCError, RPCStatusCode

from awp_agent import classify, tracing
from awp_agent.clients import events, gateway_client
from awp_agent.harness.types import RunInput, RunStatus
from awp_agent.ingestion import graph, parsing, retrieval, vectors
from awp_agent.ingestion.workflow import IngestionProgress, IngestionResult
from awp_agent.main import app
from awp_agent.mission.runtime import MissionOutcome


@dataclass
class FakeHandle:
    """A workflow handle that answers queries and results from what the test put in."""

    queries: dict[str, Any] = field(default_factory=dict)
    outcome: Any = None
    failure: BaseException | None = None
    signals: list[tuple[str, Any]] = field(default_factory=list)
    #: The workflow's status as `describe` reports it; None when there is no such workflow.
    status: WorkflowExecutionStatus | None = None

    async def describe(self) -> Any:
        if self.status is None:
            raise RPCError("not found", RPCStatusCode.NOT_FOUND, b"")
        return SimpleNamespace(status=self.status)

    async def query(self, name: str) -> Any:
        if self.failure is not None:
            raise self.failure
        return self.queries[name]

    async def result(self) -> Any:
        if self.failure is not None:
            raise self.failure
        return self.outcome

    async def signal(self, name: str, argument: Any = None) -> None:
        self.signals.append((name, argument))


@dataclass
class FakeClient:
    """The two Temporal calls the API makes: start a workflow, and get a handle to one."""

    handle: FakeHandle = field(default_factory=FakeHandle)
    started: list[dict[str, Any]] = field(default_factory=list)
    already_started: bool = False
    handles_for: list[str] = field(default_factory=list)

    async def start_workflow(self, run: Any, argument: Any, **options: str) -> None:
        if self.already_started:
            raise WorkflowAlreadyStartedError(options["id"], "IngestionWorkflow")
        self.started.append({"argument": argument, **options})

    def get_workflow_handle(self, workflow_id: str) -> FakeHandle:
        self.handles_for.append(workflow_id)
        return self.handle

    def get_workflow_handle_for(self, run: Any, workflow_id: str) -> FakeHandle:
        self.handles_for.append(workflow_id)
        return self.handle


@pytest.fixture
def temporal(monkeypatch: pytest.MonkeyPatch) -> FakeClient:
    fake = FakeClient()

    async def connect(*_args: Any, **_kwargs: Any) -> FakeClient:
        return fake

    monkeypatch.setattr(Client, "connect", connect)
    return fake


@pytest.fixture
def api(temporal: FakeClient) -> Iterator[TestClient]:
    """The app with its lifespan run, so the Temporal client is the fake."""
    with TestClient(app) as client:
        yield client


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Any]]:
    seen: list[tuple[str, Any]] = []

    async def publish(run_id: str, event: Any) -> str:
        seen.append((run_id, event))
        return "1-0"

    monkeypatch.setattr(events, "publish", publish)
    return seen


def _rpc_error() -> RPCError:
    return RPCError("workflow not found", RPCStatusCode.NOT_FOUND, b"")


def test_starting_a_run_starts_one_mission_named_after_it(
    api: TestClient, temporal: FakeClient, published: list[tuple[str, Any]], run_input: RunInput
) -> None:
    answer = api.post("/agui/runs", json=run_input.model_dump(mode="json"))

    assert answer.status_code == 200
    assert answer.json() == {"run_id": "run-1", "workflow_id": "run-run-1"}
    assert [(s["id"], s["task_queue"]) for s in temporal.started] == [("run-run-1", "agent-runs")]
    mission = temporal.started[0]["argument"]
    assert mission.prompt == run_input.task.description
    assert mission.title == run_input.task.title
    assert mission.deps.run_id == "run-1"
    assert [run_id for run_id, _ in published] == ["run-1"]


def test_starting_a_run_without_temporal_is_unavailable(run_input: RunInput) -> None:
    answer = TestClient(app).post("/agui/runs", json=run_input.model_dump(mode="json"))

    assert answer.status_code == 503
    assert answer.json() == {"detail": "temporal is not connected"}


def test_a_run_payload_missing_its_task_is_refused(api: TestClient) -> None:
    assert api.post("/agui/runs", json={"run_id": "run-1"}).status_code == 422


def test_the_stream_relays_each_event_as_a_server_sent_event(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def stream(run_id: str) -> AsyncIterator[str]:
        for payload in ('{"type":"RUN_STARTED"}', '{"type":"RUN_FINISHED"}'):
            yield payload

    monkeypatch.setattr(events, "stream", stream)

    answer = api.get("/agui/runs/run-1/stream")

    assert answer.status_code == 200
    assert answer.headers["content-type"].startswith("text/event-stream")
    assert answer.headers["cache-control"] == "no-store"
    assert answer.headers["x-accel-buffering"] == "no"
    assert answer.text == 'data: {"type":"RUN_STARTED"}\n\ndata: {"type":"RUN_FINISHED"}\n\n'


@pytest.mark.parametrize("terminal", ["RUN_FINISHED", "RUN_ERROR"])
def test_the_stream_ends_after_the_runs_terminal_event(
    api: TestClient, monkeypatch: pytest.MonkeyPatch, terminal: str
) -> None:
    # The bus never ends a run's stream on its own; the endpoint has to.
    async def stream(run_id: str) -> AsyncIterator[str]:
        yield '{"type":"TEXT_MESSAGE_CONTENT","delta":"Done."}'
        yield f'{{"type":"{terminal}"}}'
        while True:
            await asyncio.sleep(3600)
            yield '{"type":"TEXT_MESSAGE_CONTENT","delta":"never sent"}'

    monkeypatch.setattr(events, "stream", stream)

    answer = api.get("/agui/runs/run-1/stream")

    assert answer.text == (
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Done."}\n\n'
        f'data: {{"type":"{terminal}"}}\n\n'
    )


def test_the_backlog_lists_every_event_so_far(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def backlog(run_id: str) -> list[str]:
        return [f'{{"run":"{run_id}"}}']

    monkeypatch.setattr(events, "backlog", backlog)

    answer = api.get("/agui/runs/run-7/events")

    assert answer.status_code == 200
    assert answer.json() == ['{"run":"run-7"}']


def test_the_status_is_read_from_the_workflow(api: TestClient, temporal: FakeClient) -> None:
    temporal.handle.queries = {"status": "Running", "steps": [{"n": 1}]}

    answer = api.get("/agui/runs/run-1")

    assert answer.status_code == 200
    assert answer.json() == {"runId": "run-1", "status": "Running", "steps": [{"n": 1}]}
    assert temporal.handles_for == ["run-run-1"]


def test_the_status_of_an_unknown_run_is_not_found(api: TestClient, temporal: FakeClient) -> None:
    temporal.handle.failure = _rpc_error()

    answer = api.get("/agui/runs/run-9")

    assert answer.status_code == 404
    assert answer.json() == {"detail": "no run run-9"}


@pytest.mark.parametrize(
    ("path", "body", "signal"),
    [
        ("approve", {"call_id": "c-1", "approved": True, "decided_by": "p-1"}, "approve"),
        ("answer", {"question_id": "q-1", "answer": "Yes", "answered_by": "p-1"}, "answer"),
        ("cancel", None, "cancel"),
    ],
)
def test_a_decision_is_delivered_as_a_signal(
    api: TestClient, temporal: FakeClient, path: str, body: dict[str, Any] | None, signal: str
) -> None:
    answer = api.post(f"/agui/runs/run-1/{path}", json=body)

    assert answer.status_code == 202
    assert temporal.handles_for == ["run-run-1"]
    assert [name for name, _ in temporal.handle.signals] == [signal]


def test_a_decision_without_its_fields_is_refused(api: TestClient) -> None:
    assert api.post("/agui/runs/run-1/approve", json={"call_id": "c-1"}).status_code == 422


def test_a_decision_without_temporal_is_unavailable() -> None:
    assert TestClient(app).post("/agui/runs/run-1/cancel").status_code == 503


def test_the_result_carries_the_mission_outcome(api: TestClient, temporal: FakeClient) -> None:
    temporal.handle.outcome = MissionOutcome(status=RunStatus.SUCCEEDED, output="Done.")

    answer = api.get("/agui/runs/run-1/result")

    assert answer.status_code == 200
    body = answer.json()
    assert (body["run_id"], body["status"], body["output"]) == ("run-1", "Succeeded", "Done.")
    assert body["steps"] == []
    assert body["tool_call_count"] == 0


def test_a_failed_mission_reports_its_failure(api: TestClient, temporal: FakeClient) -> None:
    temporal.handle.failure = WorkflowFailureError(cause=RuntimeError("boom"))

    answer = api.get("/agui/runs/run-1/result")

    assert answer.status_code == 500
    assert answer.json() == {"detail": "Workflow execution failed"}


INGESTION = {
    "collection_id": "col-1",
    "documents": [{"doc_id": "d-1", "key": "raw/d-1.pdf"}],
    "config": {"collection_id": "col-1"},
}


def test_an_ingestion_starts_one_workflow_per_collection(
    api: TestClient, temporal: FakeClient
) -> None:
    answer = api.post("/ingestion/runs", json=INGESTION)

    assert answer.status_code == 200
    assert answer.json() == {"workflow_id": "ingest-col-1"}
    assert [(s["id"], s["task_queue"]) for s in temporal.started] == [("ingest-col-1", "ingestion")]
    assert temporal.started[0]["argument"].extraction_route == "reasoning-default"


def test_a_second_ingestion_start_joins_the_first(api: TestClient, temporal: FakeClient) -> None:
    temporal.already_started = True

    answer = api.post("/ingestion/runs", json=INGESTION)

    assert answer.status_code == 200
    assert answer.json() == {"workflow_id": "ingest-col-1"}


def test_an_ingestion_without_documents_is_refused(api: TestClient) -> None:
    assert api.post("/ingestion/runs", json={"collection_id": "col-1"}).status_code == 422


def test_a_removed_source_leaves_the_vector_store_and_the_graph(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D258: its chunks are read first, because their ids name its graph episodes."""
    calls: list[tuple[str, Any]] = []

    async def chunk_ids_of(collection_id: str, doc_ids: list[str]) -> list[str]:
        calls.append(("chunks", (collection_id, doc_ids)))
        return ["c-1", "c-2"]

    async def remove_chunks(chunk_ids: list[str]) -> None:
        calls.append(("graph", chunk_ids))

    async def delete_documents(collection_id: str, doc_ids: list[str]) -> int:
        calls.append(("vectors", (collection_id, doc_ids)))
        return 2

    monkeypatch.setattr(vectors, "chunk_ids_of", chunk_ids_of)
    monkeypatch.setattr(graph, "remove_chunks", remove_chunks)
    monkeypatch.setattr(vectors, "delete_documents", delete_documents)

    answer = api.post("/ingestion/collections/col-1/removals", json={"doc_ids": ["d-1"]})

    assert answer.status_code == 200
    assert answer.json() == {"chunks": 2}
    assert calls == [
        ("chunks", ("col-1", ["d-1"])),
        ("graph", ["c-1", "c-2"]),
        ("vectors", ("col-1", ["d-1"])),
    ]


def test_a_deleted_collection_leaves_the_graph_and_the_vector_store(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    dropped: list[str] = []

    async def drop_graph(collection_id: str) -> None:
        dropped.append(f"graph:{collection_id}")

    async def drop_vectors(collection_id: str) -> None:
        dropped.append(f"vectors:{collection_id}")

    monkeypatch.setattr(graph, "drop", drop_graph)
    monkeypatch.setattr(vectors, "drop", drop_vectors)

    assert api.delete("/ingestion/collections/col-1").status_code == 204
    assert dropped == ["graph:col-1", "vectors:col-1"]


def test_a_collection_being_indexed_is_left_whole(
    api: TestClient, temporal: FakeClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D258: the running ingestion would write passages back after a drop or a removal."""
    dropped: list[str] = []

    async def drop(collection_id: str) -> None:
        dropped.append(collection_id)

    monkeypatch.setattr(graph, "drop", drop)
    monkeypatch.setattr(vectors, "drop", drop)
    temporal.handle.status = WorkflowExecutionStatus.RUNNING

    deleted = api.delete("/ingestion/collections/col-1")
    removed = api.post("/ingestion/collections/col-1/removals", json={"doc_ids": ["d-1"]})

    assert (deleted.status_code, removed.status_code) == (409, 409)
    assert "being indexed" in deleted.json()["detail"]
    assert temporal.handles_for[-1] == "ingest-col-1"
    assert dropped == []


def test_a_collection_whose_ingestion_has_ended_is_cleared(
    api: TestClient, temporal: FakeClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    dropped: list[str] = []

    async def drop(collection_id: str) -> None:
        dropped.append(collection_id)

    monkeypatch.setattr(graph, "drop", drop)
    monkeypatch.setattr(vectors, "drop", drop)
    temporal.handle.status = WorkflowExecutionStatus.COMPLETED

    assert api.delete("/ingestion/collections/col-1").status_code == 204
    assert dropped == ["col-1", "col-1"]


def test_ingestion_progress_is_the_workflow_query(api: TestClient, temporal: FakeClient) -> None:
    temporal.handle.queries = {"progress": IngestionProgress(total=4, done=1, stage="indexing")}

    answer = api.get("/ingestion/runs/col-1")

    assert answer.json() == {"total": 4, "done": 1, "stage": "indexing", "current": ""}
    assert temporal.handles_for == ["ingest-col-1"]


def test_a_collection_with_nothing_running_is_idle(api: TestClient, temporal: FakeClient) -> None:
    temporal.handle.failure = _rpc_error()

    answer = api.get("/ingestion/runs/col-1")

    assert answer.status_code == 200
    assert answer.json()["stage"] == "idle"


def test_the_ingestion_result_is_what_the_run_produced(
    api: TestClient, temporal: FakeClient
) -> None:
    temporal.handle.outcome = IngestionResult(collection_id="col-1", documents=2, chunks=9)

    answer = api.get("/ingestion/runs/col-1/result")

    assert answer.status_code == 200
    assert answer.json()["chunks"] == 9


def test_the_result_of_a_collection_never_indexed_is_not_found(
    api: TestClient, temporal: FakeClient
) -> None:
    temporal.handle.failure = _rpc_error()

    assert api.get("/ingestion/runs/col-1/result").status_code == 404


def test_retrieval_answers_in_the_mode_asked(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: list[dict[str, Any]] = []

    async def search(query: str, collection_id: str, **options: Any) -> Any:
        asked.append({"query": query, "collection_id": collection_id, **options})
        return retrieval.RetrievalResult(mode="Graph", passages=[])

    monkeypatch.setattr(retrieval, "search", search)

    answer = api.post(
        "/knowledge/retrieve",
        json={"query": "leave policy", "collection_id": "col-1", "mode": "Graph"},
    )

    assert answer.status_code == 200
    assert answer.json() == retrieval.RetrievalResult(mode="Graph", passages=[]).model_dump()
    assert asked == [
        {
            "query": "leave policy",
            "collection_id": "col-1",
            "mode": "Graph",
            "limit": 8,
            "embedding_route": "",
        }
    ]


def test_retrieval_that_cannot_reach_its_route_is_unavailable(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def search(*_args: Any, **_kwargs: Any) -> Any:
        raise ConnectionError("embedding route unreachable")

    monkeypatch.setattr(retrieval, "search", search)

    answer = api.post("/knowledge/retrieve", json={"query": "q", "collection_id": "col-1"})

    assert answer.status_code == 503
    assert answer.json() == {"detail": "embedding route unreachable"}


CLASSIFY = {"text": "I need a laptop", "types": [{"code": "IT-REQ", "name": "IT request"}]}


def test_classification_returns_the_typed_answer(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def classify_or_none(request: classify.ClassifyRequest) -> dict[str, Any]:
        return {"type": request.types[0].code, "values": {}}

    monkeypatch.setattr(classify, "classify_or_none", classify_or_none)

    answer = api.post("/classify/request", json=CLASSIFY)

    assert answer.status_code == 200
    assert answer.json() == {"type": "IT-REQ", "values": {}}


def test_classification_without_valid_output_is_unavailable(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def classify_or_none(_request: classify.ClassifyRequest) -> None:
        return None

    monkeypatch.setattr(classify, "classify_or_none", classify_or_none)

    answer = api.post("/classify/request", json=CLASSIFY)

    assert answer.status_code == 503
    assert answer.json() == {"detail": "the classification route did not return valid output"}


def test_extraction_refuses_content_that_is_not_base64(api: TestClient) -> None:
    answer = api.post("/documents/extract", json={"filename": "a.txt", "content_base64": "@@@"})

    assert answer.status_code == 400
    assert answer.json() == {"detail": "the content is not base64"}


def test_extraction_of_a_format_without_a_parser_is_unprocessable(api: TestClient) -> None:
    content = base64.b64encode(b"ID3").decode()

    answer = api.post(
        "/documents/extract", json={"filename": "song.mp3", "content_base64": content}
    )

    assert answer.status_code == 422


def _healthy(value: bool) -> Any:
    async def probe() -> bool:
        return value

    return probe


def test_health_is_ok_with_temporal_and_lists_every_check(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(gateway_client, "gateway_healthy", _healthy(True))
    monkeypatch.setattr(events, "bus_healthy", _healthy(False))
    monkeypatch.setattr(vectors, "vectors_healthy", _healthy(True))
    monkeypatch.setattr(tracing, "tracing_healthy", _healthy(True))

    answer = api.get("/healthz")

    assert answer.status_code == 200
    assert answer.json() == {
        "status": "ok",
        "checks": {
            "temporal": True,
            "gateway": True,
            "events": False,
            "vectors": True,
            "tracing": True,
        },
    }


def test_health_is_degraded_without_temporal(monkeypatch: pytest.MonkeyPatch) -> None:
    for module, name in (
        (gateway_client, "gateway_healthy"),
        (events, "bus_healthy"),
        (vectors, "vectors_healthy"),
        (tracing, "tracing_healthy"),
    ):
        monkeypatch.setattr(module, name, _healthy(True))

    answer = TestClient(app).get("/healthz")

    assert answer.json()["status"] == "degraded"
    assert answer.json()["checks"]["temporal"] is False


def test_parsing_is_what_extraction_runs(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parsing, "parse", lambda path, ocr: f"{path.suffix}:{ocr}")
    content = base64.b64encode(b"x").decode()

    answer = api.post("/documents/extract", json={"filename": "r.png", "content_base64": content})

    assert answer.json() == {"text": ".png:True"}
