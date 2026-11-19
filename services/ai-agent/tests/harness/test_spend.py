"""What a mission costs, as `pydantic_ai_harness.spend` records it (D73, D85)."""

from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel
from pydantic_ai_harness.spend import BatchSpendStore, InMemorySpendStore

from awp_agent.clients import gateway_client
from awp_agent.harness import spend


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> BatchSpendStore:
    """The shared counter, in process. The production one is the platform's Valkey."""
    in_memory = InMemorySpendStore()
    monkeypatch.setattr(spend, "_store", lambda: in_memory)
    return in_memory


def _agent(ledger: spend.MissionLedger) -> Agent[None, str]:
    agent = Agent(TestModel(), capabilities=[ledger.capability])
    ledger.listen(agent)
    return agent


def test_no_budget_can_refuse_a_request() -> None:
    """D73: there is no money ceiling, so every counter is a counter and never a gate."""
    ledger = spend.MissionLedger("m-1")
    budgets = ledger.capability.budgets
    assert budgets
    assert not any(budget.enforces for budget in budgets)


def test_a_price_converts_back_to_the_aed_the_console_shows() -> None:
    """The counter holds dollars; the platform's estimate is in AED, at 3.6725."""
    assert spend.aed(Decimal("0.0440") / spend.AED_PER_USD) == gateway_client.estimate_cost_aed(
        1000, 1000
    )


async def test_the_mission_total_accumulates_across_steps(store: BatchSpendStore) -> None:
    """Each step is its own agent run, so only a shared counter can hold the mission."""
    first = spend.MissionLedger("m-1")
    await _agent(first).run("one")
    second = spend.MissionLedger("m-1")
    await _agent(second).run("two")

    assert first.step_aed > Decimal("0")
    assert second.step_aed == first.step_aed
    assert second.mission_aed == first.mission_aed + second.step_aed


async def test_a_second_mission_counts_separately(store: BatchSpendStore) -> None:
    """One mission's spend must never land on another's key."""
    mine = spend.MissionLedger("m-1")
    await _agent(mine).run("one")
    theirs = spend.MissionLedger("m-2")
    await _agent(theirs).run("one")

    assert theirs.mission_aed == theirs.step_aed
