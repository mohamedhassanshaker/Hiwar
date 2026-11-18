"""The configuration one mission runs with.

Its own module because two things need it and neither may import the other: the workflow
in `runtime.py` builds it, and the delegation activity in `delegation.py` returns
it for a child. A dataclass rather than a protocol — it crosses the Temporal activity
boundary, so it has to serialise.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def model_tool_name(name: str) -> str:
    """A connector tool's name as the platform MCP server lists it (D223).

    The platform names it `<connector>/<tool>`, and model providers refuse a `/` or a `.` in a
    function name, so the server lists `<connector>__<tool>` with `-` written `--` and `.`
    written `-_` in the tool part (D363), and reads it back on a call. The same as
    `modelToolName` in `apps/web/src/features/connectors/tool-name.ts`.
    """
    connector, slash, tool = name.partition("/")
    if not (slash and connector):
        return name
    return f"{connector}__{tool.replace('-', '--').replace('.', '-_')}"


@dataclass
class SkillDoc:
    """One granted Agent Skill, as the harness's loader read it from the bundle or the object
    store."""

    name: str
    description: str
    #: The rendered body the model receives when it loads the skill.
    instructions: str
    #: Where an uploaded skill's files are, `bucket/prefix`; `None` for a bundled one.
    package_ref: str | None = None
    #: The scripts it ships, relative to its folder (`scripts/build.py`). A skill with any
    #: is copied into the run's sandbox, where `skill_script_run` runs them (D209).
    scripts: list[str] = field(default_factory=list)
    #: Every file it ships, relative to its folder (`references/Roles.md`): the files
    #: `skill_file_read` may open (D377).
    files: list[str] = field(default_factory=list)


@dataclass
class MissionDeps:
    """One run's whole configuration, resolved by the platform and sent with the run.

    Everything an agent *is* for the length of one mission. Two runs of the same agent
    differ only in what is here, and two different agents differ only in what is here —
    which is what "one runtime" means in practice (D64).
    """

    run_id: str
    person_id: str
    #: The model token: exactly the tools this run may call (D27). It is the bearer on
    #: every platform MCP request and the gateway credential for every model call.
    mcp_token: str
    #: The route alias, which agentgateway resolves to a provider and a model.
    route: str
    #: The agent's instructions for this run.
    instructions: str = ""
    #: What this mission is about (D130), after the skills so the static text before it
    #: is the same on every run of the agent.
    frame: str = ""
    #: Exactly the tools the token grants, by the name the model sees (`model_tool_name`).
    #: The model is offered these and no others, so it never spends a step on a call the
    #: server would refuse (D37).
    granted_tools: list[str] = field(default_factory=list)
    #: Tool name to tier, from the platform's catalogue. A tool absent here is READ.
    tool_tiers: dict[str, str] = field(default_factory=dict)
    #: The plumbing credential, separate from the model token (D33). Approvals and the
    #: run's own bookkeeping travel on it, so a model that learns a plumbing tool's name
    #: still cannot call it.
    harness_token: str = ""
    #: Where the platform MCP server is, for this deployment.
    #:
    #: Resolved by the API process and carried here rather than read inside the mission:
    #: a Temporal workflow may not touch `os.environ`, and a fallback to settings in the
    #: toolset builder failed the first real run on the cluster with
    #: "Cannot access os.environ.items from inside a workflow".
    mcp_url: str = ""
    #: agentgateway's OpenAI-compatible base, for the same reason.
    gateway_url: str = ""
    #: The sandbox manager, which gives the run a workspace Pod for its skills' scripts.
    sandbox_url: str = ""
    #: The contract this mission's output is checked against before it may be reported
    #: complete (D41). None when there is nothing objective to check — the model's word
    #: is then all there is, which is why a step that declares one is better.
    output_schema: dict[str, Any] | None = None
    #: What the mission is about — `Room`, `WorkItem`, `Request`, `Console` — and that
    #: record's key. A generated document is saved against it.
    context_type: str = ""
    context_key: str = ""
    #: The granted skills, listed by name and description and loaded by the model with
    #: `skill_load` when a task needs one (D88, D377).
    skills: list[SkillDoc] = field(default_factory=list)
    #: The effort limits of D73 across the whole mission: model requests and tool calls.
    #: None is no limit, the default since D389.
    max_steps: int | None = None
    max_tool_calls: int | None = None
