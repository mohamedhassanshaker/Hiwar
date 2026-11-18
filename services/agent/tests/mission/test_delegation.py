"""Registering a delegated child mission (D114, D142)."""

from __future__ import annotations

from typing import Any

import pytest

from awp_agent.clients import platform_mcp
from awp_agent.config import settings
from awp_agent.harness.types import SkillRef
from awp_agent.mission import delegation
from awp_agent.mission.delegation import ChildMissionWanted, register_child_mission
from awp_agent.mission.deps import SkillDoc


async def test_a_child_mission_can_reach_the_platform_the_model_and_its_skills(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The child runs as a workflow, which may not read settings or the bundle, so the
    registration has to hand it the platform address, the gateway and its skills."""

    async def answer(token: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        assert (token, name) == ("harness-parent", "run_start")
        return {
            "ok": True,
            "person_id": "p-1",
            "mcp_token": "model-child",
            "harness_token": "harness-child",
            "route": "small-fast",
            "instructions": "You review.",
            "granted_tools": ["request_read"],
            "tools": [{"name": "request_read", "tier": "T0"}],
            "skills": [
                {
                    "id": "sv-1",
                    "name": "work-item-execution",
                    "description": "",
                    "path": "work-item-execution",
                    "package_ref": None,
                }
            ],
        }

    loaded: list[tuple[set[str], str]] = []

    # The harness's loader reads the bundle through a POSIX-only workspace; what matters
    # here is that the child's granted skills are asked for, from the configured bundle.
    async def load(skills: list[SkillRef], bundle: str) -> list[SkillDoc]:
        names = {skill.name for skill in skills}
        loaded.append((names, bundle))
        return [SkillDoc(name=name, description="", instructions="body") for name in sorted(names)]

    monkeypatch.setattr(platform_mcp, "call_tool", answer)
    monkeypatch.setattr(delegation, "granted_skills", load)

    child = await register_child_mission(
        ChildMissionWanted(
            parent_run_id="parent",
            child_run_id="child",
            agent_code="exp",
            harness_token="harness-parent",
        )
    )

    assert child.deps is not None
    assert child.deps.mcp_url == settings().platform_mcp_url != ""
    assert child.deps.gateway_url != ""
    assert loaded == [({"work-item-execution"}, settings().skills_path)]
    assert [skill.name for skill in child.deps.skills] == ["work-item-execution"]
    assert child.deps.granted_tools == ["request_read"]


async def test_a_refused_delegation_is_a_reason_not_a_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def refuse(token: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return {"ok": False, "message": "This run has already delegated 8 times."}

    monkeypatch.setattr(platform_mcp, "call_tool", refuse)
    child = await register_child_mission(
        ChildMissionWanted(parent_run_id="p", child_run_id="c", agent_code="exp", harness_token="h")
    )
    assert child.deps is None
    assert "8 times" in child.error


async def test_an_escalated_call_is_raised_as_t1_with_the_servers_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A server-escalated T1 call is not a T2 call: the approval says which, and why."""
    from awp_agent.mission.approvals import ApprovalWanted, create_approval

    sent: list[dict[str, Any]] = []

    async def record(token: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        sent.append(arguments)
        return {"id": "ap-1"}

    monkeypatch.setattr(platform_mcp, "call_tool", record)
    approval = await create_approval(
        ApprovalWanted(
            run_id="r",
            call_id="c",
            tool_name="request_step_action_create",
            arguments={"key": "REQ-1", "action": "Approve"},
            tier="T1",
            reason="The requester cannot approve their own request.",
        )
    )
    assert approval == "ap-1"
    assert sent[0]["tier"] == "T1"
    assert sent[0]["reason"] == "The requester cannot approve their own request."
