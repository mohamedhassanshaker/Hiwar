"""`finalize` records a mission's outcome even when the handoff cannot be written."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models.function import AgentInfo, FunctionModel

from awp_agent.clients import events, gateway_client, platform_mcp
from awp_agent.harness.activities import finalize as finalize_module
from awp_agent.harness.activities.finalize import FinalizeInput, finalize
from awp_agent.harness.types import Actor, RunStatus, TaskFrame


def _refused(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
    raise ModelHTTPError(status_code=400, model_name="agent-choice", body="a decisions model")


async def _silent(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
    await asyncio.sleep(3600)
    raise AssertionError("unreachable")


@pytest.mark.parametrize(
    "model", [FunctionModel(_refused), FunctionModel(_silent)], ids=["400", "no answer"]
)
async def test_a_handoff_the_route_cannot_write_still_records_the_outcome(
    monkeypatch: pytest.MonkeyPatch, model: FunctionModel
) -> None:
    """The route that failed the mission fails its handoff too (RUN-88233). The run row must
    still learn the mission failed, or it reads Running for ever."""
    monkeypatch.setattr(gateway_client, "model_for_route", lambda _route: model)
    monkeypatch.setattr(finalize_module, "HANDOFF_TIMEOUT_SECONDS", 0.1)
    sent: list[tuple[str, str, dict[str, Any]]] = []

    async def call_tool(token: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        sent.append((token, name, arguments))
        return {}

    async def publish(_run_id: str, _event: object) -> str:
        return "0-1"

    monkeypatch.setattr(platform_mcp, "call_tool", call_tool)
    monkeypatch.setattr(events, "publish", publish)

    result = await finalize(
        FinalizeInput(
            run_id="run-1",
            actor=Actor(person_id="p-1", mcp_token="model-token", harness_token="harness-token"),
            route="agent-choice",
            status=RunStatus.FAILED,
            task=TaskFrame(title="List the judicial deposits"),
            output="status_code: 400",
            transcript="status_code: 400",
        )
    )

    assert result.recorded
    [(token, name, arguments)] = sent
    assert (token, name) == ("harness-token", "run_finish")
    assert arguments["status"] == str(RunStatus.FAILED)
    assert arguments["handoff"]["goal"] == "List the judicial deposits"


async def test_a_room_run_s_handoff_is_its_answer_without_a_model_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D351: a room's reply waits on `run_finish`, so its handoff is built from the answer
    rather than by a model call (median 8 s on the cluster)."""

    def _no_model(_route: str) -> FunctionModel:
        raise AssertionError("a room run's handoff makes no model call")

    monkeypatch.setattr(gateway_client, "model_for_route", _no_model)
    sent: list[dict[str, Any]] = []

    async def call_tool(_token: str, _name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        sent.append(arguments)
        return {}

    async def publish(_run_id: str, _event: object) -> str:
        return "0-1"

    monkeypatch.setattr(platform_mcp, "call_tool", call_tool)
    monkeypatch.setattr(events, "publish", publish)

    answer = "The judicial deposits feature covers intake, refunds and reconciliation. " * 30
    await finalize(
        FinalizeInput(
            run_id="run-2",
            actor=Actor(person_id="p-1", mcp_token="model-token", harness_token="harness-token"),
            route="small-fast",
            status=RunStatus.SUCCEEDED,
            task=TaskFrame(title="List the judicial deposits features"),
            output=answer,
            transcript=answer,
            context_type="Room",
        )
    )

    [arguments] = sent
    assert arguments["output"] == answer
    assert arguments["handoff"]["goal"] == "List the judicial deposits features"
    kept = answer.strip()[: finalize_module.ROOM_HANDOFF_ANSWER_CHARS]
    assert arguments["handoff"]["decisions"] == [kept]


async def test_a_refused_finish_does_not_fail_the_activity(monkeypatch: pytest.MonkeyPatch) -> None:
    """D360: the platform refuses with a JSON-RPC error, which left the MCP session as an
    ExceptionGroup that `finalize` did not catch; the activity failed on every retry and the
    run read Running for ever (RUN-88233). A refusal is now `PlatformMcpError`, recorded as
    not recorded."""
    from awp_agent.config import settings
    from tests.mission import platform_server

    async def publish(_run_id: str, _event: object) -> str:
        return "0-1"

    monkeypatch.setattr(events, "publish", publish)
    refusal = "not permitted: agents:invoke. user_permission: room_read_floor"
    async with platform_server.serving({}, refusing={"run_finish": refusal}) as served:
        monkeypatch.setenv("PLATFORM_MCP_URL", served.url)
        settings.cache_clear()
        result = await finalize(
            FinalizeInput(
                run_id="run-1",
                actor=Actor(
                    person_id="p-1", mcp_token="model-token", harness_token="harness-token"
                ),
                route="agent-choice",
                status=RunStatus.SUCCEEDED,
                task=TaskFrame(title="Answer in the room"),
                output="Done.",
                context_type="Room",
            )
        )

    assert not result.recorded
    assert served.methods.count("tools/call") == 1
