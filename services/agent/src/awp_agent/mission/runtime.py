"""The one agent definition every agent on the platform runs on (D64, D83).

One `Agent`, built once so Temporal sees it at worker start, configured per run from the
deps the platform sends. The built-in Platform Assistant and every user-defined agent are
the same object with different deps — there is no second code path for either.

Everything here is a library mechanism configured on top, not a mechanism of our own:

| Per run | Mechanism |
| --- | --- |
| model | `ResolveModelId` — the route alias and the run's own gateway token |
| tools | `MCPToolset` over Streamable HTTP, the platform MCP server, bearer per run |
| grant | `FilteredToolset` — the model is offered exactly what the token allows |
| approvals | `ApprovalRequiredToolset` — the pause; the server still decides the permission |
| built-ins | `FunctionToolset` — `generate_document`, `write_handoff` (`tools.py`) |
| skill scripts | `FunctionToolset` — run in the run's sandbox Pod (`sandbox.py`) |
| instructions | built from deps, with the record the mission is about and its conversation |
| skills | listed after the instructions; bodies and files loaded on demand (`skill_files.py`) |
| effort limits | `UsageLimits` — none by default (D389); a run's own numbers if sent |
| failing tools | `RepeatedFailureGuard` — refuses a tool after three failed answers in a row |
| durability | `TemporalDurability` |

What is *not* here is as deliberate: no agent loop, no tool dispatcher, no approval state
machine, no budget arithmetic. Those exist in Pydantic AI and the harness, and a second
copy of any of them is a second thing to keep correct.

The boundary stays ours (D84). `ApprovalRequiredToolset` decides that a call pauses; the
platform MCP server decides whether a person agreed to this exact payload against this
record version, and refuses otherwise. A toolset annotation grants nothing.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Any

from fastmcp.client.transports import StreamableHttpTransport
from pydantic_ai import Agent
from pydantic_ai.agent import AbstractAgent, AgentRunResult
from pydantic_ai.capabilities import ResolveModelId, ToolSearch
from pydantic_ai.durable_exec.temporal import PydanticAIWorkflow, TemporalDurability
from pydantic_ai.exceptions import ApprovalRequired, ModelRetry, UsageLimitExceeded
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.messages import ModelMessage, ToolCallPart
from pydantic_ai.models import Model, ModelResolutionContext
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.tools import (
    DeferredToolRequests,
    DeferredToolResults,
    RunContext,
    ToolApproved,
    ToolDefinition,
    ToolDenied,
)
from pydantic_ai.toolsets import (
    ApprovalRequiredToolset,
    DynamicToolset,
    ExternalToolset,
    FilteredToolset,
    WrapperToolset,
)
from pydantic_ai.toolsets.abstract import ToolsetTool
from pydantic_ai.usage import RunUsage, UsageLimits
from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.workflow import ActivityConfig

from awp_agent.clients import gateway_client
from awp_agent.config import settings
from awp_agent.mission.deps import MissionDeps, SkillDoc, model_tool_name

with workflow.unsafe.imports_passed_through():
    from awp_agent import tracing
    from awp_agent.harness import capabilities
    from awp_agent.harness.activities.credentials import RefreshRequest, refresh_credentials
    from awp_agent.harness.activities.finalize import FinalizeInput, finalize
    from awp_agent.harness.activities.verify import json_in, step_contract
    from awp_agent.harness.types import Actor, ContextHandoff, RunInput, RunStatus, TaskFrame
    from awp_agent.mission.approvals import ApprovalDecision, ApprovalWanted, create_approval
    from awp_agent.mission.delegation import (
        ChildMission,
        ChildMissionWanted,
        register_child_mission,
    )
    from awp_agent.mission.failure_guard import RepeatedFailureGuard
    from awp_agent.mission.questions import (
        QuestionAnswer,
        QuestionField,
        QuestionWanted,
        create_question,
    )
    from awp_agent.mission.sandbox import (
        SANDBOX_TOOLS,
        SANDBOX_TOOLSET_ID,
        SandboxRelease,
        instructions_note,
        offered,
        release_sandbox,
        sandbox_toolset,
        uses_sandbox,
    )
    from awp_agent.mission.skill_files import (
        SKILLS_TOOLSET_ID,
        skills_index,
        skills_toolset,
    )
    from awp_agent.mission.skill_files import offered as skills_offered
    from awp_agent.mission.stream import publish_to_panel
    from awp_agent.mission.timeline import timeline
    from awp_agent.mission.tools import (
        HARNESS_TOOLS,
        HARNESS_TOOLSET_ID,
        WRITE_HANDOFF_TOOL,
        harness_toolset,
    )

#: A stable id for the platform toolset. Temporal needs the toolsets of a workflow to be
#: identifiable across a replay, and a generated one would differ between runs.
PLATFORM_TOOLSET_ID = "awp-platform"

#: The toolset whose calls the mission workflow answers itself, rather than the library.
#:
#: Delegating to a *different* configured agent starts a child mission workflow, and only
#: the workflow can start one — an activity cannot. Asking a person waits for their
#: answer, which only the workflow can do without holding a worker. So both calls are
#: deferred back to the workflow the way an approval is (D89, D125), which is the
#: library's own mechanism for "the harness decides what happens to this call" rather
#: than a dispatcher of ours. The id predates the question and stays, because Temporal
#: identifies the toolset's activities by it.
DELEGATION_TOOLSET_ID = "awp-delegation"

DELEGATE_TOOL = "delegate_to_agent"
ASK_PERSON_TOOL = "ask_person"

#: The model id the agent is built with. It names no provider model: it is a placeholder
#: that `ResolveModelId` swaps for the run's route, because the real one is per run.
ROUTE_MODEL_ID = "awp-route"

#: How long a paused call waits for a person (D95). The platform mints fresh credentials
#: into the resume, so the pause is bounded by how long an approval should stay a live
#: grant rather than by a credential's life.
APPROVAL_TIMEOUT = timedelta(hours=24)
APPROVAL_ACTIVITY_TIMEOUT = timedelta(minutes=2)
#: A run token lives 30 minutes; a mission still working replaces it this long after it
#: was minted, and a refresh that came back empty is tried again each minute until then.
TOKEN_LIFETIME = timedelta(minutes=30)
REFRESH_AFTER = timedelta(minutes=25)

#: How many times one mission may pause for approvals. Not a budget: a bound on a loop
#: that would otherwise be unbounded if the model kept asking for the same refused call.
MAX_APPROVAL_ROUNDS = 20

#: Times one tool may be retried in a row before the run fails (D137, raised from 3, D380).
TOOL_RETRIES = 6

#: Writing the outcome back is the one step that must not be lost: a run row left saying
#: Running is a mission nobody can act on.
FINALIZE_RETRY = RetryPolicy(maximum_attempts=5)

#: One model request: a long generation is not cut off and billed twice, and a failing
#: route gives up after a few attempts rather than retrying for ever (D137).
MODEL_ACTIVITY = ActivityConfig(
    start_to_close_timeout=timedelta(minutes=10),
    retry_policy=RetryPolicy(maximum_attempts=4),
)
#: One platform tool call. A write is protected against a repeat by `expectedVersion` and
#: single-use approvals (D59, D21); a read is safe to repeat.
PLATFORM_TOOL_ACTIVITY = ActivityConfig(
    start_to_close_timeout=timedelta(minutes=2),
    retry_policy=RetryPolicy(maximum_attempts=3),
)
#: One skill-script tool call: copying the skills into a fresh sandbox, then a script of
#: up to two minutes (`sandbox.SCRIPT_TIMEOUT_SECONDS`). A repeat runs the script
#: again over the same files, which is safe.
SANDBOX_TOOL_ACTIVITY = ActivityConfig(
    start_to_close_timeout=timedelta(minutes=6),
    retry_policy=RetryPolicy(maximum_attempts=2),
)
#: One built-in the harness answers: rendering a document and saving it through the platform,
#: or writing a handoff. Bounded like a platform tool call; unbounded, a save the platform
#: kept refusing held the mission Running for hours (RUN-88042, 59 attempts).
HARNESS_TOOL_ACTIVITY = ActivityConfig(
    start_to_close_timeout=timedelta(minutes=5),
    retry_policy=RetryPolicy(maximum_attempts=3),
)
#: Loading a skill or reading one of its files: at most a 5 MB package from the object
#: store. A read is safe to repeat.
SKILL_TOOL_ACTIVITY = ActivityConfig(
    start_to_close_timeout=timedelta(minutes=2),
    retry_policy=RetryPolicy(maximum_attempts=3),
)
#: Raising an approval or a question, or registering a child mission, with the platform.
#: Bounded like a tool call: the default policy retries for ever, and a refusal would hold
#: the mission open with nothing written back.
PLATFORM_STEP_RETRY = RetryPolicy(maximum_attempts=3)

#: The argument a retried call presents its approval in; the server spends it against the
#: exact call and strips it before validating the arguments (D49, D71).
APPROVAL_ARGUMENT = "__approval"

#: How the platform names a refusal that a person's approval would lift (D32, D58).
APPROVAL_REFUSAL = "approval_required:"

#: Tool tiers that need a person before the call runs. READ is free (D17).
#:
#: The platform's own catalogue is what says which tier a tool is — the agent is told, it
#: does not decide — and the server re-checks on the call regardless (D30).
APPROVAL_TIERS = frozenset({"T2"})


def _model_for(context: ModelResolutionContext[MissionDeps], model_id: str) -> Model | None:
    """Build the model for one run's route, carrying that run's own gateway token.

    Per run rather than cached per route: the token *is* the run's identity to
    agentgateway, which decides from it which models and connectors the run may reach.
    A model cached across runs would carry whichever run's token built it first.
    """
    deps = context.deps
    # Only the run's own route. Returning a model for every id would claim ids this
    # resolver knows nothing about — a model registered on the capability, or one a
    # caller named — and answer them with a gateway route that does not exist.
    if model_id not in ("", ROUTE_MODEL_ID, deps.route):
        return None
    provider = OpenAIProvider(
        base_url=deps.gateway_url,
        api_key=deps.mcp_token or "anonymous",
    )
    return OpenAIChatModel(deps.route, provider=provider)


def _platform_tools(context: RunContext[MissionDeps]) -> MCPToolset | None:
    """The platform's tools, over MCP, as this run.

    The standard at this edge, spoken by the library's own client rather than by a
    transport of ours (rule 4). The bearer is the run's model token, so every call the
    model makes is checked against the person the run acts for.

    A run granted no platform tool opens no connection: there is nothing behind it that
    the run may call, and a session established to list tools it cannot use is a round
    trip and a held connection spent on an empty answer.
    """
    deps = context.deps
    if not set(deps.granted_tools) - _ANSWERED_HERE:
        return None
    return MCPToolset(
        StreamableHttpTransport(
            url=deps.mcp_url,
            headers={"authorization": f"Bearer {deps.mcp_token}"},
        ),
        id=PLATFORM_TOOLSET_ID,
    )


#: Granted names the runtime answers itself rather than the platform MCP server.
_ANSWERED_HERE = frozenset({DELEGATE_TOOL, ASK_PERSON_TOOL, *HARNESS_TOOLS, *SANDBOX_TOOLS})


def _granted(context: RunContext[MissionDeps], tool: ToolDefinition) -> bool:
    """Offer the model exactly what its token grants.

    Not a security boundary — the server refuses an ungranted call whatever the model was
    shown (D30). It is what stops the model spending a step, and a turn of its attention,
    learning something the platform already knew.
    """
    return tool.name in set(context.deps.granted_tools)


def _sandbox_offered(context: RunContext[MissionDeps], tool: ToolDefinition) -> bool:
    """The sandbox tools, when granted and a granted skill ships a script to run."""
    return offered(context.deps) and _granted(context, tool)


def _defer_writes(
    context: RunContext[MissionDeps], tools: list[ToolDefinition]
) -> list[ToolDefinition]:
    """Hide every tool above READ until the model searches for it (D137).

    A Platform Assistant run is granted some eighty tools, and every schema went out on
    every model request. Reads stay visible because most turns start with one; the
    library's `search_tools` reveals a write by name when the model needs it.
    """
    tiers = context.deps.tool_tiers
    return [
        tool if tiers.get(tool.name, "T0") == "T0" else replace(tool, defer_loading=True)
        for tool in tools
    ]


def _needs_approval(
    context: RunContext[MissionDeps], tool: ToolDefinition, arguments: dict[str, object]
) -> bool:
    """Whether this call pauses for a person.

    The tier comes from the platform's catalogue, never from the agent's configuration,
    so an agent cannot lower it (specification 7.4.5).

    This decides the *pause*. It does not decide the permission: the server escalates per
    field on the payload (D58) and refuses an APPROVE-class call with no bound approval
    (D49), whatever this returns. A run that somehow skipped the pause still cannot write.
    """
    return context.deps.tool_tiers.get(tool.name, "T0") in APPROVAL_TIERS


def _contract_output(
    context: RunContext[MissionDeps], output: str | DeferredToolRequests
) -> str | DeferredToolRequests:
    """D373: a final answer that misses its step's contract goes back to the model to fix.

    Only a finished answer of a run with an output schema is checked; a pause is not an
    answer. The answer kept is the JSON it carries, without the prose around it. On the
    last retry the answer is kept as it is, so `_finished` fails the run with the
    contract's own reason rather than the library's "exceeded retries". Pure, so it is safe
    where it runs: inside the workflow.
    """
    schema = context.deps.output_schema
    if schema is None or not isinstance(output, str) or context.partial_output:
        return output
    answer = json_in(output)
    checked = step_contract(answer, output_schema=schema)
    if checked.passed:
        return answer
    if context.retry >= context.max_retries:
        return output
    raise ModelRetry(
        f"{checked.feedback}. Finish with one JSON object that matches this schema, not the "
        f"schema itself: {json.dumps(schema)}"
    )


def _skills_offered(context: RunContext[MissionDeps], tool: ToolDefinition) -> bool:
    """`skill_load` and `skill_file_read`, when the run has a skill: pinning is the grant."""
    return skills_offered(context.deps)


def _instructions(context: RunContext[MissionDeps]) -> str:
    """The run's instructions, followed by the granted skills' names and descriptions.

    A skill's body reaches the model when it calls `skill_load` (D377): sending every body
    on every model call sent an agent holding fifteen skills 280 KB of them each time. The
    library's
    `load_capability` cannot do it under Temporal (D127). The list comes from deps read
    before the mission started (`skills.py`), so this is deterministic on replay.
    """
    deps = context.deps
    parts = [
        deps.instructions,
        skills_index(deps),
        instructions_note(deps),
        deps.frame,
    ]
    return "\n\n".join(part for part in parts if part)


class _ServerApproval(WrapperToolset[MissionDeps]):
    """Turn the server's `approval_required` refusal into the library's approval pause.

    The catalogue tier decides most pauses before the call (`_needs_approval`). A T1 edit
    the server escalates because of a field it touches (D58) is only known when the
    server refuses it, having written nothing (D49); raising the library's
    `ApprovalRequired` defers that call like a T2 one, so a person decides and it runs
    again with the approval spent on it (spec section 5). An approved call refused again
    is the model's to read, not another pause.
    """

    async def call_tool(
        self,
        name: str,
        tool_args: dict[str, Any],
        ctx: RunContext[MissionDeps],
        tool: ToolsetTool[MissionDeps],
    ) -> Any:
        """Call the wrapped tool; an `approval_required` refusal raises `ApprovalRequired`.

        Any other refusal, and any refusal of a call already approved, propagates unchanged.
        """
        try:
            return await super().call_tool(name, tool_args, ctx, tool)
        except ModelRetry as refusal:
            if ctx.tool_call_approved or APPROVAL_REFUSAL not in str(refusal):
                raise
            # The server's reason travels with the pause, so the approver reads why this
            # call needs them rather than a generic line.
            raise ApprovalRequired(metadata={"reason": str(refusal)}) from refusal


def _workflow_toolset(context: RunContext[MissionDeps]) -> ExternalToolset[MissionDeps] | None:
    """`delegate_to_agent` and `ask_person`, each offered only to a run granted it.

    External, so the call comes back unexecuted and the mission workflow answers it:
    starting the child, or waiting for the person. Under Temporal only the workflow may
    start a child workflow, so delegation is a child mission rather than the harness's
    `SubAgents` (D08, D142).

    The agents `delegate_to_agent` may name are not listed here: the platform decides
    whether the target is reachable when the child is registered, where it also bounds the
    child's grant by the parent's row and refuses a delegation past the fan-out and depth
    limits (D15, D36, D103). A list in the prompt would be a second answer to the same question.
    """
    granted = set(context.deps.granted_tools)
    offered = [tool for tool in _WORKFLOW_TOOLS if tool.name in granted]
    return ExternalToolset(offered, id=DELEGATION_TOOLSET_ID) if offered else None


#: What the mission workflow answers itself, in the order the model is offered them.
_WORKFLOW_TOOLS = [
    ToolDefinition(
        name=DELEGATE_TOOL,
        description=(
            "Hand a self-contained piece of work to another agent by its code. "
            "It runs as its own mission with your permissions and a subset of "
            "your tools, and you get its answer back. Use it when the work needs "
            "an agent configured for something you are not."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "agent_code": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["agent_code", "description"],
        },
    ),
    ToolDefinition(
        name=ASK_PERSON_TOOL,
        description=(
            "Ask the person you are working for a question, when you cannot go on "
            "without their answer. The mission waits for them to reply, and you get the "
            "answer back. Use this rather than asking in your reply, which gives the "
            "person nothing to click: offer the choices in `options` when the answer is "
            "one of a few, and list the values you need in `fields` when you need several "
            "(each with a default where there is a sensible one), so the person fills in a "
            "form rather than typing them all on one line."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}},
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "label": {"type": "string"},
                            "options": {"type": "array", "items": {"type": "string"}},
                            "default": {"type": "string"},
                        },
                        "required": ["name"],
                    },
                },
            },
            "required": ["question"],
        },
    ),
]


def build_agent(
    models: Mapping[str, Model] | None = None,
) -> Agent[MissionDeps, str | DeferredToolRequests]:
    """The platform's one agent.

    Built at import so the Temporal worker can register its activities before any run
    exists — which is the constraint that rules out creating an agent per user-defined
    agent, and the reason every difference between agents is deps rather than code.

    `models` registers model instances a run may select by key. A `Model` cannot cross
    the activity boundary, so anything `agent.run(model=...)` might name has to be
    registered at build time; ordinary runs do not use it, because their model is built
    on the worker from the route by `ResolveModelId`.
    """
    platform = DynamicToolset(_platform_tools, id=PLATFORM_TOOLSET_ID)
    granted = FilteredToolset(platform, _granted).prepared(_defer_writes)
    gated = ApprovalRequiredToolset(_ServerApproval(granted), _needs_approval)
    delegation = DynamicToolset(_workflow_toolset, id=DELEGATION_TOOLSET_ID)
    harness = FilteredToolset(harness_toolset(), _granted).prepared(_defer_writes)
    sandbox = FilteredToolset(sandbox_toolset(), _sandbox_offered)
    skills = FilteredToolset(skills_toolset(), _skills_offered)

    mission: Agent[MissionDeps, str | DeferredToolRequests] = Agent(
        # Resolved per run by `ResolveModelId`; this is the id that reaches it.
        ROUTE_MODEL_ID,
        # One stable name for the one agent. Temporal identifies the agent's durable
        # activities by it, so it has to be fixed rather than per configured agent —
        # which is the same constraint that makes every agent one object (D64).
        name="awp-mission",
        deps_type=MissionDeps,
        # A paused call — an approval, a question, a delegation — ends the run with the
        # calls it is waiting on, which the workflow answers and resumes from (D89).
        output_type=[str, DeferredToolRequests],
        instructions=_instructions,
        toolsets=[gated, delegation, harness, sandbox, skills],
        # A refused or malformed call is the model's to correct; one retry turned a single
        # stale `expectedVersion` into a failed mission, and three failed a run that was
        # still finding a skill's file (D380). An answer that misses its step's contract
        # gets two chances to be corrected (D373).
        retries={"tools": TOOL_RETRIES, "output": 2},
        capabilities=[
            ResolveModelId(_model_for),
            ToolSearch(max_results=8),
            # D379: a tool that answered a failure three times in a row is refused, and the
            # model told to stop and report, rather than retried until the budget runs out.
            RepeatedFailureGuard(),
            # Compaction only. The PII guardrails belong here by design rule 2, and do
            # not work here in practice: composed onto the durable agent they hang the
            # run, because the detector's work happens inside the Temporal workflow,
            # where a workflow may not do I/O and must stay deterministic. Masking
            # therefore stays in the model-request activity, which is where the text
            # actually crosses the boundary (D110, backlog #36).
            *capabilities.compaction_capabilities(),
            # The run, each model call with its prompt and answer, and each tool, as spans
            # in Phoenix. It opens spans in the workflow and wraps nothing, so it is safe
            # beside `TemporalDurability`; `tracing.provider` keeps them replay-safe.
            capabilities.instrumentation(),
            # The panel reads the run's AG-UI stream, so a mission that answers without
            # publishing leaves it saying "Thinking…" for ever (D98). The handler runs
            # inside the model-request activity, where I/O is allowed.
            TemporalDurability(
                models=dict(models) if models else None,
                event_stream_handler=publish_to_panel,
                # Bounded: the library's default retries an activity for ever, so a route
                # whose model is gone retried a 404 until somebody noticed.
                model_activity_config=MODEL_ACTIVITY,
                toolset_activity_config={
                    PLATFORM_TOOLSET_ID: PLATFORM_TOOL_ACTIVITY,
                    SANDBOX_TOOLSET_ID: SANDBOX_TOOL_ACTIVITY,
                    HARNESS_TOOLSET_ID: HARNESS_TOOL_ACTIVITY,
                    SKILLS_TOOLSET_ID: SKILL_TOOL_ACTIVITY,
                },
            ),
        ],
    )
    mission.output_validator(_contract_output)
    return mission


#: The agent the worker registers and every mission runs.
agent = build_agent()


class MissionCancelledError(Exception):
    """Raised inside the mission when a person stops it (D67)."""


@dataclass
class MissionStep:
    """One thing the mission waited on or handed off, as the `steps` query reports it.

    The model's own steps are the library's and reach the platform through the run's
    stream; these are the platform's half: approvals, questions and delegations.
    """

    kind: str
    name: str
    outcome: str
    at: str


#: How each context type is named to the model.
_CONTEXT_NAMES = {
    "Room": "the discussion room",
    "WorkItem": "the work item",
    "Request": "the request",
    "Deployment": "the deployment",
}


#: The languages a person reads the console in (`Actor.locale`).
_LANGUAGES = {"en": "English", "ar": "Arabic"}


def _frame_of(run: RunInput) -> str:
    """What the mission is about, in the words the model reads first.

    The record's key is what the platform tools take, so without it an agent assigned a
    work item cannot name the item it is reviewing, and one in a room cannot read its own
    room. The conversation is what a person in a room is replying to. The person's language
    is what the replies and any file are written in (D162): told nothing, an agent wrote a
    document in both languages for somebody who reads one.
    """
    language = _LANGUAGES[run.actor.locale]
    lines: list[str] = [
        f"{run.actor.display_name or 'The person you work for'} reads {language}. Write your "
        f"replies and any file you make in {language}, unless they ask for another language "
        "or for both. Fields the platform keeps in both languages still get both."
    ]
    named = _CONTEXT_NAMES.get(run.context_type)
    if named:
        lines.append(f"You are working on {named} `{run.context_id}`.")
    elif run.context_type == "Console":
        lines.append(f"The person is on the page `{run.context_id}`.")
    if run.task.acceptance_criteria:
        lines.append("Done means:")
        lines.extend(f"- {criterion}" for criterion in run.task.acceptance_criteria)
    if run.conversation:
        lines.append("The conversation so far, oldest first:")
        lines.extend(
            f"- {message.author or message.role}: {message.text}" for message in run.conversation
        )
    return "\n".join(lines)


def _instructions_of(run: RunInput) -> str:
    """The agent's instructions and the organisation's rules, as one block."""
    parts = [part for part in (run.instructions, run.organisation_rules) if part]
    return "\n\n".join(parts)


def mission_deps(run: RunInput, skills: Sequence[SkillDoc] = ()) -> MissionDeps:
    """One run's configuration, from the payload the platform already sends.

    A translation, not a second contract: every value here is one the web app resolved
    when it assembled the run. The tiers come from the tool specs it sent, which are the
    platform's own catalogue — so an agent cannot lower the tier of a tool by describing
    it differently (specification 7.4.5).
    """
    return MissionDeps(
        run_id=run.run_id,
        person_id=run.actor.person_id,
        mcp_token=run.actor.mcp_token,
        harness_token=run.actor.plumbing_token,
        route=run.route,
        instructions=_instructions_of(run),
        frame=_frame_of(run),
        granted_tools=[model_tool_name(name) for name in run.granted_tools],
        tool_tiers={model_tool_name(tool.name): str(tool.tier) for tool in run.tools},
        output_schema=run.task.output_schema,
        context_type=run.context_type,
        context_key=run.context_id,
        skills=list(skills),
        max_steps=run.budget.max_steps,
        max_tool_calls=run.budget.max_tool_calls,
        # Read here, in the API process. A workflow may not read the environment.
        mcp_url=settings().platform_mcp_url,
        gateway_url=gateway_client.openai_base_url(),
        sandbox_url=settings().sandbox_manager_url,
    )


def effort_limits(deps: MissionDeps) -> UsageLimits:
    """The mission's model-request and tool-call limits; None is no limit (D389).

    Always passed, never left to the library: its own default stops a run at 50 requests,
    and a run is meant to carry on until it finishes.
    """
    return UsageLimits(request_limit=deps.max_steps, tool_calls_limit=deps.max_tool_calls)


@dataclass
class MissionOutcome:
    """What a mission was, decided in code rather than asserted by the model (D40).

    The status is the platform's judgement of the run; the output is what the agent
    produced. Keeping them together means a caller cannot read one without the other and
    report a blocked or cancelled mission as a finished one.
    """

    status: RunStatus
    output: str


@dataclass
class Mission:
    """What starts one mission: the goal, and the configuration to pursue it with."""

    prompt: str
    deps: MissionDeps
    #: What the run was asked for, as the platform recorded it. Carried so the outcome
    #: can be written back without the workflow re-deriving anything.
    title: str = ""


def _handoff_in(messages: Sequence[ModelMessage]) -> ContextHandoff | None:
    """The last `write_handoff` the agent made in this mission, if it made one."""
    calls = [
        part
        for message in messages
        for part in message.parts
        if isinstance(part, ToolCallPart) and part.tool_name == WRITE_HANDOFF_TOOL
    ]
    return ContextHandoff.model_validate(calls[-1].args_as_dict()) if calls else None


@workflow.defn(name="MissionWorkflow")
class MissionWorkflow(PydanticAIWorkflow):
    """One mission, durable.

    The loop is `agent.run`: planning, tool calls and compaction are the library's,
    routed through Temporal activities by `TemporalDurability`. What is left for the
    platform is what only the platform knows — the configuration that arrives as deps,
    the approvals a person has to decide, and the outcome that goes back.

    The approval round trip is the one place the two meet. The library pauses by
    returning `DeferredToolRequests`; the platform turns each paused call into a bound
    approval a person decides (D20); the library resumes from `DeferredToolResults`.
    Neither half knows how the other works, which is the point: the harness cannot
    approve anything, and the platform does not have to understand the agent's state.
    """

    # ClassVar annotation is rejected; the list is read-only in practice.
    __pydantic_ai_agents__: Sequence[AbstractAgent[Any, Any]] = [agent]
    #: The agent each run uses, and a model to run it with instead of the route's. Here so
    #: a test runs this workflow, unchanged, on a model registered with its own agent.
    mission_agent: Agent[MissionDeps, str | DeferredToolRequests] = agent
    mission_model: Model | None = None

    def __init__(self) -> None:
        """Start with no decisions, answers or messages, status Running and no tokens yet."""
        #: Decisions keyed by the tool call they belong to, as people make them.
        self._decisions: dict[str, bool] = {}
        self._notes: dict[str, str] = {}
        #: The calls a person asked to have changed rather than refused (D285).
        self._changes: set[str] = set()
        self._cancelled = False
        #: Answers keyed by the question they belong to, as people give them (D125).
        self._answers: dict[str, str] = {}
        self._status = RunStatus.RUNNING
        self._steps: list[MissionStep] = []
        #: The conversation so far and what it has used, carried across each pause so the
        #: resumed run continues it and the effort limits count the whole mission.
        self._messages: list[ModelMessage] = []
        self._usage = RunUsage()
        #: What the agent recorded with `write_handoff`, when it could not finish (D42).
        self._handoff: ContextHandoff | None = None
        #: The mission's deps, whose tokens a refresh replaces in place, and when the tokens
        #: it holds were minted (D82).
        self._deps: MissionDeps | None = None
        self._minted_at: datetime | None = None

    @workflow.signal(name="approve")
    def approve(self, decision: ApprovalDecision) -> None:
        """A person's decision on one paused call."""
        self._decisions[decision.call_id] = decision.approved
        self._notes[decision.call_id] = decision.note
        if decision.changes_requested:
            self._changes.add(decision.call_id)
        self._renew(decision.mcp_token, decision.harness_token)

    @workflow.signal(name="cancel")
    def cancel(self) -> None:
        """Stop the mission at its next safe point (D67)."""
        self._cancelled = True

    @workflow.signal(name="answer")
    def answer(self, reply: QuestionAnswer) -> None:
        """A person's answer to a question the mission asked (D125)."""
        self._answers[reply.question_id] = reply.answer
        self._renew(reply.mcp_token, reply.harness_token)

    def _renew(self, mcp_token: str, harness_token: str) -> None:
        """Put fresh tokens in the mission's deps, which every later activity is given (D82)."""
        if self._deps is None or not (mcp_token and harness_token):
            return
        self._deps.mcp_token = mcp_token
        self._deps.harness_token = harness_token
        self._minted_at = workflow.now()

    async def _keep_fresh(self, deps: MissionDeps) -> None:
        """Replace the run's tokens before they expire while the agent works (D82).

        The platform re-derives the grant as it mints them (D50) and refuses a run that has
        ended. A refresh that fails is not a reason to stop the mission: it is tried again
        each minute while the current tokens still work, and then the run carries on and
        the next call that needs a credential fails with its own reason.
        """
        while self._minted_at is not None:
            due = self._minted_at + REFRESH_AFTER - workflow.now()
            if due > timedelta(0):
                await workflow.sleep(due)
            try:
                fresh = await workflow.execute_activity(
                    refresh_credentials,
                    RefreshRequest(
                        run_id=deps.run_id,
                        actor=Actor(
                            person_id=deps.person_id,
                            mcp_token=deps.mcp_token,
                            harness_token=deps.harness_token,
                        ),
                    ),
                    start_to_close_timeout=APPROVAL_ACTIVITY_TIMEOUT,
                    retry_policy=PLATFORM_STEP_RETRY,
                )
            except Exception:  # noqa: BLE001 - as an empty refresh
                workflow.logger.warning("the credentials of %s were not refreshed", deps.run_id)
            else:
                if fresh.usable():
                    self._renew(fresh.mcp_token, fresh.harness_token)
                    continue
            if workflow.now() >= self._minted_at + TOKEN_LIFETIME:
                return
            await workflow.sleep(timedelta(minutes=1))

    @workflow.query(name="status")
    def status(self) -> RunStatus:
        """Where the mission is: running, waiting on a person, or how it ended."""
        return self._status

    @workflow.query(name="steps")
    def steps(self) -> list[MissionStep]:
        """The approvals, questions and delegations so far, in order."""
        return list(self._steps)

    def _step(self, kind: str, name: str, outcome: str) -> None:
        self._steps.append(
            MissionStep(kind=kind, name=name, outcome=outcome, at=workflow.now().isoformat())
        )

    @workflow.run
    async def run(self, mission: Mission) -> MissionOutcome:
        """Pursue the mission, write its outcome back to the platform, and return it.

        A failure to record the outcome is logged and does not change what is returned. A
        mission that used a sandbox has it released before returning.
        """
        self._deps = mission.deps
        self._minted_at = workflow.now()
        outcome = await self._pursue(mission)
        self._status = outcome.status
        # The platform has to learn how this ended, or the run row says Running for ever
        # and the Runs screen shows a mission nobody can act on. One write path: the
        # same `finalize` the old loop used.
        #
        # Retried, and then given up on rather than raised. A mission that did the work
        # and could not file the paperwork has still done the work, and turning that
        # into a failed workflow throws the answer away to report a bookkeeping problem.
        # The stuck row is visible on its own; the lost answer would not be.
        try:
            await self._record_outcome(mission, outcome)
        except Exception:  # noqa: BLE001 - the answer outlives the bookkeeping
            workflow.logger.exception(
                "the outcome of %s could not be recorded", mission.deps.run_id
            )
        if uses_sandbox(mission.deps):
            await self._release_sandbox(mission.deps)
        return outcome

    async def _release_sandbox(self, deps: MissionDeps) -> None:
        """Delete the run's sandbox now rather than at its deadline. Best effort: the
        deadline still ends it, and a failure here must not change the outcome."""
        try:
            await workflow.execute_activity(
                release_sandbox,
                SandboxRelease(run_id=deps.run_id, sandbox_url=deps.sandbox_url),
                start_to_close_timeout=APPROVAL_ACTIVITY_TIMEOUT,
                retry_policy=PLATFORM_STEP_RETRY,
            )
        except Exception:  # noqa: BLE001 - the deadline releases it regardless
            workflow.logger.warning("the sandbox of %s was not released", deps.run_id)

    async def _record_outcome(self, mission: Mission, outcome: MissionOutcome) -> None:
        """Write the mission's outcome back to the platform."""
        await workflow.execute_activity(
            finalize,
            FinalizeInput(
                run_id=mission.deps.run_id,
                actor=Actor(
                    person_id=mission.deps.person_id,
                    mcp_token=mission.deps.mcp_token,
                    harness_token=mission.deps.harness_token,
                ),
                route=mission.deps.route,
                status=outcome.status,
                task=TaskFrame(title=mission.title or mission.prompt[:120]),
                output=outcome.output,
                # What the handoff is written from when the agent wrote none: the mission's
                # own account of what it did, not an empty transcript a model would guess at.
                transcript=outcome.output,
                tokens_in=self._usage.input_tokens,
                tokens_out=self._usage.output_tokens,
                tool_call_count=self._usage.tool_calls,
                # The agent's own handoff, when it wrote one; otherwise `finalize` writes it.
                handoff=self._handoff,
                context_type=mission.deps.context_type,
                steps=timeline(
                    self._messages,
                    status=str(outcome.status),
                    output=outcome.output,
                    ended=workflow.now(),
                ),
            ),
            start_to_close_timeout=APPROVAL_ACTIVITY_TIMEOUT,
            retry_policy=FINALIZE_RETRY,
        )

    async def _pursue(self, mission: Mission) -> MissionOutcome:
        """Run the agent, answering each pause, until it finishes or stops; return the outcome.

        A cancel is CANCELLED, an exhausted effort limit BUDGET_EXCEEDED, and any other
        failure, including one while answering a pause, FAILED. A finished run is judged by
        `_finished`. More than `MAX_APPROVAL_ROUNDS` pauses is FAILED.
        """
        results: DeferredToolResults | None = None
        # Each turn of this loop is one pause for a person, not one model step: the
        # model steps happen inside `agent.run`. A mission that needs no approval goes
        # round once.
        for _ in range(MAX_APPROVAL_ROUNDS):
            self._status = RunStatus.RUNNING
            try:
                run_result = await self._run_until_cancelled(mission, results)
            except MissionCancelledError:
                # D67: a stop button that leaves work running is not a stop button. The
                # in-flight model or tool call is cancelled with the task, and nothing
                # after this point calls a tool.
                return MissionOutcome(
                    status=RunStatus.CANCELLED,
                    output="Stopped by the person who asked for it.",
                )
            except UsageLimitExceeded as limit:
                # Running out of steps is not success. A mission that stopped because it
                # exhausted its effort has not done the work (D93).
                return MissionOutcome(status=RunStatus.BUDGET_EXCEEDED, output=str(limit))
            except Exception as problem:  # noqa: BLE001 - any failure is the same outcome
                return MissionOutcome(status=RunStatus.FAILED, output=str(problem))

            self._messages = run_result.all_messages()
            self._usage = run_result.usage
            output = run_result.output
            if isinstance(output, DeferredToolRequests):
                if self._cancelled:
                    return MissionOutcome(
                        status=RunStatus.CANCELLED,
                        output="Stopped before the approvals it was waiting on.",
                    )
                try:
                    results = await self._decide(mission, output)
                    await self._delegate(mission, output, results)
                    await self._ask(mission, output, results)
                except Exception as problem:  # noqa: BLE001 - the same outcome as a failed run (D102)
                    return MissionOutcome(status=RunStatus.FAILED, output=str(problem))
                continue

            if self._cancelled:
                return MissionOutcome(status=RunStatus.CANCELLED, output=str(output))
            self._handoff = _handoff_in(self._messages)
            return self._finished(mission, str(output))

        return MissionOutcome(
            status=RunStatus.FAILED,
            output="The mission asked for more rounds of approval than it is allowed.",
        )

    async def _delegate(
        self, mission: Mission, paused: DeferredToolRequests, results: DeferredToolResults
    ) -> None:
        """Answer each `delegate_to_agent` call by running the child as its own mission.

        A child mission workflow rather than a sub-agent, because Temporal needs agents
        and toolsets to exist at worker start and a configured agent is created at
        runtime (D08). The child is a real run: the platform gives it its own row, its
        own tokens and a grant bounded by this run's (D36), and refuses it outright past
        the fan-out limits (D103).

        A refusal comes back as the tool's result, not as a failure: the model reads why
        and does the work itself, rather than losing everything it has already finished.
        """
        for call in paused.calls:
            if call.tool_name != DELEGATE_TOOL:
                continue
            arguments = call.args_as_dict()
            registration: ChildMission = await workflow.execute_activity(
                register_child_mission,
                ChildMissionWanted(
                    parent_run_id=mission.deps.run_id,
                    child_run_id=str(workflow.uuid4()),
                    agent_code=str(arguments.get("agent_code", "")),
                    harness_token=mission.deps.harness_token,
                ),
                start_to_close_timeout=APPROVAL_ACTIVITY_TIMEOUT,
                retry_policy=PLATFORM_STEP_RETRY,
            )
            if registration.deps is None:
                results.calls[call.tool_call_id] = (
                    registration.error or "that delegation was refused"
                )
                continue
            child_deps = registration.deps

            child = await workflow.execute_child_workflow(
                MissionWorkflow.run,
                Mission(
                    prompt=str(arguments.get("description", arguments.get("title", ""))),
                    deps=child_deps,
                ),
                id=f"run-{child_deps.run_id}",
            )
            # The child's status travels with its answer: a parent told only the text
            # would read a blocked or cancelled child as a finished one.
            results.calls[call.tool_call_id] = f"[{child.status}] {child.output}"
            self._step("Delegation", str(arguments.get("agent_code", "")), str(child.status))

    async def _run_until_cancelled(
        self, mission: Mission, results: DeferredToolResults | None
    ) -> AgentRunResult[Any]:
        """Run the agent, stopping the moment somebody cancels the mission.

        Racing the run against the cancel signal, rather than checking a flag between
        steps: a model call can take a minute and a tool call longer, and a stop that
        waits for the current one to finish is not what the person pressing it means.
        Cancelling the task propagates into the activity the run is waiting on.
        """
        deps = mission.deps
        # The task copies the context it is created in, so the agent's spans join the run's
        # trace without the context staying attached to the workflow afterwards.
        with tracing.within_run(deps.run_id):
            running = asyncio.create_task(
                self.mission_agent.run(
                    # A resumed run continues its own history; the prompt is already in it.
                    None if results else mission.prompt,
                    deps=deps,
                    model=self.mission_model,
                    message_history=self._messages if results else None,
                    deferred_tool_results=results,
                    usage=self._usage if results else None,
                    usage_limits=effort_limits(deps),
                )
            )
        stopping = asyncio.create_task(workflow.wait_condition(lambda: self._cancelled))
        # Behind a patch: a mission already running when this was deployed replays without it.
        refreshing = (
            asyncio.create_task(self._keep_fresh(deps))
            if workflow.patched("refresh-run-credentials")
            else None
        )
        try:
            await workflow.wait([running, stopping], return_when=asyncio.FIRST_COMPLETED)
        finally:
            stopping.cancel()
            if refreshing is not None:
                refreshing.cancel()
        if self._cancelled:
            running.cancel()
            raise MissionCancelledError
        return await running

    def _finished(self, mission: Mission, output: str) -> MissionOutcome:
        """Decide what a finished run actually was, in code (D40).

        A model will say it is done when it has given up, so the status is not taken
        from what it wrote. What the platform can check is that the run produced a final
        answer at all, and whether that answer is a handoff rather than a result.

        A `write_handoff` is the agent saying it cannot finish and naming what stopped
        it; that is BLOCKED, which lands in a human queue rather than a resumable one
        (D42). Everything else with an answer is SUCCEEDED; an empty answer is not a
        success, because nothing was delivered.
        """
        if not output.strip():
            return MissionOutcome(
                status=RunStatus.FAILED,
                output="The mission ended without an answer.",
            )
        if self._handoff is not None:
            return MissionOutcome(status=RunStatus.BLOCKED, output=output)
        # D41: for a request step the declared contract is the only objective definition
        # of done the platform has, so an output that misses it is not a completed
        # mission whatever the model wrote. A mission with no contract has only the
        # checks above, which is why a step that declares one is the stronger case.
        checked = step_contract(output, output_schema=mission.deps.output_schema)
        if not checked.passed:
            return MissionOutcome(status=RunStatus.FAILED, output=checked.feedback)
        return MissionOutcome(status=RunStatus.SUCCEEDED, output=output)

    async def _decide(self, mission: Mission, paused: DeferredToolRequests) -> DeferredToolResults:
        """Turn each paused call into a bound approval, and wait for the person.

        The approval binds to the exact call — tool, canonical arguments, record version
        — so what runs afterwards is what was agreed to, and the server refuses it
        otherwise (D20, D49). Waiting here rather than in the library is deliberate: the
        decision belongs to a person in the platform's Inbox, and Temporal is what lets
        the mission wait for one without holding a worker.
        """
        decided = DeferredToolResults()
        for call in paused.approvals:
            escalation = paused.metadata.get(call.tool_call_id, {})
            approval_id = await workflow.execute_activity(
                create_approval,
                ApprovalWanted(
                    run_id=mission.deps.run_id,
                    call_id=call.tool_call_id,
                    tool_name=call.tool_name,
                    arguments=call.args_as_dict(),
                    harness_token=mission.deps.harness_token,
                    # A T2 tool by its catalogue tier; anything else paused because the
                    # server escalated it (D58), which is a T1 call with a reason.
                    tier="T2" if mission.deps.tool_tiers.get(call.tool_name) == "T2" else "T1",
                    reason=str(escalation.get("reason", "")),
                ),
                start_to_close_timeout=APPROVAL_ACTIVITY_TIMEOUT,
                retry_policy=PLATFORM_STEP_RETRY,
            )
            self._status = RunStatus.WAITING
            try:
                await workflow.wait_condition(
                    lambda call_id=call.tool_call_id: (  # type: ignore[misc]
                        call_id in self._decisions or self._cancelled
                    ),
                    timeout=APPROVAL_TIMEOUT,
                )
            except TimeoutError:
                # Nobody decided in time. That is a denial the model is told about, not a
                # failed mission: it carries on without the call (D126).
                decided.approvals[call.tool_call_id] = ToolDenied(
                    "nobody approved this call in time"
                )
                self._step("Approval", call.tool_name, "Expired")
                continue
            approved = self._decisions.get(call.tool_call_id, False)
            self._step("Approval", call.tool_name, "Approved" if approved else "Denied")
            # The retry presents the approval it was given, which the server spends once
            # against these exact arguments; without it the approved call is refused again.
            decided.approvals[call.tool_call_id] = (
                ToolApproved(override_args={**call.args_as_dict(), APPROVAL_ARGUMENT: approval_id})
                if approved and approval_id and not self._cancelled
                else ToolDenied(self._denial(call.tool_call_id, approved=approved))
            )
        return decided

    def _denial(self, call_id: str, *, approved: bool) -> str:
        """Why a paused call does not run, in the words the model reads.

        A rejection is not an expiry: the model has to tell its person that somebody said
        no, and why when they gave a reason, rather than that nobody answered.
        """
        if self._cancelled:
            return "the mission was cancelled before this call ran"
        if approved:
            return "the approval for this call could not be recorded, so it did not run"
        note = self._notes.get(call_id, "").strip()
        if call_id in self._changes:
            changes = "a person asked for changes to this call before it runs"
            return f"{changes}: {note}" if note else changes
        return f"a person rejected this call: {note}" if note else "a person rejected this call"

    async def _ask(
        self, mission: Mission, paused: DeferredToolRequests, results: DeferredToolResults
    ) -> None:
        """Answer each `ask_person` call with what the person replied (D125).

        The question goes to the person's Inbox through the platform, recorded on the
        harness token, and the mission waits for the `answer` signal the way it waits for
        a decision. What comes back is the tool's result, so the model reads the answer,
        or reads that none came, and carries on either way.
        """
        for call in paused.calls:
            if call.tool_name != ASK_PERSON_TOOL:
                continue
            arguments = call.args_as_dict()
            question = str(arguments.get("question", ""))
            question_id = await workflow.execute_activity(
                create_question,
                QuestionWanted(
                    run_id=mission.deps.run_id,
                    question=question,
                    options=[str(option) for option in arguments.get("options") or []],
                    fields=[
                        QuestionField.model_validate(field)
                        for field in arguments.get("fields") or []
                        if isinstance(field, dict) and field.get("name")
                    ],
                    harness_token=mission.deps.harness_token,
                ),
                start_to_close_timeout=APPROVAL_ACTIVITY_TIMEOUT,
                retry_policy=PLATFORM_STEP_RETRY,
            )
            if not question_id:
                results.calls[call.tool_call_id] = "the platform did not record the question"
                self._step("Question", question, "Refused")
                continue
            self._status = RunStatus.WAITING

            def answered_or_stopped(asked: str = question_id) -> bool:
                """Whether this question has an answer or the mission was cancelled."""
                return asked in self._answers or self._cancelled

            try:
                await workflow.wait_condition(answered_or_stopped, timeout=APPROVAL_TIMEOUT)
            except TimeoutError:
                results.calls[call.tool_call_id] = "nobody answered the question in time"
                self._step("Question", question, "Unanswered")
                continue
            answered = question_id in self._answers
            results.calls[call.tool_call_id] = (
                self._answers[question_id] if answered else "the mission was stopped"
            )
            self._step("Question", question, "Answered" if answered else "Cancelled")
