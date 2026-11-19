"""A mission asking a person a question, and the queries that say where it is (D125).

The mission workflow is the real one; only its model is replaced. `QuestionMission`
answers the model turns itself: the first asks a question through `ask_person`, the second
reports the tool result it was given. Recording the question and writing the outcome back
are the platform's activities, answered here by stand-ins on the test worker.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, cast

import pytest
from pydantic_ai.agent import AgentRunResult
from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
from pydantic_ai.messages import ModelMessage, ToolCallPart
from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults, RunContext
from pydantic_ai.usage import RunUsage
from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

# Passed through, as `mission/runtime.py` does: the sandbox re-imports this module, and the
# platform client below is HTTP code a workflow may not load itself.
with workflow.unsafe.imports_passed_through():
    from awp_agent.clients import platform_mcp
    from awp_agent.harness.activities.finalize import FinalizeInput
    from awp_agent.harness.types import RunStatus
    from awp_agent.mission import questions
    from awp_agent.mission.deps import MissionDeps
    from awp_agent.mission.questions import QuestionWanted, create_question
    from awp_agent.mission.runtime import (
        ASK_PERSON_TOOL,
        DELEGATE_TOOL,
        Mission,
        MissionOutcome,
        MissionWorkflow,
        _workflow_toolset,
    )

CALL_ID = "call-ask-1"


@dataclass
class _Result:
    """What the workflow reads of a run: its output, its messages and its usage."""

    output: Any
    usage: RunUsage = field(default_factory=RunUsage)

    def all_messages(self) -> list[ModelMessage]:
        return []


@workflow.defn(name="QuestionMission")
class QuestionMission(MissionWorkflow):
    """The mission workflow, with the model's two turns written out."""

    async def _run_until_cancelled(
        self, mission: Mission, results: DeferredToolResults | None
    ) -> AgentRunResult[Any]:
        if results is None:
            asked = ToolCallPart(
                tool_name=ASK_PERSON_TOOL,
                args={"question": "Which office?", "options": ["Dubai", "Abu Dhabi"]},
                tool_call_id=CALL_ID,
            )
            return cast(AgentRunResult[Any], _Result(DeferredToolRequests(calls=[asked])))
        return cast(AgentRunResult[Any], _Result(f"the tool said: {results.calls[CALL_ID]}"))

    @workflow.run
    async def run(self, mission: Mission) -> MissionOutcome:
        return await super().run(mission)


asked: list[QuestionWanted] = []
question_id = "q-1"


@activity.defn(name="create_question")
async def record_question(wanted: QuestionWanted) -> str:
    asked.append(wanted)
    return question_id


@activity.defn(name="finalize")
async def record_outcome(_outcome: FinalizeInput) -> None:
    return None


def _deps(**overrides: Any) -> MissionDeps:
    base: dict[str, Any] = {
        "run_id": "run-q",
        "person_id": "person-1",
        "mcp_token": "model-token",
        "harness_token": "harness-token",
        "route": "reasoning-default",
        "granted_tools": [ASK_PERSON_TOOL],
    }
    return MissionDeps(**(base | overrides))


async def _status_becomes(client: Client, workflow_id: str, wanted: str) -> bool:
    handle = client.get_workflow_handle(workflow_id)
    for _ in range(100):
        if str(await handle.query("status")) == wanted:
            return True
        await asyncio.sleep(0.05)
    return False


@pytest.fixture(autouse=True)
def _fresh() -> None:
    global question_id
    asked.clear()
    question_id = "q-1"


