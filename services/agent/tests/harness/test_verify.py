"""The verifier, specification section 5.3 stage four."""

from __future__ import annotations

import json

from awp_agent.harness.activities.verify import VerifyInput, step_contract, verify
from awp_agent.harness.types import TaskFrame

SCHEMA = {
    "type": "object",
    "properties": {"decision": {"type": "string"}, "amount": {"type": "number"}},
    "required": ["decision", "amount"],
}


async def test_an_output_that_misses_its_schema_is_rejected_without_a_model_call() -> None:
    """The cheap deterministic check runs first, so a bad shape never costs a model call."""
    result = await verify(
        VerifyInput(
            route="unreachable",
            task=TaskFrame(title="Decide", output_schema=SCHEMA),
            output='{"decision": "approved"}',
        )
    )
    assert not result.passed
    assert "schema" in result.feedback


async def test_output_that_is_not_json_is_rejected() -> None:
    """A typed route output has to be JSON before anything else is checked."""
    result = await verify(
        VerifyInput(
            route="unreachable",
            task=TaskFrame(title="Decide", output_schema=SCHEMA),
            output="approved",
        )
    )
    assert not result.passed
    assert "not JSON" in result.feedback


def test_an_object_after_prose_is_the_output_the_contract_reads() -> None:
    """D373: a model that says what it did before the JSON still delivered the JSON."""
    output = 'The Approve action succeeded.\n```json\n{"decision": "approved", "amount": 3}\n```'

    assert step_contract(output, output_schema=SCHEMA).passed


def test_the_schema_echoed_back_is_not_an_output_that_meets_it() -> None:
    """RUN-88252 wrote the step's schema instead of an object that fits it."""
    output = f"The Approve action succeeded.\n{json.dumps(SCHEMA)}"

    assert not step_contract(output, output_schema=SCHEMA).passed


async def test_unfinished_plan_items_are_named() -> None:
    """A failed check gives the agent precise feedback."""
    result = await verify(
        VerifyInput(
            route="unreachable",
            task=TaskFrame(title="Review", plan_items=["Read the claim", "Check receipts"]),
            output="Done",
            completed_plan_items=["Read the claim"],
        )
    )
    assert not result.passed
    assert "Check receipts" in result.feedback


async def test_a_task_with_no_criteria_passes_without_a_model_call() -> None:
    """Nothing to check is a pass, not a model call against an unreachable gateway."""
    result = await verify(
        VerifyInput(route="unreachable", task=TaskFrame(title="Note it"), output="Noted")
    )
    assert result.passed


def test_a_step_whose_output_matches_its_schema_passes_the_contract() -> None:
    """D41: the schema the step declared is what says the mission did the work."""
    result = step_contract('{"decision": "approved", "amount": 5000}', output_schema=SCHEMA)
    assert result.passed
    assert result.feedback == ""


def test_a_step_whose_output_misses_its_schema_fails_the_contract() -> None:
    """The model saying it is finished does not make the output the step's contract."""
    result = step_contract("I have approved the request.", output_schema=SCHEMA)
    assert not result.passed
    assert "not JSON" in result.feedback


def test_a_task_declaring_no_contract_has_nothing_mechanical_to_check() -> None:
    """Not every mission is a request step; one without a schema is not failed for it."""
    assert step_contract("Noted").passed
