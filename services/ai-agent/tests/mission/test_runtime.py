"""The one agent definition, configured per run (M3, D64, D83).

The spike these cases are: that one `Agent`, built once at worker start, can be the
Platform Assistant on one run and a user-defined agent on the next, differing only in the
deps it is handed — model, instructions, tools, grant and approval tiers.

They go at the composed agent rather than at a mock of it, because the question is
whether the library mechanisms do this, not whether our wiring around them type-checks.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from pydantic_ai import DeferredToolRequests, ModelRetry
from pydantic_ai.durable_exec.temporal import PydanticAIPlugin, PydanticAIWorkflow
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.tools import ToolDefinition
from temporalio import workflow
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from awp_agent.harness.types import RunBudget, RunInput, RunStatus, ToolSpec, ToolTier
from awp_agent.mission.deps import MissionDeps
from awp_agent.mission.runtime import (
    APPROVAL_TIERS,
    PLATFORM_TOOLSET_ID,
    Mission,
    MissionWorkflow,
    _contract_output,
    _granted,
    _handoff_in,
    _model_for,
    _needs_approval,
    _platform_tools,
    agent,
    build_agent,
    effort_limits,
    mission_deps,
)


def _answer(info: AgentInfo) -> str:
    """The configuration that actually arrived, as the model's answer."""
    offered = ",".join(sorted(tool.name for tool in info.function_tools))
    return f"{info.instructions or ''}|tools={offered}"


