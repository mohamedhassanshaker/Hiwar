"""The mission workflow's own loop, end to end on the Temporal test server.

Unlike `test_questions.py`, nothing of the workflow is replaced: `agent.run` runs under
`TemporalDurability` with every toolset and capability the runtime composes, and only the
model is a script. The platform's activities and its MCP server are stand-ins.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest
from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from temporalio import activity, workflow
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

with workflow.unsafe.imports_passed_through():
    from awp_agent.clients import platform_mcp
    from awp_agent.config import settings
    from awp_agent.harness.activities.finalize import FinalizeInput
    from awp_agent.harness.types import RunStatus
    from awp_agent.mission.approvals import ApprovalWanted
    from awp_agent.mission.delegation import ChildMission, ChildMissionWanted
    from awp_agent.mission.deps import MissionDeps, SkillDoc
    from awp_agent.mission.questions import QuestionWanted
    from awp_agent.mission.runtime import (
        ASK_PERSON_TOOL,
        DELEGATE_TOOL,
        TOOL_RETRIES,
        Mission,
        MissionOutcome,
        MissionWorkflow,
        build_agent,
    )
    from awp_agent.mission.sandbox import (
        SANDBOX_TOOLS,
        SKILL_SCRIPT_RUN_TOOL,
        WORKSPACE_FILE_SAVE_TOOL,
        WORKSPACE_FILE_WRITE_TOOL,
        SandboxRelease,
    )
    from awp_agent.mission.skill_files import SKILL_FILE_READ_TOOL, SKILL_LOAD_TOOL
    from awp_agent.mission.tools import GENERATE_DOCUMENT_TOOL, WRITE_HANDOFF_TOOL
    from tests.mission import platform_server, sandbox_server

#: What each turn of the scripted model does, keyed by the test's prompt.
SCRIPTS: dict[str, Any] = {}
#: What the model was shown on each turn, for the assertions.
SEEN: list[AgentInfo] = []
#: The messages the model was sent on each turn, in the same order.
SENT: list[list[ModelMessage]] = []
#: A turn of the prompt named here waits for its event before it answers, so a test can act
#: while a model call is in flight. `HELD` is set once the turn is waiting.
HOLD: dict[str, asyncio.Event] = {}
HELD: dict[str, asyncio.Event] = {}


def _returns(messages: list[ModelMessage]) -> list[ToolReturnPart]:
    return [
        part
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    ]


def _prompt(messages: list[ModelMessage]) -> str:
    first = messages[0]
    assert isinstance(first, ModelRequest)
    return str(next(part.content for part in first.parts if part.part_kind == "user-prompt"))


def _turn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    SEEN.append(info)
    SENT.append(list(messages))
    script = SCRIPTS[_prompt(messages)]
    return script(_returns(messages))  # type: ignore[no-any-return]


async def _turn_stream(
    messages: list[ModelMessage], info: AgentInfo
) -> AsyncIterator[str | dict[int, DeltaToolCall]]:
    prompt = _prompt(messages)
    if prompt in HOLD:
        HELD[prompt].set()
        await HOLD.pop(prompt).wait()
    response = _turn(messages, info)
    for index, part in enumerate(response.parts):
        if isinstance(part, ToolCallPart):
            yield {
                index: DeltaToolCall(
                    name=part.tool_name,
                    json_args=json.dumps(part.args_as_dict()),
                    tool_call_id=part.tool_call_id,
                )
            }
        elif isinstance(part, TextPart):
            yield part.content


LOOP_MODEL = FunctionModel(_turn, stream_function=_turn_stream, model_name="loop")
LOOP_AGENT = build_agent(models={"loop": LOOP_MODEL})


@workflow.defn(name="LoopMission")
class LoopMission(MissionWorkflow):
    """The real mission workflow, on the scripted model."""

    __pydantic_ai_agents__ = [LOOP_AGENT]  # noqa: RUF012 - the base declares it
    mission_agent = LOOP_AGENT
    mission_model = LOOP_MODEL

    @workflow.run
    async def run(self, mission: Mission) -> MissionOutcome:
        return await super().run(mission)


@workflow.defn(name="MissionWorkflow")
class ChildMissionOnTheLoop(LoopMission):
    """What a delegation starts: `MissionWorkflow` by name, here on the scripted model.

    It lists no agent of its own because `LoopMission`, on the same worker, already
    registers the scripted agent's activities, and a second copy would collide.
    """

    __pydantic_ai_agents__ = []  # noqa: RUF012 - the base declares it

    @workflow.run
    async def run(self, mission: Mission) -> MissionOutcome:
        return await super().run(mission)


finished: list[FinalizeInput] = []
raised: list[ApprovalWanted] = []
registered: list[ChildMissionWanted] = []
released: list[str] = []


@activity.defn(name="finalize")
async def record_outcome(outcome: FinalizeInput) -> None:
    finished.append(outcome)


@activity.defn(name="create_question")
async def record_question(_wanted: QuestionWanted) -> str:
    return "q-1"


@activity.defn(name="create_approval")
async def raise_approval(wanted: ApprovalWanted) -> str:
    raised.append(wanted)
    return f"approval-{len(raised)}"


#: The agent code the platform refuses a delegation to, as `run_start` would.
UNREACHABLE_AGENT = "nobody"


@activity.defn(name="register_child_mission")
async def register_child(wanted: ChildMissionWanted) -> ChildMission:
    registered.append(wanted)
    if wanted.agent_code == UNREACHABLE_AGENT:
        return ChildMission(error="That agent is not available to this run.")
    return ChildMission(
        deps=_deps(
            run_id=wanted.child_run_id,
            mcp_token="model-token-child",
            harness_token="harness-token-child",
        )
    )


@activity.defn(name="release_sandbox")
async def release_sandbox(release: SandboxRelease) -> None:
    released.append(release.run_id)


ACTIVITIES: list[Callable[..., Any]] = [
    record_outcome,
    record_question,
    raise_approval,
    register_child,
    release_sandbox,
]


def _deps(**overrides: Any) -> MissionDeps:
    base: dict[str, Any] = {
        "run_id": "00000000-0000-4000-8000-000000000001",
        "person_id": "person-1",
        "mcp_token": "model-token",
        "harness_token": "harness-token",
        "route": "reasoning-default",
        "granted_tools": [],
    }
    return MissionDeps(**(base | overrides))


@pytest.fixture(autouse=True)
def _fresh() -> None:
    SCRIPTS.clear()
    SEEN.clear()
    SENT.clear()
    HOLD.clear()
    HELD.clear()
    finished.clear()
    raised.clear()
    registered.clear()
    released.clear()


def _worker(env: WorkflowEnvironment, task_queue: str = "loop") -> Worker:
    return Worker(
        env.client,
        task_queue=task_queue,
        workflows=[LoopMission, ChildMissionOnTheLoop],
        activities=ACTIVITIES,
        plugins=[PydanticAIPlugin()],
    )


async def _until_waiting(handle: Any) -> None:
    """Return once the mission says it is waiting on a person."""
    for _ in range(400):
        status = str(await handle.query("status"))
        if status != RunStatus.RUNNING:
            break
        await asyncio.sleep(0.05)
    assert status == RunStatus.WAITING, await handle.result()


async def _ended_within(handle: Any, seconds: float) -> MissionOutcome:
    """The mission's outcome, or a failed test that leaves no mission running behind it."""
    try:
        outcome: MissionOutcome = await asyncio.wait_for(handle.result(), timeout=seconds)
    except TimeoutError:
        await handle.terminate("the test stopped waiting for it")
        pytest.fail(f"the mission had not ended after {seconds} s")
    return outcome


