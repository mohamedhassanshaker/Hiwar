"""The payloads the harness passes between the workflow and its activities.

Every model here crosses a Temporal activity boundary, so it stays serialisable through the
Pydantic data converter and holds no client object.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ToolTier(StrEnum):
    """Specification section 5.3: what happens when the agent asks for a tool."""

    T0 = "T0"
    T1 = "T1"
    T2 = "T2"
    T3 = "T3"


class ProfileName(StrEnum):
    """The seven execution profiles of specification section 5.2."""

    CONVERSATIONAL = "conversational"
    TASK = "task"
    PLANNER = "planner"
    REVIEWER = "reviewer"
    TRIAGE = "triage"
    SCRIPTED = "scripted"
    ROUTINE = "routine"


class RunStatus(StrEnum):
    """Data model section 10: the Run status enumeration."""

    QUEUED = "Queued"
    RUNNING = "Running"
    WAITING = "Waiting"
    #: A blocker was recorded through `write_handoff` and a person has to take it
    #: somewhere else (D42). Distinct from WAITING, which is resumable and sits in a
    #: queue somebody watches: a blocked run left in that queue is one nobody acts on.
    BLOCKED = "Blocked"
    SUCCEEDED = "Succeeded"
    FAILED = "Failed"
    CANCELLED = "Cancelled"
    BUDGET_EXCEEDED = "BudgetExceeded"


class StepType(StrEnum):
    """Data model section 10: the RunStep type enumeration."""

    MODEL = "Model"
    TOOL = "Tool"
    APPROVAL = "Approval"
    QUESTION = "Question"
    VERIFY = "Verify"
    HANDOFF = "Handoff"


class ContextKind(StrEnum):
    """The fixed order the run viewer shows as context composition."""

    PLATFORM_RULES = "platform-rules"
    ORGANISATION_RULES = "organisation-rules"
    AGENT_INSTRUCTIONS = "agent-instructions"
    SKILL_INDEX = "skill-index"
    AGENT_INDEX = "agent-index"
    KNOWLEDGE_INDEX = "knowledge-index"
    TOOL_DEFINITIONS = "tool-definitions"
    TASK_FRAME = "task-frame"
    LOADED_SKILLS = "loaded-skills"
    RETRIEVED_KNOWLEDGE = "retrieved-knowledge"
    MEMORY = "memory"
    CONVERSATION = "conversation"
    STEP_GUIDANCE = "step-guidance"


CONTEXT_ORDER: tuple[ContextKind, ...] = (
    ContextKind.PLATFORM_RULES,
    ContextKind.ORGANISATION_RULES,
    ContextKind.AGENT_INSTRUCTIONS,
    ContextKind.SKILL_INDEX,
    ContextKind.AGENT_INDEX,
    ContextKind.KNOWLEDGE_INDEX,
    ContextKind.TOOL_DEFINITIONS,
    ContextKind.TASK_FRAME,
    ContextKind.LOADED_SKILLS,
    ContextKind.RETRIEVED_KNOWLEDGE,
    ContextKind.MEMORY,
    ContextKind.CONVERSATION,
    ContextKind.STEP_GUIDANCE,
)


class StorylineMode(StrEnum):
    """Specification section 5.3: how closely the harness follows a storyline."""

    GUIDED = "Guided"
    STRICT = "Strict"


class ToolSpec(BaseModel):
    """One tool the agent may ask for, with the tier that governs it."""

    name: str
    description: str = ""
    parameters_json_schema: dict[str, Any] = Field(default_factory=lambda: {"type": "object"})
    tier: ToolTier = ToolTier.T0
    server: str = "platform"
    connector_id: str | None = None


class SkillRef(BaseModel):
    """An Agent Skill in the skill index, loaded on demand."""

    id: str
    name: str
    description: str
    path: str
    #: `allowed-tools` from the frontmatter: the tools the skill needs, as `connector/tool`.
    #: Declared, because a skill is prose and what it will reach for cannot be read out of
    #: it. The registry compares this with what an agent may call (`UC-51.2-05`).
    declared_tools: list[str] = Field(default_factory=list)
    #: Where an uploaded skill's files are in the object store, `bucket/prefix`. `None` for a
    #: bundled skill, which the image carries. The platform sends an uploaded skill only
    #: when its version is published and its security scan passed.
    package_ref: str | None = None


class AgentRef(BaseModel):
    """A real agent `delegate_to_agent` may hand part of a task to."""

    code: str
    name: str
    description: str = ""


class KnowledgeRef(BaseModel):
    """A knowledge collection the agent may retrieve from."""

    collection_id: str
    name: str
    mode: Literal["Vector", "Graph", "Hybrid"] = "Hybrid"
    #: The collection's own embedding route (Models & routes). Empty falls back to the
    #: platform default, which exists for local development, not for a real collection.
    embedding_route: str = ""


class MemoryScope(BaseModel):
    """A memory scope the agent may read, and whether it may write to it."""

    #: Specification section 3: memory is scoped to the organisation, a business unit,
    #: an agent or a session, which is what `ai.memory_scope.kind` holds.
    scope: Literal["Organisation", "BusinessUnit", "Agent", "Session"]
    scope_id: str | None = None
    writable: bool = False


class StorylineStep(BaseModel):
    """One step of a storyline; verbatim messages are sent exactly as written."""

    key: str
    prompt_en: str
    prompt_ar: str
    verbatim: bool = False
    collect: list[str] = Field(default_factory=list)


class Storyline(BaseModel):
    """The storyline a scripted or conversational deployment follows."""

    mode: StorylineMode = StorylineMode.GUIDED
    steps: list[StorylineStep] = Field(default_factory=list)


class RunBudget(BaseModel):
    """What bounds one run: delegation depth, never money (D73) or effort (D389).

    `max_steps` and `max_tool_calls` are unset, so a run carries on until it finishes: long
    real work (a request type with a dozen steps) reached them before any runaway did (D389).
    What stops a model that has lost the thread is the repeated-failure guard (D379), Cancel,
    and `agent_hop_limit` on delegation. A platform that sends a number still gets it.

    Cost carries no ceiling at all. It is still estimated and recorded, by
    `pydantic_ai_harness.spend` against the mission's counter (`harness/spend.py`, D85), and
    it is still the thing to look at when a mission is expensive — it is not a gate.
    """

    max_steps: int | None = None
    max_tool_calls: int | None = None
    agent_hop_limit: int = 2


class Actor(BaseModel):
    """Who the run acts for. The platform MCP server applies this person's permissions."""

    person_id: str
    display_name: str = ""
    locale: Literal["en", "ar"] = "en"
    #: What the agent's own tool calls travel on: exactly the tools its configuration
    #: granted.
    mcp_token: str = ""
    #: What the harness's own plumbing travels on — recording an approval, asking a
    #: question, starting a delegated run, finishing one. A separate credential because
    #: the two present identically at the server otherwise, and the model must not be able
    #: to call `run_finish` merely by knowing the name. Falls back to `mcp_token` so a run
    #: assembled by an older platform still works.
    harness_token: str = ""
    #: When these tokens stop being accepted, ISO-8601, as the platform that minted them
    #: said. The run replaces them before this passes (#31); empty means the run was
    #: assembled by a platform that did not say, and the harness only refreshes once it
    #: has been told an expiry.
    expires_at: str = ""

    @property
    def plumbing_token(self) -> str:
        """The credential the harness's own calls use."""
        return self.harness_token or self.mcp_token


