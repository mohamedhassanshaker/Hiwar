"""What a mission costs, measured by `pydantic_ai_harness.spend` (D85).

Cost is a measurement here, not a control. Both budgets are ceiling-less, which the library
reads as a pure counter: it accumulates and reports and never refuses a request (D73). The
effort limits — `max_steps` and `max_tool_calls`, unset by default since D389, and
`agent_hop_limit` — are not something a `Budget` can express, so the workflow and the tool
policy keep those.

The counter lives in the platform's Valkey, because a mission's steps are separate activities
on separate worker processes and its delegated children are separate workflows. Every one of
them accrues against the same key, the mission id, so the tree's cost is one number the store
maintains rather than a sum anything here has to keep (D11, D44).

A route alias is not a model the `genai-prices` registry knows, so the registry would price
every response at zero. `price` supplies the platform's own per-1000-token estimate instead,
which is what the Models and routes screen publishes and what the console has always shown.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from functools import lru_cache
from typing import Any, cast

from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse
from pydantic_ai.tools import RunContext
from pydantic_ai_harness.spend import (
    BatchSpendStore,
    Budget,
    RedisClient,
    RedisSpendStore,
    SpendLimits,
    SpendRecordedEvent,
)
from valkey.asyncio import Valkey

from awp_agent.clients import gateway_client
from awp_agent.config import settings

#: What the platform converts between, everywhere a dollar price meets an AED figure.
AED_PER_USD = Decimal("3.6725")

#: The counter of a whole delegation tree, and of one model step within it.
MISSION = "mission"
STEP = "step"

#: How long a mission's counter outlives its last write. A mission key never rolls over the
#: way a day does, so without a horizon the store grows for ever; 30 days outlives any
#: mission that can still be resumed.
MISSION_RETAIN = timedelta(days=30)


@lru_cache(maxsize=1)
def _client() -> Valkey:
    """The Valkey connection the spend counters share.

    One pooled client for the life of the worker, as `gateway_client` keeps one HTTP client:
    a connection per model step would pay a handshake on every response recorded.
    """
    client: Valkey = Valkey.from_url(settings().valkey_url, decode_responses=True)
    return client


def _store() -> BatchSpendStore:
    """The counter every run of every mission accrues against."""
    # The annotations of `valkey`'s async client union the sync and async returns, so it
    # does not satisfy the store's protocol by inspection; the two methods the store calls
    # are awaitable and return what it reads.
    return RedisSpendStore(cast(RedisClient, _client()))


def _price(response: ModelResponse) -> Decimal:
    """One response in US dollars, from the platform's estimated per-1000-token rates."""
    usage = response.usage
    return gateway_client.estimate_cost_aed(usage.input_tokens, usage.output_tokens) / AED_PER_USD


def aed(usd: Decimal) -> Decimal:
    """A dollar figure as the AED the console shows, to four decimal places."""
    return (usd * AED_PER_USD).quantize(Decimal("0.0001"))


class MissionLedger:
    """The spend capability for one model step, and the totals it last reported.

    The capability records every billed response — including an attempt a fallback model
    rejected, which the step's own usage never sees — against both counters, and publishes
    where each stands. Nothing here adds two costs together: a total is always read back
    from the store.
    """

    def __init__(self, mission_id: str) -> None:
        """Build the capability: one counter keyed on `mission_id`, one for this step's run.

        Neither budget carries a ceiling, so the capability only records (D73).
        """
        self.mission_aed = Decimal("0")
        self.step_aed = Decimal("0")
        self.capability = SpendLimits[None](
            budgets=[
                Budget[None](
                    name=MISSION,
                    window="total",
                    scope=lambda _ctx: mission_id,
                    retain=MISSION_RETAIN,
                ),
                # `run` is this step's own agent run, which is what the run viewer puts on
                # the step's timeline row.
                Budget[None](name=STEP, window="run"),
            ],
            store=_store(),
            price=_price,
        )

    def listen(self, agent: Agent[None, Any]) -> None:
        """Take each total from the event the capability publishes as it records a response."""

        @agent.on_event(SpendRecordedEvent)
        def _record(_ctx: RunContext[None], event: SpendRecordedEvent) -> None:
            """Keep the mission and step totals the store reported, in AED."""
            for budget in event.budgets:
                if budget.name == MISSION:
                    self.mission_aed = aed(budget.spent_usd)
                elif budget.name == STEP:
                    self.step_aed = aed(budget.spent_usd)