async def _run(
    env: WorkflowEnvironment, prompt: str, deps: MissionDeps, *, answer: str | None = None
) -> MissionOutcome:
    client = env.client
    async with _worker(env):
        handle = await client.start_workflow(
            LoopMission.run,
            Mission(prompt=prompt, deps=deps),
            id=f"loop-{prompt}",
            task_queue="loop",
        )
        if answer is not None:
            await _until_waiting(handle)
            await handle.signal(
                "answer", {"question_id": "q-1", "answer": answer, "answered_by": "p-1"}
            )
        return await handle.result()


async def test_a_paused_call_resumes_the_same_conversation(
    temporal_env: WorkflowEnvironment,
) -> None:
    """The library refuses deferred results without the history they answer, so a resume
    that drops it fails every mission that ever pauses for a person."""

    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        if not returns:
            return ModelResponse(
                parts=[ToolCallPart(ASK_PERSON_TOOL, {"question": "Which office?"}, "call-1")]
            )
        return ModelResponse(parts=[TextPart(f"booked in {returns[-1].content}")])

    SCRIPTS["book"] = script
    outcome = await _run(
        temporal_env, "book", _deps(granted_tools=[ASK_PERSON_TOOL]), answer="Dubai"
    )

    assert outcome.status is RunStatus.SUCCEEDED
    assert outcome.output == "booked in Dubai"
    # The totals reach the run row rather than the zeros it was written with before.
    assert finished[-1].tokens_in > 0
    # The handoff is written from what the mission did, not from nothing.
    assert finished[-1].transcript == "booked in Dubai"