class TaskFrame(BaseModel):
    """What the run has to achieve, in the words the context engine renders."""

    title: str
    description: str = ""
    acceptance_criteria: list[str] = Field(default_factory=list)
    plan_items: list[str] = Field(default_factory=list)
    output_schema: dict[str, Any] | None = None


class ConversationMessage(BaseModel):
    """One earlier message in the room, widget or work item the run continues."""

    role: Literal["user", "assistant", "system"]
    author: str = ""
    text: str


class RunInput(BaseModel):
    """Everything AgentRunWorkflow needs, assembled by the web app before the run starts."""

    model_config = ConfigDict(frozen=True)

    run_id: str
    agent_id: str
    agent_version_id: str
    agent_name: str = ""
    profile: ProfileName = ProfileName.TASK
    route: str
    instructions: str = ""
    organisation_rules: str = ""
    trigger: Literal[
        "Mention",
        "Assignment",
        "RequestStep",
        "Schedule",
        "Widget",
        "Manual",
        "Replay",
        "Delegation",
    ] = "Manual"
    #: `Console` is a run bound to a screen rather than a record — the page assistant and
    #: the playground — whose `context_id` is a path, not a row id.
    context_type: Literal["Room", "WorkItem", "Request", "Deployment", "Console"] = (
        "WorkItem"
    )
    context_id: str
    actor: Actor
    task: TaskFrame
    conversation: list[ConversationMessage] = Field(default_factory=list)
    tools: list[ToolSpec] = Field(default_factory=list)
    #: Exactly the platform tools this run's model token grants, as the web app recorded
    #: them on the run row (D35, D37).
    #:
    #: The model is offered only what its token will actually let it call. Without this
    #: the harness advertised a fixed list of built-ins to every run, so an agent not
    #: granted one would be told it existed, call it, and be refused — spending a step
    #: and a turn of the model's attention learning what the platform already knew.
    #:
    #: Empty means nothing is granted, which is the safe reading of a payload that
    #: predates the field: a run whose token grants nothing is refused at the server
    #: anyway, so advertising those tools would only waste its steps.
    granted_tools: list[str] = Field(default_factory=list)
    skills: list[SkillRef] = Field(default_factory=list)
    #: `delegate_to_agent`'s real targets — every agent this person may invoke, other than
    #: this one. Without it the model has nothing to name but a skill id or a guess.
    delegatable_agents: list[AgentRef] = Field(default_factory=list)
    knowledge: list[KnowledgeRef] = Field(default_factory=list)
    memory: list[MemoryScope] = Field(default_factory=list)
    budget: RunBudget = Field(default_factory=RunBudget)
    storyline: Storyline | None = None
    #: The run that delegated this one, empty for a mission a person started (D46).
    #:
    #: A delegated run is a real run with its own id and its own trace, so without this
    #: a mission that delegates three times reads as four unrelated runs: nothing says
    #: which delegation caused which cost, or which child a failure came from.
    parent_run_id: str = ""
    #: The one id the whole delegation tree shares (D44), which the spend counter is keyed
    #: on so the tree's cost is one number (D11). Empty means this run is the mission, which
    #: is what a run a person started is; see `mission`.
    mission_id: str = ""
    hops: int = 0
    replay_of_run_id: str | None = None
    replay_from_step: int | None = None

    @property
    def mission(self) -> str:
        """The mission this run belongs to: its parent's, or itself."""
        return self.mission_id or self.run_id


