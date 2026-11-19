"""Shared fixtures. No test here reaches a real model, database, queue or object store."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import pytest
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.testing import WorkflowEnvironment

from awp_agent.harness.types import (
    Actor,
    ProfileName,
    RunBudget,
    RunInput,
    TaskFrame,
    ToolSpec,
    ToolTier,
)


@pytest.fixture(autouse=True)
def _offline_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Point every client at an address nothing listens on, so a test cannot leak traffic."""
    for name, value in {
        "TEMPORAL_ADDRESS": "127.0.0.1:1",
        "AGW_LLM_URL": "http://127.0.0.1:1",
        "AGW_MCP_BASE_URL": "http://127.0.0.1:1",
        "PLATFORM_MCP_URL": "http://127.0.0.1:1/api/mcp",
        "VALKEY_URL": "valkey://127.0.0.1:1/0",
        "NEO4J_URI": "bolt://127.0.0.1:1",
        # Empty, not unreachable: a span exporter with nowhere to send retries in the
        # background and a flush then waits on it, which would hang the suite.
        "OTEL_EXPORTER_OTLP_ENDPOINT": "",
        "PHOENIX_API_KEY": "",
        "KB_DATABASE_URL": "",
    }.items():
        monkeypatch.setenv(name, value)
    from awp_agent.config import settings

    settings.cache_clear()
    yield
    settings.cache_clear()


@pytest.fixture(scope="session")
async def temporal_env() -> AsyncIterator[WorkflowEnvironment]:
    """One Temporal test server for the whole session, with the Pydantic data converter.

    The converter has to be the same here as in `worker.connect`, or a payload written by one
    would not deserialise in the other — which is exactly what the replay test would catch.
    """
    try:
        environment = await WorkflowEnvironment.start_time_skipping(
            data_converter=pydantic_data_converter
        )
    except Exception as problem:  # noqa: BLE001 - the server is a download, not a given
        pytest.skip(f"the Temporal test server is not available: {problem}")
    async with environment:
        yield environment


@pytest.fixture
def actor() -> Actor:
    """The person a run acts for."""
    return Actor(person_id="p-1", display_name="Noura Al Marri", locale="en", mcp_token="t-1")


@pytest.fixture
def tools() -> list[ToolSpec]:
    """One tool per tier, so a test can exercise every outcome."""
    return [
        ToolSpec(name="read_work_item", tier=ToolTier.T0, description="Read a work item."),
        ToolSpec(name="post_message", tier=ToolTier.T1, description="Post into a room."),
        ToolSpec(name="close_request", tier=ToolTier.T2, description="Close a request."),
        ToolSpec(name="delete_person", tier=ToolTier.T3, description="Delete a person."),
    ]


@pytest.fixture
def run_input(actor: Actor, tools: list[ToolSpec]) -> RunInput:
    """A task run with a short effort budget and two acceptance criteria."""
    return RunInput(
        run_id="run-1",
        agent_id="a-1",
        agent_version_id="av-1",
        agent_name="Expense Reviewer",
        profile=ProfileName.TASK,
        route="default-balanced",
        instructions="Review expense claims against the policy.",
        organisation_rules="Claims over 5,000 AED need a manager's approval.",
        context_type="WorkItem",
        context_id="wi-1",
        actor=actor,
        task=TaskFrame(
            title="Review claim EXP-1042",
            description="Check the receipts and the policy limits.",
            acceptance_criteria=["Every receipt is checked", "The limit is applied"],
            plan_items=["Read the claim", "Check the receipts"],
        ),
        tools=tools,
        # What a real agent holds after migration 0034: the harness-answered built-ins
        # are grant rows like any other tool (D80), so a run granted nothing is offered
        # nothing — including `ask_person` and `write_handoff`. The fixture carries the
        # default grant because that is what every existing agent was backfilled with.
        granted_tools=[
            "ask_person",
            "write_handoff",
            "delegate_to_agent",
            "knowledge_search",
            "generate_document",
            "memory_search",
            "memory_write",
            "artifact_create",
            "request_read",
            "work_item_read",
            "file_search",
            "page_read",
            "my_attention",
        ],
        budget=RunBudget(max_steps=4, max_tool_calls=5),
    )