async def test_a_granted_skill_is_listed_and_its_body_reaches_the_model_when_loaded(
    temporal_env: WorkflowEnvironment,
) -> None:
    """Per run, under Temporal, and only the run's own (D377)."""
    skill = SkillDoc(
        name="guided-platform-creation",
        description="Create a platform object from live data.",
        instructions="# Skill: guided-platform-creation\nCall the _list tools first.",
    )

    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        if not returns:
            load = ToolCallPart(SKILL_LOAD_TOOL, {"skill": skill.name}, "call-1")
            return ModelResponse(parts=[load])
        return ModelResponse(parts=[TextPart("ok")])

    SCRIPTS["create"] = script
    outcome = await _run(temporal_env, "create", _deps(skills=[skill]))

    assert outcome.status is RunStatus.SUCCEEDED
    instructions = SEEN[0].instructions or ""
    assert "`guided-platform-creation`: Create a platform object from live data." in instructions
    assert "Call the _list tools first." not in instructions
    assert {SKILL_LOAD_TOOL, SKILL_FILE_READ_TOOL} <= {t.name for t in SEEN[0].function_tools}
    loaded = _returns(SENT[-1])[-1].content
    assert "Call the _list tools first." in str(loaded)

    SCRIPTS["plain"] = lambda _returns: ModelResponse(parts=[TextPart("ok")])
    await _run(temporal_env, "plain", _deps())
    assert "guided-platform-creation" not in (SEEN[-1].instructions or "")
    assert SKILL_LOAD_TOOL not in {tool.name for tool in SEEN[-1].function_tools}


async def test_a_handoff_ends_the_mission_blocked_with_the_agent_s_own_handoff(
    temporal_env: WorkflowEnvironment,
) -> None:
    handoff = {"goal": "Publish CHG", "next_step": "An owner grants request_type_publish."}

    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        if not returns:
            return ModelResponse(parts=[ToolCallPart(WRITE_HANDOFF_TOOL, handoff, "call-1")])
        return ModelResponse(parts=[TextPart("I need an owner to publish it.")])

    SCRIPTS["publish"] = script
    outcome = await _run(temporal_env, "publish", _deps(granted_tools=[WRITE_HANDOFF_TOOL]))

    assert outcome.status is RunStatus.BLOCKED
    recorded = finished[-1].handoff
    assert recorded is not None
    assert (recorded.goal, recorded.next_step) == (handoff["goal"], handoff["next_step"])


async def test_an_ungranted_harness_tool_is_not_offered(
    temporal_env: WorkflowEnvironment,
) -> None:
    SCRIPTS["hello"] = lambda _returns: ModelResponse(parts=[TextPart("hi")])
    await _run(temporal_env, "hello", _deps(granted_tools=[GENERATE_DOCUMENT_TOOL]))

    offered = {tool.name for tool in SEEN[0].function_tools}
    assert GENERATE_DOCUMENT_TOOL in offered
    assert WRITE_HANDOFF_TOOL not in offered


async def test_running_out_of_steps_is_not_success(temporal_env: WorkflowEnvironment) -> None:
    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    WRITE_HANDOFF_TOOL, {"goal": "g", "next_step": "n"}, f"c{len(returns)}"
                )
            ]
        )

    SCRIPTS["loop"] = script
    outcome = await _run(
        temporal_env, "loop", _deps(granted_tools=[WRITE_HANDOFF_TOOL], max_steps=2)
    )

    assert outcome.status is RunStatus.BUDGET_EXCEEDED


async def test_a_generated_document_is_saved_against_the_room(
    temporal_env: WorkflowEnvironment, monkeypatch: pytest.MonkeyPatch
) -> None:
    pytest.importorskip("openpyxl")
    saved: list[tuple[str, str, dict[str, Any]]] = []

    async def artifact_create(
        token: str, name: str, arguments: dict[str, Any], url: str | None = None
    ) -> dict[str, str]:
        saved.append((token, name, arguments))
        return {"artifact_id": "a-1"}

    monkeypatch.setattr(platform_mcp, "call_tool", artifact_create)
    sheet = {
        "format": "xlsx",
        "title": "Tahseel features",
        "sheets": [{"name": "Features", "headers": ["Feature"], "rows": [["Requests"]]}],
    }

    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        if not returns:
            return ModelResponse(parts=[ToolCallPart(GENERATE_DOCUMENT_TOOL, sheet, "call-1")])
        return ModelResponse(parts=[TextPart(f"done: {returns[-1].content}")])

    SCRIPTS["excel"] = script
    outcome = await _run(
        temporal_env,
        "excel",
        _deps(
            granted_tools=[GENERATE_DOCUMENT_TOOL],
            context_type="Room",
            context_key="SES-1001",
        ),
    )

    assert outcome.status is RunStatus.SUCCEEDED
    [(token, name, arguments)] = saved
    # As the run's own model token, so the server checks the person and the grant.
    assert (token, name) == ("model-token", "artifact_create")
    assert (arguments["linked_to_type"], arguments["linked_to_key"]) == ("Room", "SES-1001")
    assert arguments["file_name"] == "tahseel-features.xlsx"
    assert "project_key" not in arguments