class ContextBlock(BaseModel):
    """One block of the assembled context, in the order the run viewer displays."""

    kind: ContextKind
    label: str
    content: str
    tokens: int = 0


class AssembledContext(BaseModel):
    """The whole context for one model step, plus the tools offered with it."""

    blocks: list[ContextBlock] = Field(default_factory=list)
    tools: list[ToolSpec] = Field(default_factory=list)
    loaded_skill_ids: list[str] = Field(default_factory=list)
    total_tokens: int = 0

    def system_prompt(self) -> str:
        """The blocks joined in the fixed order, each under its own heading."""
        return "\n\n".join(f"## {block.label}\n{block.content}" for block in self.blocks)


class HookOutcome(BaseModel):
    """What a pre- or post-model hook did, as the run viewer reports it."""

    hook: str
    phase: Literal["pre_model", "post_model"]
    summary: str
    changed: bool = False


class ToolCallRequest(BaseModel):
    """A tool call the model asked for."""

    call_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolCallOutcome(BaseModel):
    """What the harness did with one requested tool call."""

    call_id: str
    tool_name: str
    tier: ToolTier
    decision: Literal["ran", "refused", "needs-confirmation", "needs-approval", "budget-exceeded"]
    result: Any = None
    error: str | None = None


class ModelUsage(BaseModel):
    """Token counts and the estimated cost of one model step."""

    tokens_in: int = 0
    tokens_out: int = 0
    cache_hit_pct: int = 0
    estimated_cost_aed: Decimal = Decimal("0")
    route_used: str = ""


