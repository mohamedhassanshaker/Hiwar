"""The runtime's compaction thresholds (D137), measured on histories of a known size.

The size is what the provider reported for the last request (`input_tokens` on the last
response), which is the number the harness's compaction reads first. Below 60,000 nothing
is touched; above it the oldest tool results are blanked; a summary, which is a model call,
waits until 150,000.
"""

from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import RequestUsage

from awp_agent.harness.capabilities import compaction_capabilities

#: Twelve tool results of 20,000 characters each, about 5,000 tokens apiece.
TOOL_RESULTS = 12
RESULT_TEXT = "x" * 20_000


def _history(request_tokens: int) -> list[ModelMessage]:
    """A mission that read twelve claims, whose last request measured `request_tokens`."""
    messages: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart("Review the claims.")])]
    for index in range(TOOL_RESULTS):
        call_id = f"call-{index}"
        messages.append(
            ModelResponse(parts=[ToolCallPart("claim_read", {"key": f"EXP-{index}"}, call_id)])
        )
        messages.append(
            ModelRequest(parts=[ToolReturnPart("claim_read", RESULT_TEXT, tool_call_id=call_id)])
        )
    messages.append(
        ModelResponse(
            parts=[TextPart("I have read them all.")],
            usage=RequestUsage(input_tokens=request_tokens, output_tokens=10),
        )
    )
    return messages


async def _next_turn(request_tokens: int) -> list[list[ModelMessage]]:
    """Run one more turn on the runtime's compaction; return what each model call was sent."""
    sent: list[list[ModelMessage]] = []

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        sent.append(list(messages))
        return ModelResponse(parts=[TextPart("Summary of the claims.")])

    agent = Agent(FunctionModel(model), capabilities=compaction_capabilities())
    await agent.run("Which claims are over the limit?", message_history=_history(request_tokens))
    return sent


def _results(messages: list[ModelMessage]) -> list[str]:
    return [
        str(part.content)
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    ]


async def test_a_request_below_sixty_thousand_tokens_is_sent_untouched() -> None:
    """The defect D137 fixed: compaction ran on nearly every turn, each a step spent."""
    [sent] = await _next_turn(59_000)

    assert _results(sent) == [RESULT_TEXT] * TOOL_RESULTS


async def test_a_request_above_sixty_thousand_tokens_has_its_oldest_tool_results_cleared() -> None:
    [sent] = await _next_turn(61_000)

    results = _results(sent)
    assert len(results) == TOOL_RESULTS
    # The six most recent results are kept as they were.
    assert results[-6:] == [RESULT_TEXT] * 6
    assert RESULT_TEXT not in results[:-6]


async def test_a_request_below_a_hundred_and_fifty_thousand_tokens_is_not_summarised() -> None:
    """A summary is a model call of its own; only one call, the turn itself, is made."""
    sent = await _next_turn(149_000)

    assert len(sent) == 1


async def test_a_request_above_a_hundred_and_fifty_thousand_tokens_is_summarised_first() -> None:
    sent = await _next_turn(151_000)

    # The summary call, then the turn on the summarised history.
    assert len(sent) == 2
    assert len(_results(sent[-1])) < TOOL_RESULTS
