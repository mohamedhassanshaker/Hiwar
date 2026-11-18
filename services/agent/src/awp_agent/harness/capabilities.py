"""AWP harness concepts as Pydantic AI v2 capabilities (stack specification 5.4).

A capability bundles instructions, tools and lifecycle hooks into one composable unit. The
harness keeps the loop, the governance and the durability; what a capability provides is the
mechanism underneath:

| AWP concept | v2 mechanism |
| --- | --- |
| Agent Skills, progressive disclosure | one `Capability` per skill with `defer_loading=True` |
| Instrumentation | the `Instrumentation` capability, exported to Phoenix |
| Execution profiles | a set of capabilities and an `end_strategy` per profile |
| PII masking (NFR-15) | `InputGuardrail` / `OutputGuardrail`, see `harness.guardrails` |
| Conversation compaction | `SummarizingCompaction` |

With `defer_loading=True` the model sees only the skill's one-line description in a compact
catalog, and the whole skill arrives when the model decides it needs it. That is the Agent
Skills contract, and it is why a large skill library costs almost no context.
"""

from __future__ import annotations

from typing import Any

from pydantic_ai import Capability, EndStrategy, InstrumentationSettings
from pydantic_ai.capabilities import Instrumentation
from pydantic_ai_harness.compaction import ClearToolResults, SummarizingCompaction

from awp_agent import tracing
from awp_agent.harness import guardrails
from awp_agent.harness.profiles import ExecutionProfile
from awp_agent.harness.skills.loader import fetch_skill_body
from awp_agent.harness.types import SkillRef
from awp_agent.logging import logger

log = logger("awp_agent.harness.capabilities")

# Specification 5.4: v2 runs function tools requested alongside a successful output tool.
# A profile that verifies needs those results, so it finishes gracefully; a conversational
# turn answers as soon as it has an answer.
_END_STRATEGY: dict[bool, EndStrategy] = {True: "graceful", False: "early"}

#: What a run's conversation may cost before the oldest of it becomes one summary, leaving
#: headroom in the model's window for instructions, tools, knowledge and the step itself.
CONVERSATION_TOKEN_BUDGET = 4000

#: How many of the most recent messages survive a compaction verbatim.
KEEP_MESSAGES = 4


#: When old tool results are blanked, and when the history is summarised, in tokens of
#: the whole request (the library counts tools and instructions too). Sized against the
#: smallest window on the routes' fallback chains, 200k, so a fallback model still fits.
CLEAR_TOOL_RESULTS_AT = 60_000
SUMMARISE_AT = 150_000


def compaction_capabilities() -> list[Any]:
    """Compaction for the durable runtime, cheapest first (D137).

    Clearing old tool results costs no model call and runs in the workflow; the summary is
    a model call, so it waits until the history is genuinely large. Both are top-level
    capabilities: a summariser nested in a tiered strategy would call the model from the
    workflow. Separate from `safeguards()` because the PII guardrails cannot be composed
    onto a durable agent (D110).
    """
    return [
        ClearToolResults(max_tokens=CLEAR_TOOL_RESULTS_AT, keep_pairs=6, min_clear_tokens=8_000),
        # The id names recorded operations, so it stays the same across releases.
        SummarizingCompaction(
            max_tokens=SUMMARISE_AT,
            keep_tokens=20_000,
            tool_return_max_chars=2_000,
            id="awp-compaction",
        ),
    ]


def safeguards() -> list[Any]:
    """The capabilities every mission runs with, whatever agent it is (D64).

    Not configuration an agent can turn off: masking and compaction are properties of the
    runtime, so they are composed here once rather than per agent. Each is the library's
    own mechanism — the platform supplies the thresholds and the UAE patterns and nothing
    else.
    """
    return [
        *guardrails.pii_guardrails(),
        # The summary is written by the run's own model, so it costs the run's route and
        # no second credential. `max_tokens` is the trigger, `keep_messages` the tail that
        # survives verbatim.
        SummarizingCompaction(
            max_tokens=CONVERSATION_TOKEN_BUDGET,
            keep_messages=KEEP_MESSAGES,
            id="awp-compaction",
        ),
    ]


def skill_capabilities(skills: list[SkillRef]) -> list[Capability[None]]:
    """One deferred-loading capability per skill attached to the agent version."""
    built: list[Capability[None]] = []
    for skill in skills:
        body = fetch_skill_body(skill)
        if body is None:
            # Neither this image nor object storage has it. The run goes on without it
            # rather than failing: the agent is more than one of its skills.
            log.warning("skill_body_missing", extra={"skill": skill.id})
            continue
        built.append(
            Capability(
                id=skill.id,
                description=f"{skill.name}: {skill.description}",
                instructions=body,
                defer_loading=True,
            )
        )
    return built


def catalog(skills: list[SkillRef]) -> str:
    """What the model sees of the skill library before it loads anything.

    The run viewer shows this as the **skill index** block of the context composition, so
    the harness builds the same text it hands to the capability catalog.
    """
    if not skills:
        return "No skills are attached to this agent."
    return "\n".join(
        f"- `{skill.id}` — {skill.name}: {skill.description}" for skill in skills
    )


def instrumentation() -> Instrumentation:
    """OpenTelemetry on the agent run, exported to Phoenix by the service's tracer."""
    return Instrumentation(
        settings=InstrumentationSettings(
            tracer_provider=tracing.provider(),
            include_content=True,
            # Version 5 carries the aggregated token-usage attributes the budget reads.
            version=5,
        )
    )


def end_strategy(profile: ExecutionProfile) -> EndStrategy:
    """How a run ends when the model asks for tools alongside its answer."""
    return _END_STRATEGY[profile.verify]

