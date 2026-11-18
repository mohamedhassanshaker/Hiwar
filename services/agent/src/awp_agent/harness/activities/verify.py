"""Stage four: the verifier.

Before a run may finish, three things are checked, in increasing cost.

`step_contract` holds the two that are decided in code: the output matches the schema the
step declared, and every plan item is closed (D40, D41). It is a pure function with no
I/O, so the generic runtime can call it inside the mission workflow without an activity,
and the hand-rolled loop calls it through `verify` below. A model will say it is finished
when it has given up, so the objective contract is never put to a model.

The third check — whether the output covers the task's acceptance criteria — is the only
one that needs a judgement. The harness offers `trajectory_judge` and `tool_call_judge`,
which score how a run *behaved*; neither judges a finished output against criteria written
in prose, so this stays a model call of ours (design rule 2, D96).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import jsonschema
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from temporalio import activity

from awp_agent.clients import gateway_client
from awp_agent.harness.types import TaskFrame, VerifyResult

VERIFIER_INSTRUCTIONS = """\
You check another agent's work. For each acceptance criterion and each plan item, say whether
the output covers it. Be exact and be brief. If anything is missing, say precisely what to add
or change. Never rewrite the work yourself.
"""


class VerifyInput(BaseModel):
    """The output to verify, against the task it was produced for."""

    route: str
    task: TaskFrame
    output: str
    completed_plan_items: list[str] = Field(default_factory=list)


class _Judgement(BaseModel):
    """The verifier's structured answer."""

    passed: bool
    checks: list[str] = Field(default_factory=list)
    feedback: str = ""


def json_in(output: str) -> str:
    """The JSON an answer delivers: the whole answer, or else the last JSON object in it.

    D373: a model often says what it did before the object, or fences it as ```json. The
    object is the answer either way; prose with no object is returned as it is, to fail.
    """
    try:
        json.loads(output)
        return output
    except json.JSONDecodeError:
        pass
    # Forwards, skipping past each object found, so the last top-level object wins and an
    # object nested inside it is never mistaken for the answer.
    decoder = json.JSONDecoder()
    found = output
    start = output.find("{")
    while start != -1:
        try:
            _, end = decoder.raw_decode(output, start)
        except json.JSONDecodeError:
            start = output.find("{", start + 1)
            continue
        found = output[start:end]
        start = output.find("{", end)
    return found


def _schema_check(schema: dict[str, Any], output: str) -> tuple[bool, str]:
    """Validate the output against the task's output schema."""
    try:
        parsed = json.loads(json_in(output))
    except json.JSONDecodeError as problem:
        return False, f"the output is not JSON: {problem}"
    try:
        jsonschema.validate(parsed, schema)
    except jsonschema.ValidationError as problem:
        return False, f"the output does not match its schema: {problem.message}"
    return True, "the output matches its schema"


def step_contract(
    output: str,
    *,
    output_schema: dict[str, Any] | None = None,
    plan_items: Sequence[str] = (),
    completed_plan_items: Sequence[str] = (),
) -> VerifyResult:
    """The part of "done" the platform decides rather than asks about (D40, D41).

    For a request step the declared schema *is* the definition of done: it is the only
    objective one the platform has, so a mission whose output does not match it has not
    completed, whatever the model wrote. A mission that declares neither a schema nor
    plan items has nothing mechanical to check and passes here.

    Takes the contract rather than a `TaskFrame` because its two callers hold it
    differently: the hand-rolled loop has a task, and the generic runtime has the schema
    on its run deps. Pure and deterministic — no I/O, no model, no clock — so either may
    call it, including from inside a Temporal workflow.
    """
    checks: list[str] = []

    if output_schema is not None:
        ok, message = _schema_check(output_schema, output)
        checks.append(message)
        if not ok:
            return VerifyResult(passed=False, checks=checks, feedback=message)

    missing = [item for item in plan_items if item not in completed_plan_items]
    if missing:
        feedback = "These plan items are not done: " + "; ".join(missing)
        checks.append(feedback)
        return VerifyResult(passed=False, checks=checks, feedback=feedback)

    return VerifyResult(passed=True, checks=checks)


@activity.defn(name="verify")
async def verify(step: VerifyInput) -> VerifyResult:
    """Check one run's output and return the feedback the agent needs."""
    contract = step_contract(
        step.output,
        output_schema=step.task.output_schema,
        plan_items=step.task.plan_items,
        completed_plan_items=step.completed_plan_items,
    )
    if not contract.passed:
        return contract

    if not step.task.acceptance_criteria:
        checks = [*contract.checks, "no acceptance criteria to check"]
        return VerifyResult(passed=True, checks=checks)

    agent: Agent[None, _Judgement] = Agent(
        gateway_client.model_for_route(step.route),
        name="awp-verifier",
        instructions=VERIFIER_INSTRUCTIONS,
        output_type=_Judgement,
    )
    prompt = (
        f"Task: {step.task.title}\n\n"
        + "Acceptance criteria:\n"
        + "\n".join(f"- {item}" for item in step.task.acceptance_criteria)
        + f"\n\nOutput:\n{step.output}"
    )
    judgement = (await agent.run(prompt)).output
    return VerifyResult(
        passed=judgement.passed,
        checks=[*contract.checks, *judgement.checks],
        feedback=judgement.feedback,
    )