async def test_the_workflow_as_the_worker_loads_it_writes_its_outcome_back(
    temporal_env: WorkflowEnvironment,
) -> None:
    """The sandbox imports `runtime.py` itself here, as it does on the worker. A module it
    imports outside the pass-through brings a second copy of the platform's types, and
    `FinalizeInput` refuses them, so no outcome is ever written back."""
    client = temporal_env.client
    async with Worker(
        client,
        task_queue="as-loaded",
        workflows=[MissionWorkflow],
        activities=[record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        # No model request is allowed, so the mission ends before reaching a model.
        outcome = await client.execute_workflow(
            MissionWorkflow.run,
            Mission(prompt="anything", deps=_deps(max_steps=0)),
            id="as-loaded",
            task_queue="as-loaded",
        )

    assert outcome.status is RunStatus.BUDGET_EXCEEDED
    assert [one.status for one in finished] == [RunStatus.BUDGET_EXCEEDED]


async def test_a_write_tool_is_found_by_search_before_it_is_called(
    temporal_env: WorkflowEnvironment, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Tools above READ are deferred, so their schemas leave every request until the model
    searches for one; the search and the reveal both happen inside the durable run."""
    pytest.importorskip("openpyxl")

    async def artifact_create(
        token: str, name: str, arguments: dict[str, Any], url: str | None = None
    ) -> dict[str, str]:
        return {"artifact_id": "a-2"}

    monkeypatch.setattr(platform_mcp, "call_tool", artifact_create)
    sheet = {"format": "xlsx", "title": "Found", "sheets": [{"name": "S", "rows": [["x"]]}]}

    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        if not returns:
            return ModelResponse(
                parts=[ToolCallPart("search_tools", {"queries": ["document"]}, "call-1")]
            )
        if len(returns) == 1:
            return ModelResponse(parts=[ToolCallPart(GENERATE_DOCUMENT_TOOL, sheet, "call-2")])
        return ModelResponse(parts=[TextPart("saved")])

    SCRIPTS["find"] = script
    outcome = await _run(
        temporal_env,
        "find",
        _deps(
            granted_tools=[GENERATE_DOCUMENT_TOOL],
            tool_tiers={GENERATE_DOCUMENT_TOOL: "T1"},
            context_type="Room",
            context_key="SES-1001",
        ),
    )

    assert outcome.status is RunStatus.SUCCEEDED
    first = {tool.name for tool in SEEN[0].function_tools}
    assert GENERATE_DOCUMENT_TOOL not in first
    assert GENERATE_DOCUMENT_TOOL in {tool.name for tool in SEEN[1].function_tools}


#: A granted skill that ships a script, as the API process loads one (D209).
DECK_SKILL = SkillDoc(
    name="deck-builder",
    description="Build a branded deck.",
    instructions="# Skill: deck-builder\nWrite the spec, then run scripts/build.js.",
    scripts=["scripts/build.js"],
)


async def test_a_skill_s_script_builds_the_file_the_mission_saves(
    temporal_env: WorkflowEnvironment, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    """Under Temporal, end to end: write the input, run the script, save what it made, and
    release the run's sandbox when the mission ends."""
    sandbox = sandbox_server.install(monkeypatch)
    bundle = tmp_path / "deck-builder"
    (bundle / "scripts").mkdir(parents=True)
    (bundle / "SKILL.md").write_text("---\nname: deck-builder\n---\n")
    (bundle / "scripts" / "build.js").write_text("console.log('built')")
    monkeypatch.setenv("AWP_SKILLS_PATH", str(tmp_path))
    settings.cache_clear()
    saved = _saving_into(monkeypatch)
    calls: list[tuple[str, dict[str, Any]]] = [
        (WORKSPACE_FILE_WRITE_TOOL, {"path": "deck.json", "content": "{}"}),
        (
            SKILL_SCRIPT_RUN_TOOL,
            {
                "skill": "deck-builder",
                "script": "scripts/build.js",
                "arguments": ["--spec", "deck.json", "--out", "out/Deck.pptx"],
            },
        ),
        (WORKSPACE_FILE_SAVE_TOOL, {"path": "out/Deck.pptx", "title": "Deck"}),
    ]

    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        if len(returns) < len(calls):
            name, arguments = calls[len(returns)]
            return ModelResponse(parts=[ToolCallPart(name, arguments, f"call-{len(returns)}")])
        return ModelResponse(parts=[TextPart("Saved the deck.")])

    SCRIPTS["deck"] = script
    deps = _deps(
        granted_tools=sorted(SANDBOX_TOOLS),
        skills=[DECK_SKILL],
        context_type="Room",
        context_key="SES-1001",
        sandbox_url="http://sandbox-manager",
    )
    try:
        outcome = await _run(temporal_env, "deck", deps)
    finally:
        settings.cache_clear()

    assert outcome.status is RunStatus.SUCCEEDED
    arguments = calls[1][1]["arguments"]
    assert sandbox.scripts == [["node", "skills/deck-builder/scripts/build.js", *arguments]]
    assert saved == ["Deck.pptx"]
    assert "`skills/deck-builder/`" in (SEEN[0].instructions or "")
    assert released == [deps.run_id]


async def test_the_sandbox_tools_are_not_offered_without_a_skill_that_ships_a_script(
    temporal_env: WorkflowEnvironment,
) -> None:
    SCRIPTS["plain-deck"] = lambda _returns: ModelResponse(parts=[TextPart("ok")])
    no_scripts = SkillDoc(name="writing", description="", instructions="# Skill: writing")
    await _run(
        temporal_env,
        "plain-deck",
        _deps(granted_tools=sorted(SANDBOX_TOOLS), skills=[no_scripts]),
    )

    assert not SANDBOX_TOOLS & {tool.name for tool in SEEN[0].function_tools}
    assert released == []


def _saving_into(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Stand in for the platform's `artifact_create`, recording each file saved."""
    saved: list[str] = []

    async def artifact_create(
        token: str, name: str, arguments: dict[str, Any], url: str | None = None
    ) -> dict[str, str]:
        saved.append(str(arguments["file_name"]))
        return {"artifact_id": f"a-{len(saved)}"}

    monkeypatch.setattr(platform_mcp, "call_tool", artifact_create)
    return saved


#: A spreadsheet the model asks for, which the platform would save against the room.
SHEET = {"format": "xlsx", "title": "Claims", "sheets": [{"name": "S", "rows": [["x"]]}]}


async def test_a_mission_stopped_during_a_model_call_ends_cancelled_and_runs_nothing_after(
    temporal_env: WorkflowEnvironment, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D67: a stop that waits for the current model call to finish is not a stop. The
    answer that call would have given, a tool call, must never run.

    On a test server of its own: the abandoned model call finishes after its workflow has
    closed, and the shared server then never skips time again for the tests after it."""
    pytest.importorskip("openpyxl")
    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=temporal_env.client.data_converter
    ) as own_env:
        await _stop_during_a_model_call(own_env, monkeypatch)


async def _stop_during_a_model_call(
    temporal_env: WorkflowEnvironment, monkeypatch: pytest.MonkeyPatch
) -> None:
    saved = _saving_into(monkeypatch)
    SCRIPTS["stop me"] = lambda _returns: ModelResponse(
        parts=[ToolCallPart(GENERATE_DOCUMENT_TOOL, SHEET, "call-1")]
    )
    release = HOLD["stop me"] = asyncio.Event()
    held = HELD["stop me"] = asyncio.Event()
    deps = _deps(granted_tools=[GENERATE_DOCUMENT_TOOL], context_type="Room", context_key="SES-1")

    async with _worker(temporal_env):
        handle = await temporal_env.client.start_workflow(
            LoopMission.run,
            Mission(prompt="stop me", deps=deps),
            id="loop-stop-me",
            task_queue="loop",
        )
        try:
            await asyncio.wait_for(held.wait(), timeout=30)
            await handle.signal("cancel")
            outcome = await _ended_within(handle, 30)
        finally:
            # The abandoned model call now answers with a tool call; the mission is over.
            release.set()
            await asyncio.sleep(1)

    assert outcome.status is RunStatus.CANCELLED
    assert [one.status for one in finished] == [RunStatus.CANCELLED]
    assert saved == []


async def test_a_mission_stopped_while_it_waits_for_an_answer_ends_cancelled(
    temporal_env: WorkflowEnvironment, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D67: the pending question is voided, and the model does not carry on as if it had
    been told something."""
    pytest.importorskip("openpyxl")
    saved = _saving_into(monkeypatch)

    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        if not returns:
            return ModelResponse(
                parts=[ToolCallPart(ASK_PERSON_TOOL, {"question": "Which office?"}, "call-1")]
            )
        return ModelResponse(parts=[ToolCallPart(GENERATE_DOCUMENT_TOOL, SHEET, "call-2")])

    SCRIPTS["ask then stop"] = script
    deps = _deps(
        granted_tools=[ASK_PERSON_TOOL, GENERATE_DOCUMENT_TOOL],
        context_type="Room",
        context_key="SES-1",
    )
    async with _worker(temporal_env):
        handle = await temporal_env.client.start_workflow(
            LoopMission.run,
            Mission(prompt="ask then stop", deps=deps),
            id="loop-ask-then-stop",
            task_queue="loop",
        )
        await _until_waiting(handle)
        await handle.signal("cancel")
        outcome = await _ended_within(handle, 30)
        steps = await handle.query("steps")

    assert outcome.status is RunStatus.CANCELLED
    assert [one.status for one in finished] == [RunStatus.CANCELLED]
    assert [(step["kind"], step["outcome"]) for step in steps] == [("Question", "Cancelled")]
    assert saved == []


def _delegating(agent_code: str) -> Any:
    def script(returns: list[ToolReturnPart]) -> ModelResponse:
        if not returns:
            call = {"agent_code": agent_code, "description": "Summarise claim EXP-1"}
            return ModelResponse(parts=[ToolCallPart(DELEGATE_TOOL, call, "call-1")])
        return ModelResponse(parts=[TextPart(f"I was told: {returns[-1].content}")])

    return script


async def test_a_delegation_runs_the_other_agent_as_its_own_mission_and_returns_its_answer(
    temporal_env: WorkflowEnvironment,
) -> None:
    """D114: the child is a mission workflow of its own, named after the child run the
    platform registered, and its answer, with its outcome, is the delegating tool's result."""
    SCRIPTS["delegate"] = _delegating("exp")
    SCRIPTS["Summarise claim EXP-1"] = lambda _returns: ModelResponse(
        parts=[TextPart("the claim is within policy")]
    )
    parent = _deps(granted_tools=[DELEGATE_TOOL])

    async with _worker(temporal_env, "delegation"):
        handle = await temporal_env.client.start_workflow(
            LoopMission.run,
            Mission(prompt="delegate", deps=parent),
            id="loop-delegate",
            task_queue="delegation",
        )
        outcome = await handle.result()
        steps = await handle.query("steps")
        [wanted] = registered
        child = await temporal_env.client.get_workflow_handle(
            f"run-{wanted.child_run_id}", result_type=MissionOutcome
        ).result()

    assert outcome.status is RunStatus.SUCCEEDED
    assert outcome.output == "I was told: [Succeeded] the claim is within policy"
    # Registered on the parent's plumbing token, for the agent the model named.
    assert (wanted.parent_run_id, wanted.agent_code, wanted.harness_token) == (
        parent.run_id,
        "exp",
        "harness-token",
    )
    assert child.output == "the claim is within policy"
    # Both runs write their own outcome back.
    assert sorted(one.run_id for one in finished) == sorted([parent.run_id, wanted.child_run_id])
    assert [(step["kind"], step["name"], step["outcome"]) for step in steps] == [
        ("Delegation", "exp", "Succeeded")
    ]


async def test_a_refused_delegation_is_told_to_the_model_and_starts_no_child(
    temporal_env: WorkflowEnvironment,
) -> None:
    """D103, D114: the platform's refusal is the tool's result, so the model can do the work
    itself rather than the mission failing."""
    SCRIPTS["delegate to nobody"] = _delegating(UNREACHABLE_AGENT)
    parent = _deps(granted_tools=[DELEGATE_TOOL])

    async with _worker(temporal_env, "delegation"):
        outcome = await temporal_env.client.execute_workflow(
            LoopMission.run,
            Mission(prompt="delegate to nobody", deps=parent),
            id="loop-delegate-to-nobody",
            task_queue="delegation",
        )

    assert outcome.status is RunStatus.SUCCEEDED
    assert outcome.output == "I was told: That agent is not available to this run."
    assert [one.run_id for one in finished] == [parent.run_id]


async def test_a_route_whose_model_is_gone_fails_the_mission_after_four_attempts(
    temporal_env: WorkflowEnvironment,
) -> None:
    """D137, D102: a 404 from the route is retried a bounded number of times rather than for
    ever, and the mission then ends Failed with that written back."""

    def gone(_returns: list[ToolReturnPart]) -> ModelResponse:
        raise ModelHTTPError(status_code=404, model_name="loop", body="No endpoints found")

    SCRIPTS["gone"] = gone
    outcome = await asyncio.wait_for(_run(temporal_env, "gone", _deps()), timeout=120)

    assert len(SEEN) == 4
    assert outcome.status is RunStatus.FAILED
    assert "404" in outcome.output
    assert [one.status for one in finished] == [RunStatus.FAILED]


async def test_a_tool_the_model_keeps_getting_wrong_is_retried_six_times_then_fails(
    temporal_env: WorkflowEnvironment,
) -> None:
    """D137, D380: a refused call is the model's to correct, six times, each time with the
    reason. A seventh refusal ends the mission Failed rather than looping."""
    SCRIPTS["no place"] = lambda _returns: ModelResponse(
        parts=[ToolCallPart(GENERATE_DOCUMENT_TOOL, SHEET, f"call-{len(SEEN)}")]
    )
    # A console mission with no project: the tool refuses before rendering anything.
    outcome = await _run(
        temporal_env, "no place", _deps(granted_tools=[GENERATE_DOCUMENT_TOOL], context_type="")
    )

    assert len(SEEN) == TOOL_RETRIES + 1
    told = [
        part
        for message in SENT[-1]
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, RetryPromptPart)
    ]
    assert TOOL_RETRIES == 6
    assert len(told) == TOOL_RETRIES
    assert all("pass project_key" in str(part.content) for part in told)
    assert outcome.status is RunStatus.FAILED
    assert [one.status for one in finished] == [RunStatus.FAILED]


#: The T2 platform tool the approval tests ask for, and the read the transit test calls.
PUBLISH_TOOL = "request_type_publish"
SEARCH_TOOL = "work_item_search"


def _platform_tools(calls: list[str]) -> dict[str, Any]:
    def request_type_publish(code: str) -> str:
        calls.append(f"{PUBLISH_TOOL}:{code}")
        return "published"

    def work_item_search(query: str) -> str:
        calls.append(f"{SEARCH_TOOL}:{query}")
        return "[]"

    return {PUBLISH_TOOL: request_type_publish, SEARCH_TOOL: work_item_search}


def _keeps_publishing(returns: list[ToolReturnPart]) -> ModelResponse:
    """Find the deferred T2 tool once, then ask for it on every turn."""
    if not returns:
        return ModelResponse(
            parts=[ToolCallPart("search_tools", {"queries": ["publish"]}, "call-0")]
        )
    return ModelResponse(
        parts=[ToolCallPart(PUBLISH_TOOL, {"code": "RT-1"}, f"call-{len(returns)}")]
    )


def _publishing_deps(url: str) -> MissionDeps:
    return _deps(granted_tools=[PUBLISH_TOOL], tool_tiers={PUBLISH_TOOL: "T2"}, mcp_url=url)


async def test_a_model_that_keeps_asking_for_an_unapproved_call_stops_at_twenty_rounds(
    temporal_env: WorkflowEnvironment,
) -> None:
    """D89: the approval rounds are a loop guard. A model that asks again every time nobody
    approves ends Failed after 20 rounds, the call never having run, and says so."""
    calls: list[str] = []
    SCRIPTS["publish again"] = _keeps_publishing

    async with platform_server.serving(_platform_tools(calls)) as served:
        # Nobody decides: each approval expires after its 24 hours, which the
        # time-skipping server passes at once.
        outcome = await asyncio.wait_for(
            _run(temporal_env, "publish again", _publishing_deps(served.url)), timeout=300
        )

    assert len(raised) == 20
    assert calls == []
    assert outcome.status is RunStatus.FAILED
    assert "more rounds of approval" in outcome.output
    assert [one.status for one in finished] == [RunStatus.FAILED]


async def test_a_mission_stopped_while_it_waits_for_an_approval_never_makes_the_call(
    temporal_env: WorkflowEnvironment,
) -> None:
    """D67: the pending approval is voided and the T2 call does not run."""
    calls: list[str] = []
    SCRIPTS["publish then stop"] = _keeps_publishing

    async with (
        platform_server.serving(_platform_tools(calls)) as served,
        _worker(temporal_env),
    ):
        handle = await temporal_env.client.start_workflow(
            LoopMission.run,
            Mission(prompt="publish then stop", deps=_publishing_deps(served.url)),
            id="loop-publish-then-stop",
            task_queue="loop",
        )
        await _until_waiting(handle)
        await handle.signal("cancel")
        outcome = await _ended_within(handle, 30)

    assert [wanted.tool_name for wanted in raised] == [PUBLISH_TOOL]
    assert calls == []
    assert outcome.status is RunStatus.CANCELLED
    assert [one.status for one in finished] == [RunStatus.CANCELLED]


async def test_a_platform_tool_call_that_keeps_failing_in_transit_is_tried_three_times(
    temporal_env: WorkflowEnvironment,
) -> None:
    """D137: a platform call that fails in transit is retried a bounded number of times, on
    the run's own model token, and the mission then ends Failed rather than retrying for
    ever."""
    calls: list[str] = []
    SCRIPTS["search"] = lambda _returns: ModelResponse(
        parts=[ToolCallPart(SEARCH_TOOL, {"query": "overdue"}, "call-1")]
    )

    async with platform_server.serving(
        _platform_tools(calls), unavailable_for={"tools/call"}
    ) as served:
        deps = _deps(
            granted_tools=[SEARCH_TOOL], tool_tiers={SEARCH_TOOL: "T0"}, mcp_url=served.url
        )
        outcome = await asyncio.wait_for(_run(temporal_env, "search", deps), timeout=120)

    assert served.methods.count("tools/call") == 3
    assert set(served.bearers) == {"Bearer model-token"}
    assert calls == []
    assert outcome.status is RunStatus.FAILED
    assert [one.status for one in finished] == [RunStatus.FAILED]


async def test_a_document_save_that_keeps_failing_ends_the_mission_failed(
    temporal_env: WorkflowEnvironment, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The harness's own tools are bounded like platform tool calls: a save that fails at the
    transport every time, as an expired run token does, ends the mission FAILED with its
    outcome written back instead of retrying for ever (RUN-88042, 59 attempts)."""
    pytest.importorskip("openpyxl")
    attempts: list[str] = []

    async def unreachable(
        token: str, name: str, arguments: dict[str, Any], url: str | None = None
    ) -> Any:
        attempts.append(name)
        raise RuntimeError("Client error '401 Unauthorized' for url 'http://web/api/mcp'")

    monkeypatch.setattr(platform_mcp, "call_tool", unreachable)
    SCRIPTS["refused save"] = lambda _returns: ModelResponse(
        parts=[ToolCallPart(GENERATE_DOCUMENT_TOOL, SHEET, "call-1")]
    )
    deps = _deps(granted_tools=[GENERATE_DOCUMENT_TOOL], context_type="Room", context_key="SES-1")

    outcome = await asyncio.wait_for(_run(temporal_env, "refused save", deps), timeout=60)

    assert outcome.status is RunStatus.FAILED
    assert attempts == ["artifact_create"] * 3
    assert [one.status for one in finished] == [RunStatus.FAILED]


async def test_a_failure_outside_the_model_run_still_ends_the_mission_failed(
    temporal_env: WorkflowEnvironment,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """D102: an unhandled failure is FAILED, and the outcome is written back (D123), wherever
    in the mission it happens. Here the platform refuses to raise the approval a T2 call
    waits on, which fails in the workflow's own activity rather than inside the model run."""
    from awp_agent.mission.approvals import create_approval

    caplog.set_level(logging.ERROR, logger="temporalio.activity")
    attempts: list[int] = []

    async def refuse(
        token: str, name: str, arguments: dict[str, Any], url: str | None = None
    ) -> Any:
        attempts.append(1)
        raise platform_mcp.PlatformMcpError(f"{name} was refused")

    monkeypatch.setattr(platform_mcp, "call_tool", refuse)
    calls: list[str] = []
    SCRIPTS["publish refused"] = _keeps_publishing

    async with (
        platform_server.serving(_platform_tools(calls)) as served,
        Worker(
            temporal_env.client,
            task_queue="refused-approval",
            workflows=[LoopMission],
            activities=[record_outcome, create_approval],
            plugins=[PydanticAIPlugin()],
        ),
    ):
        handle = await temporal_env.client.start_workflow(
            LoopMission.run,
            Mission(prompt="publish refused", deps=_publishing_deps(served.url)),
            id="loop-publish-refused",
            task_queue="refused-approval",
        )
        try:
            outcome = await asyncio.wait_for(handle.result(), timeout=20)
        except TimeoutError:
            await handle.terminate("the test stopped waiting for it")
            pytest.fail(
                f"still running after 20 s and {len(attempts)} attempts to raise the "
                f"approval; {len(finished)} outcomes written back"
            )

    assert calls == []
    assert outcome.status is RunStatus.FAILED
    assert [one.status for one in finished] == [RunStatus.FAILED]