class ModelStepResult(BaseModel):
    """One model step: its text, the tool calls it asked for, and what it cost."""

    text: str = ""
    tool_calls: list[ToolCallRequest] = Field(default_factory=list)
    usage: ModelUsage = Field(default_factory=ModelUsage)
    #: What the whole mission has cost after this step, read back from the spend counter
    #: the delegation tree shares (D85). A total, not this step's share of one, so the
    #: workflow reports it rather than adding anything up.
    mission_cost_aed: Decimal = Decimal("0")
    hooks: list[HookOutcome] = Field(default_factory=list)
    messages_json: str = "[]"
    # The deferred skills the model pulled in during this step, id to body, for the
    # loaded-skills block of the run viewer's context composition.
    loaded_skills: dict[str, str] = Field(default_factory=dict)


class VerifyResult(BaseModel):
    """Stage four: whether the run may finish, and the feedback when it may not."""

    passed: bool
    checks: list[str] = Field(default_factory=list)
    feedback: str = ""


class ContextHandoff(BaseModel):
    """Written at the end of every run, and read by the next one."""

    goal: str = ""
    decisions: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    next_step: str = ""


class RunStepRecord(BaseModel):
    """A summary row for the run viewer timeline."""

    seq: int
    type: StepType
    name: str
    status: str
    result: str = ""
    hooks_applied: list[str] = Field(default_factory=list)
    estimated_cost_aed: Decimal = Decimal("0")
    started_at: datetime
    ended_at: datetime | None = None


class RunResult(BaseModel):
    """What AgentRunWorkflow returns, and what the web app writes to the Run row."""

    run_id: str
    status: RunStatus
    output: str = ""
    handoff: ContextHandoff = Field(default_factory=ContextHandoff)
    steps: list[RunStepRecord] = Field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    tool_call_count: int = 0
    estimated_cost_aed: Decimal = Decimal("0")
    eval_scores: dict[str, float] = Field(default_factory=dict)
    trace_id: str = ""


class RunCredentials(BaseModel):
    """Replacement tokens for a run that is still going (#31).

    A run token lives 30 minutes; a run waiting on a person usually outlives that. Without
    a replacement the approved call fails on an expired signature, and the person who
    approved it sees a broken run rather than their decision taking effect.

    The grant comes with them because it is re-derived, not copied: the current agent
    configuration intersected with the run row's snapshot, so it can shrink and never
    grow (D50). A tool revoked while the run waited is gone when it resumes.
    """

    mcp_token: str = ""
    harness_token: str = ""
    granted_tools: list[str] = Field(default_factory=list)
    #: ISO-8601. When this passes, the tokens are no longer accepted anywhere.
    expires_at: str = ""

    def usable(self) -> bool:
        """True when this actually carries a replacement, rather than being an empty
        field on a signal the platform could not mint for."""
        return bool(self.mcp_token and self.harness_token)


class ApprovalSignal(BaseModel):
    """The Inbox decision that resumes a paused run."""

    call_id: str
    approved: bool
    decided_by: str
    note: str = ""
    #: Fresh credentials, minted by the platform as it sent the decision (#31). Absent on
    #: a signal from an older platform, which the run survives: it refreshes itself.
    mcp_token: str = ""
    harness_token: str = ""
    granted_tools: list[str] = Field(default_factory=list)
    expires_at: str = ""

    def credentials(self) -> RunCredentials:
        """The tokens and grant this decision carried; check `usable()` before applying them."""
        return RunCredentials(
            mcp_token=self.mcp_token,
            harness_token=self.harness_token,
            granted_tools=self.granted_tools,
            expires_at=self.expires_at,
        )


class AnswerSignal(BaseModel):
    """A person's answer to an agent question."""

    question_id: str
    answer: str
    answered_by: str
    #: As on `ApprovalSignal`: a question can wait far longer than a token lives.
    mcp_token: str = ""
    harness_token: str = ""
    granted_tools: list[str] = Field(default_factory=list)
    expires_at: str = ""

    def credentials(self) -> RunCredentials:
        """The tokens and grant this answer carried; check `usable()` before applying them."""
        return RunCredentials(
            mcp_token=self.mcp_token,
            harness_token=self.harness_token,
            granted_tools=self.granted_tools,
            expires_at=self.expires_at,
        )