async def test_an_answered_question_resumes_the_mission_with_the_answer(
    temporal_env: WorkflowEnvironment,
) -> None:
    client = temporal_env.client
    async with Worker(
        client,
        task_queue="questions",
        workflows=[QuestionMission],
        activities=[record_question, record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        handle = await client.start_workflow(
            QuestionMission.run,
            Mission(prompt="Book a room", deps=_deps()),
            id="mission-answered",
            task_queue="questions",
        )
        assert await _status_becomes(client, "mission-answered", RunStatus.WAITING)
        assert [(one.run_id, one.question, one.options, one.harness_token) for one in asked] == [
            ("run-q", "Which office?", ["Dubai", "Abu Dhabi"], "harness-token")
        ]

        await handle.signal(
            "answer", {"question_id": "q-1", "answer": "Dubai", "answered_by": "p-1"}
        )
        outcome = await handle.result()

        assert outcome.status is RunStatus.SUCCEEDED
        assert outcome.output == "the tool said: Dubai"
        assert str(await handle.query("status")) == RunStatus.SUCCEEDED
        steps = await handle.query("steps")
        assert [(step["kind"], step["name"], step["outcome"]) for step in steps] == [
            ("Question", "Which office?", "Answered")
        ]


async def test_a_question_the_platform_refused_is_told_to_the_model_without_waiting(
    temporal_env: WorkflowEnvironment,
) -> None:
    global question_id
    question_id = ""
    client = temporal_env.client
    async with Worker(
        client,
        task_queue="questions",
        workflows=[QuestionMission],
        activities=[record_question, record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        outcome = await client.execute_workflow(
            QuestionMission.run,
            Mission(prompt="Book a room", deps=_deps()),
            id="mission-refused",
            task_queue="questions",
        )
    assert outcome.output == "the tool said: the platform did not record the question"


async def test_a_question_nobody_answers_in_time_is_told_to_the_model(
    temporal_env: WorkflowEnvironment,
) -> None:
    client = temporal_env.client
    async with Worker(
        client,
        task_queue="questions",
        workflows=[QuestionMission],
        activities=[record_question, record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        # The time-skipping server moves past the 24-hour wait once nothing else runs.
        handle = await client.start_workflow(
            QuestionMission.run,
            Mission(prompt="Book a room", deps=_deps()),
            id="mission-unanswered",
            task_queue="questions",
        )
        outcome = await handle.result()
        steps = await handle.query("steps")
    assert outcome.output == "the tool said: nobody answered the question in time"
    assert [step["outcome"] for step in steps] == ["Unanswered"]


async def test_the_question_is_recorded_on_the_harness_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str, dict[str, Any]]] = []

    async def call_tool(token: str, name: str, arguments: dict[str, Any]) -> Any:
        calls.append((token, name, arguments))
        return {"id": "q-9"}

    monkeypatch.setattr(platform_mcp, "call_tool", call_tool)

    question = QuestionWanted(
        run_id="run-q", question="Which office?", options=["Dubai"], harness_token="h"
    )
    assert await create_question(question) == "q-9"
    assert calls == [
        (
            "h",
            questions.QUESTION_TOOL,
            {"run_id": "run-q", "question": "Which office?", "options": ["Dubai"]},
        )
    ]


async def test_the_values_a_question_asks_for_reach_the_panel_as_a_form(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D252: several values asked at once are drawn by the panel as fields; the platform's
    record keeps the question and its options, as before."""
    calls: list[dict[str, Any]] = []
    told: list[tuple[str, dict[str, Any]]] = []

    async def call_tool(token: str, name: str, arguments: dict[str, Any]) -> Any:
        calls.append(arguments)
        return {"id": "q-7"}

    async def tell_panel(run_id: str, name: str, value: dict[str, Any]) -> None:
        told.append((name, value))

    monkeypatch.setattr(platform_mcp, "call_tool", call_tool)
    monkeypatch.setattr(questions, "tell_panel", tell_panel)
    fields = [
        questions.QuestionField(name="title_en", label="Title (English)", default="Ledger"),
        questions.QuestionField(name="priority", options=["Low", "High"]),
    ]

    question = QuestionWanted(run_id="run-q", question="The task's details", fields=fields)
    assert await create_question(question) == "q-7"

    assert calls == [{"run_id": "run-q", "question": "The task's details", "options": []}]
    [(name, value)] = told
    assert name == "awp.agent.question"
    assert value["fields"] == [
        {"name": "title_en", "label": "Title (English)", "options": [], "default": "Ledger"},
        {"name": "priority", "label": "", "options": ["Low", "High"], "default": ""},
    ]


async def test_a_question_the_platform_answers_without_an_id_is_not_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def call_tool(token: str, name: str, arguments: dict[str, Any]) -> Any:
        return "refused"

    monkeypatch.setattr(platform_mcp, "call_tool", call_tool)
    assert await create_question(QuestionWanted(run_id="run-q", question="?")) == ""


class _Context:
    def __init__(self, deps: MissionDeps) -> None:
        self.deps = deps


def _offered(granted: list[str]) -> list[str]:
    toolset = _workflow_toolset(
        cast(RunContext[MissionDeps], _Context(_deps(granted_tools=granted)))
    )
    if toolset is None:
        return []
    return [tool.name for tool in toolset.tool_defs]


def test_ask_person_is_offered_only_to_a_run_granted_it() -> None:
    assert _offered([ASK_PERSON_TOOL]) == [ASK_PERSON_TOOL]
    assert _offered([DELEGATE_TOOL, ASK_PERSON_TOOL]) == [DELEGATE_TOOL, ASK_PERSON_TOOL]
    assert _offered(["work_item_search"]) == []
