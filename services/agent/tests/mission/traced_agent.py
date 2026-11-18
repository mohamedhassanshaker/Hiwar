"""The runtime's agent, built while tracing exports to memory, for `test_tracing.py`.

A module of its own, imported through the workflow sandbox: the sandbox re-runs a test
module's top level, and an exporter made there would not be the one the test reads.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from temporalio.contrib.opentelemetry import ReplaySafeTracerProvider, create_tracer_provider

from awp_agent import tracing
from awp_agent.mission.runtime import build_agent

ANSWER = "The refund is approved."
EXPORTED = InMemorySpanExporter()


def _provider() -> ReplaySafeTracerProvider:
    provider = create_tracer_provider()
    provider.add_span_processor(SimpleSpanProcessor(EXPORTED))
    return provider


def _answer(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
    return ModelResponse(parts=[TextPart(ANSWER)])


async def _answer_stream(_messages: list[ModelMessage], _info: AgentInfo) -> AsyncIterator[str]:
    yield ANSWER


TRACED_MODEL = FunctionModel(_answer, stream_function=_answer_stream, model_name="traced")

_configured = tracing.provider
tracing.provider = _provider  # type: ignore[assignment]
try:
    TRACED_AGENT = build_agent(models={"traced": TRACED_MODEL})
finally:
    tracing.provider = _configured  # type: ignore[assignment]