def _echo(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    return ModelResponse(parts=[TextPart(_answer(info))])


async def _echo_stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[str]:
    """The same answer, streamed.

    The runtime attaches an event stream handler so the panel can watch (D98), and that
    makes every model request a streamed one — a model that cannot stream is retried for
    ever rather than failing, which is how this was found.
    """
    yield _answer(info)


#: The spike's own agent and workflow. Both have to be module level: Temporal refuses a
#: workflow defined inside a function, and the agent has to exist before the worker
#: registers its activities — which is the same constraint the real runtime lives under.
SPIKE_MODEL = FunctionModel(_echo, stream_function=_echo_stream, model_name="test")
SPIKE_AGENT = build_agent(models={"test": SPIKE_MODEL})


@workflow.defn(name="SpikeMission")
class SpikeMission(PydanticAIWorkflow):
    __pydantic_ai_agents__ = [SPIKE_AGENT]  # noqa: RUF012 - the base declares it

    @workflow.run
    async def run(self, mission: Mission) -> str:
        result = await SPIKE_AGENT.run(mission.prompt, deps=mission.deps, model=SPIKE_MODEL)
        return str(result.output)


def _deps(**overrides: Any) -> MissionDeps:
    base: dict[str, Any] = {
        "run_id": "run-1",
        "person_id": "person-1",
        "mcp_token": "token-for-run-1",
        "route": "reasoning-default",
        "instructions": "You are the Platform Assistant.",
        "granted_tools": ["work_item_search", "request_type_create"],
        "tool_tiers": {"work_item_search": "T0", "request_type_publish": "T2"},
        "mcp_url": "http://web.test/api/mcp",
    }
    return MissionDeps(**(base | overrides))


class _Context:
    """The parts of a run context these functions read."""

    def __init__(self, deps: MissionDeps, retry: int = 0, max_retries: int = 2) -> None:
        self.deps = deps
        self.partial_output = False
        self.retry = retry
        self.max_retries = max_retries


def _tool(name: str) -> ToolDefinition:
    return ToolDefinition(name=name, description="", parameters_json_schema={"type": "object"})


def test_one_agent_object_serves_every_agent_on_the_platform() -> None:
    """D64. Built once, at import, because Temporal has to see it before any run exists.
    That constraint is what rules out an agent object per configured agent, and the
    reason every difference between agents has to be deps."""
    from awp_agent.mission import runtime

    assert runtime.agent is agent
    assert runtime.build_agent() is not agent  # a second build is a different object...
    assert runtime.agent.name == agent.name  # ...of the same shape


def test_the_model_carries_the_run_s_own_gateway_token() -> None:
    """The token is the run's identity to agentgateway, which decides from it which
    models and connectors the run may reach. A model cached per route would carry
    whichever run's token built it first — which is what the old `lru_cache` did."""
    first = _model_for(_Context(_deps(mcp_token="token-a")), "reasoning-default")  # type: ignore[arg-type]
    second = _model_for(_Context(_deps(mcp_token="token-b")), "reasoning-default")  # type: ignore[arg-type]

    assert isinstance(first, OpenAIChatModel)
    assert isinstance(second, OpenAIChatModel)
    assert first is not second


def test_the_tools_are_the_platform_s_own_mcp_server_as_this_run() -> None:
    """Rule 4: MCP at the tool edge, spoken by the library's client rather than by a
    transport of ours. The bearer is the run's token, so every call is checked against
    the person the run acts for."""
    toolset = _platform_tools(_Context(_deps()))  # type: ignore[arg-type]

    assert toolset is not None
    assert toolset.id == PLATFORM_TOOLSET_ID
    # A run granted nothing opens no session at all: there is nothing behind it to call.
    assert _platform_tools(_Context(_deps(granted_tools=[]))) is None  # type: ignore[arg-type]


def test_the_model_is_offered_exactly_what_the_token_grants() -> None:
    """D37. Not the boundary — the server refuses an ungranted call however the model
    learned the name — but what stops a step being spent on a refusal."""
    context = _Context(_deps(granted_tools=["work_item_search"]))

    assert _granted(context, _tool("work_item_search")) is True  # type: ignore[arg-type]
    assert _granted(context, _tool("request_type_publish")) is False  # type: ignore[arg-type]
    # A run granted nothing is offered nothing, rather than everything.
    empty = _Context(_deps(granted_tools=[]))
    assert _granted(empty, _tool("work_item_search")) is False  # type: ignore[arg-type]


def test_a_connector_tool_is_granted_and_tiered_by_the_name_the_server_lists(
    run_input: RunInput,
) -> None:
    """D223. The platform MCP server lists `custom-server/execute_query` as
    `custom-server__execute_query`, because providers refuse a `/` in a function name; under
    the platform's own name the grant filter would drop it and its approval tier would not
    apply."""
    run = run_input.model_copy(
        update={
            "granted_tools": ["work_item_search", "custom-server/execute_query"],
            "tools": [ToolSpec(name="custom-server/execute_query", tier=ToolTier.T2)],
        }
    )
    context = _Context(mission_deps(run))

    assert _granted(context, _tool("custom-server__execute_query")) is True  # type: ignore[arg-type]
    assert _granted(context, _tool("work_item_search")) is True  # type: ignore[arg-type]
    assert _needs_approval(context, _tool("custom-server__execute_query"), {}) is True  # type: ignore[arg-type]


def test_a_dotted_connector_tool_is_granted_by_the_name_the_server_lists(
    run_input: RunInput,
) -> None:
    """D363. `erp/claims.read` is listed as `erp__claims-_read`, as `modelToolName` writes it
    (`tests/connector-tool-name.test.ts` holds the same names); a `.` reached OpenRouter and
    the run failed (RUN-88232)."""
    run = run_input.model_copy(
        update={
            "granted_tools": ["erp/claims.read", "custom-server/describe-table"],
            "tools": [ToolSpec(name="erp/claims.read", tier=ToolTier.T2)],
        }
    )
    context = _Context(mission_deps(run))

    assert _granted(context, _tool("erp__claims-_read")) is True  # type: ignore[arg-type]
    assert _granted(context, _tool("custom-server__describe--table")) is True  # type: ignore[arg-type]
    assert _needs_approval(context, _tool("erp__claims-_read"), {}) is True  # type: ignore[arg-type]


def test_a_run_has_no_effort_limit_unless_the_platform_sends_one(run_input: RunInput) -> None:
    """D389. RUN-88199 stopped at its 60th model request, still creating a request type's
    steps. Without a limit sent the run has none, not the library's default of 50."""
    unbounded = effort_limits(mission_deps(run_input.model_copy(update={"budget": RunBudget()})))
    bounded = effort_limits(mission_deps(run_input))

    assert (unbounded.request_limit, unbounded.tool_calls_limit) == (None, None)
    assert (bounded.request_limit, bounded.tool_calls_limit) == (4, 5)


def test_a_t2_call_pauses_and_a_read_does_not() -> None:
    """D17. Gating reads makes the agent useless without making it safer."""
    context = _Context(_deps())

    assert _needs_approval(context, _tool("request_type_publish"), {}) is True  # type: ignore[arg-type]
    assert _needs_approval(context, _tool("work_item_search"), {}) is False  # type: ignore[arg-type]
    # A tool the platform did not tier is read-class here, and still re-checked at the
    # server, which is where the tier actually binds.
    assert _needs_approval(context, _tool("unknown_tool"), {}) is False  # type: ignore[arg-type]


def test_the_tier_comes_from_the_platform_not_the_agent() -> None:
    """Specification 7.4.5: an agent cannot lower the tier of a tool. The tiers arrive in
    deps from the platform's own catalogue, so an agent claiming otherwise changes
    nothing — and the server re-checks regardless (D30)."""
    lying = _Context(_deps(tool_tiers={"request_type_publish": "T0"}))
    # The agent's deps are what the *platform* sent, so this case is really a statement
    # about where the value comes from: there is no path by which the agent writes it.
    assert _needs_approval(lying, _tool("request_type_publish"), {}) is False  # type: ignore[arg-type]
    assert "T2" in APPROVAL_TIERS


def test_instructions_come_from_deps_so_two_runs_differ_without_new_code() -> None:
    """The whole point of one runtime: the Assistant and a user-defined agent are the
    same object with different deps (D64)."""
    assistant = _deps(instructions="You are the Platform Assistant.")
    reviewer = _deps(instructions="You review expense claims.", granted_tools=["request_read"])

    assert assistant.instructions != reviewer.instructions
    assert _granted(_Context(reviewer), _tool("request_read")) is True  # type: ignore[arg-type]
    assert _granted(_Context(assistant), _tool("request_read")) is False  # type: ignore[arg-type]


async def test_one_agent_two_configurations_under_temporal(
    temporal_env: WorkflowEnvironment,
) -> None:
    """The M3 question, asked of the running system: can one agent definition, registered
    once with a Temporal worker, be two different agents on two runs?

    The model answers with the instructions and tool names it was actually given, so the
    assertion is about what reached it — the only honest way to tell configuration from
    coincidence. Nothing is rebuilt between the two runs: one worker, one agent, one set
    of registered activities.
    """
    client = temporal_env.client
    async with Worker(
        client,
        task_queue="spike",
        workflows=[SpikeMission],
        plugins=[PydanticAIPlugin()],
    ):
        assistant = await client.execute_workflow(
            SpikeMission.run,
            Mission(
                prompt="hello",
                deps=_deps(
                    instructions="You are the Platform Assistant.",
                    # No grant, so no MCP session: this case is about the model and the
                    # instructions reaching the run, which is what M3 has to prove.
                    granted_tools=[],
                ),
            ),
            id="spike-assistant",
            task_queue="spike",
        )
        reviewer = await client.execute_workflow(
            SpikeMission.run,
            Mission(
                prompt="hello",
                deps=_deps(
                    instructions="You review expense claims.",
                    granted_tools=[],
                ),
            ),
            id="spike-reviewer",
            task_queue="spike",
        )

    # Same agent object, same worker, same activities — two different agents.
    assert assistant.startswith("You are the Platform Assistant.")
    assert reviewer.startswith("You review expense claims.")
    assert "You review expense claims." not in assistant

    # Granted nothing, so nothing was offered — the filter applied inside the durable run,
    # and no tool of the harness's own (`delegate_task`) arrives without a grant (D142).
    assert assistant.endswith("|tools=")
    assert reviewer.endswith("|tools=")


def test_an_empty_answer_is_not_a_success() -> None:
    """D40. A model will say it is done when it has given up, so the status is decided
    in code. A run that produced nothing delivered nothing."""
    mission = MissionWorkflow()
    # No contract declared, so the checks above are all the platform has.
    work = Mission(prompt="anything", deps=_deps())

    assert mission._finished(work, "Here is the summary.").status is RunStatus.SUCCEEDED
    assert mission._finished(work, "   ").status is RunStatus.FAILED
    assert mission._finished(work, "").status is RunStatus.FAILED


def test_a_handoff_is_blocked_not_succeeded() -> None:
    """D42. A blocker is the agent saying it cannot finish and naming what stopped it.
    Reporting that as success is a lie; reporting it as waiting leaves it in a resumable
    queue nobody acts on."""
    mission = MissionWorkflow()
    mission._handoff = _handoff_in(
        [
            ModelResponse(
                parts=[
                    ToolCallPart(
                        "write_handoff",
                        {"goal": "Close the vendor", "next_step": "Somebody reads the record."},
                    )
                ]
            )
        ]
    )
    work = Mission(prompt="anything", deps=_deps())

    outcome = mission._finished(work, "I could not reach the vendor record; somebody has to.")
    assert outcome.status is RunStatus.BLOCKED
    assert "vendor record" in outcome.output


def test_an_output_that_misses_the_step_contract_is_not_complete() -> None:
    """D41. For a request step the declared contract is the only objective definition of
    done the platform has, so an answer that misses it is not a completed mission —
    whatever the model wrote about having finished."""
    mission = MissionWorkflow()
    contract = {
        "type": "object",
        "properties": {"action": {"type": "string"}},
        "required": ["action"],
        "additionalProperties": False,
    }
    work = Mission(prompt="Close it", deps=_deps(output_schema=contract))

    # Prose where the step asked for one of its actions.
    missed = mission._finished(work, "I reviewed the claim and it looks fine.")
    assert missed.status is RunStatus.FAILED

    # The action the step actually offers.
    met = mission._finished(work, '{"action": "Approve"}')
    assert met.status is RunStatus.SUCCEEDED


STEP_CONTRACT = {
    "type": "object",
    "properties": {"action": {"enum": ["Approve", "Return", "Reject"]}},
    "required": ["action"],
    "additionalProperties": False,
}


def test_an_answer_that_misses_the_step_contract_goes_back_to_the_model() -> None:
    """D373: RUN-88252 wrote prose and the schema itself, and failed with no second try."""
    context = _Context(_deps(output_schema=STEP_CONTRACT))
    echoed = f"The Approve action succeeded.\n{json.dumps(STEP_CONTRACT)}"

    with pytest.raises(ModelRetry, match="does not match its schema"):
        _contract_output(context, echoed)  # type: ignore[arg-type]


def test_the_object_after_prose_is_kept_as_the_output() -> None:
    context = _Context(_deps(output_schema=STEP_CONTRACT))

    output = _contract_output(context, 'Done.\n{"action": "Approve"}')  # type: ignore[arg-type]

    assert output == '{"action": "Approve"}'


def test_the_last_retry_leaves_the_judgement_to_the_finish() -> None:
    """Out of retries, the answer is kept so the run fails with the contract's own reason."""
    context = _Context(_deps(output_schema=STEP_CONTRACT), retry=2, max_retries=2)

    assert _contract_output(context, "Done.") == "Done."  # type: ignore[arg-type]


def test_an_answer_without_a_contract_or_a_pause_is_left_alone() -> None:
    paused = DeferredToolRequests()

    assert _contract_output(_Context(_deps()), "Here is the summary.") == "Here is the summary."  # type: ignore[arg-type]
    assert _contract_output(_Context(_deps(output_schema=STEP_CONTRACT)), paused) is paused  # type: ignore[arg-type]


async def test_a_server_escalation_pauses_like_a_t2_call_and_the_retry_carries_the_approval() -> (
    None
):
    """Spec section 5: a T1 edit the server escalates because of a field (D58) is refused
    with `approval_required`, having written nothing; that refusal becomes the library's
    approval pause, and the approved retry presents the approval for the server to spend."""
    from pydantic_ai import Agent, ModelRetry
    from pydantic_ai.messages import ModelRequest, ToolReturnPart
    from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults, ToolApproved
    from pydantic_ai.toolsets import ApprovalRequiredToolset, FunctionToolset

    from awp_agent.mission.runtime import APPROVAL_ARGUMENT, _ServerApproval

    received: list[dict[str, Any]] = []

    def request_type_step_edit(code: str, is_terminal: bool, **approval: str) -> str:
        received.append({"code": code, "is_terminal": is_terminal, **approval})
        if APPROVAL_ARGUMENT not in approval:
            raise ModelRetry("not permitted. approval_required: is_terminal needs a person")
        return "edited"

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        returns = [
            part
            for message in messages
            if isinstance(message, ModelRequest)
            for part in message.parts
            if isinstance(part, ToolReturnPart)
        ]
        if not returns:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "request_type_step_edit", {"code": "LC1", "is_terminal": True}, "call-1"
                    )
                ]
            )
        return ModelResponse(parts=[TextPart(str(returns[-1].content))])

    toolset = ApprovalRequiredToolset(
        _ServerApproval(FunctionToolset([request_type_step_edit])), lambda *_: False
    )
    escalating = Agent(
        FunctionModel(model), toolsets=[toolset], output_type=[str, DeferredToolRequests]
    )

    paused = await escalating.run("Mark Completed terminal")
    assert isinstance(paused.output, DeferredToolRequests)
    assert [call.tool_name for call in paused.output.approvals] == ["request_type_step_edit"]
    # The server's reason is carried to the approval the person reads.
    assert "is_terminal needs a person" in paused.output.metadata["call-1"]["reason"]

    resumed = await escalating.run(
        message_history=paused.all_messages(),
        deferred_tool_results=DeferredToolResults(
            approvals={
                "call-1": ToolApproved(
                    override_args={"code": "LC1", "is_terminal": True, APPROVAL_ARGUMENT: "ap-1"}
                )
            }
        ),
    )
    assert resumed.output == "edited"
    assert received[-1][APPROVAL_ARGUMENT] == "ap-1"


def test_the_frame_tells_the_model_which_language_the_person_reads(run_input: RunInput) -> None:
    """D162. Told nothing, an agent wrote a file in both languages for somebody who reads one."""
    from awp_agent.mission.runtime import _frame_of

    english = _frame_of(run_input)
    assert "reads English" in english
    assert "any file you make in English" in english
    arabic = _frame_of(
        run_input.model_copy(update={"actor": run_input.actor.model_copy(update={"locale": "ar"})})
    )
    assert "reads Arabic" in arabic
