"""Tracing into Arize Phoenix (stack specification 6.3 and 11).

One trace per run, with the **trace id equal to the run id**, because the run viewer's
"Open trace" link is built from the run id alone. OpenTelemetry carries the spans over OTLP
and the OpenInference conventions name them, so the gateway's own LLM spans — which carry
the same `traceparent` — land inside the run's trace rather than beside it.

A delegation tree is several of those traces, so `awp.mission_id` is what joins them: the
root mission, the same value the gateway header and the spend counter use (D44, D11). It
is a separate argument from the run id because the two differ precisely when it matters —
on a delegated run — and it defaults to the run id, which is what the mission is for a run
a person started.

Spans are opened for tools, hooks and the verifier; eval scores are attached as span
attributes when the run finishes. The model calls are Pydantic AI's own `chat` spans, with
the prompt and the answer in the OTel GenAI attributes, which Phoenix shows as LLM spans.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any

import httpx
from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags
from temporalio.contrib.opentelemetry import ReplaySafeTracerProvider, create_tracer_provider

from awp_agent.config import settings
from awp_agent.logging import logger

log = logger("awp_agent.tracing")

# OpenInference names the kind of every span it recognises.
SPAN_KIND = "openinference.span.kind"


@lru_cache(maxsize=1)
def provider() -> ReplaySafeTracerProvider | None:
    """The tracer provider, or None when no OTLP endpoint is configured.

    The `core` profile leaves Phoenix out, and then the console's run timeline is the only
    trace there is; nothing in the harness changes because of that.

    Temporal's replay-safe provider, because the agent's run and `chat` spans are opened in
    the mission workflow: replaying its history would otherwise record every model call of
    the run again. Outside a workflow it behaves as the SDK provider it wraps.
    """
    config = settings()
    if not config.tracing_enabled:
        return None
    resource = Resource.create(
        {"service.name": config.service_name, "deployment.environment": config.environment}
    )
    tracer_provider = create_tracer_provider(resource=resource)
    headers = (
        {"authorization": f"Bearer {config.phoenix_api_key}"} if config.phoenix_api_key else {}
    )
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=config.otlp_endpoint, headers=headers))
    )
    trace.set_tracer_provider(tracer_provider)
    return tracer_provider


def _tracer() -> trace.Tracer | None:
    tracer_provider = provider()
    return None if tracer_provider is None else tracer_provider.get_tracer("awp_agent")


def _trace_id(run_id: str) -> int:
    """A run id is a UUID; its 128 bits are the trace id, so the two are the same thing."""
    return int(run_id.replace("-", ""), 16)


def _context(run_id: str) -> otel_context.Context | None:
    """The run's trace as a parent context, so every span joins one trace."""
    try:
        identifier = _trace_id(run_id)
    except ValueError:
        return None
    span_context = SpanContext(
        trace_id=identifier,
        span_id=identifier & ((1 << 64) - 1),
        is_remote=True,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )
    return trace.set_span_in_context(NonRecordingSpan(span_context))


@contextmanager
def within_run(run_id: str) -> Iterator[None]:
    """Make the run's trace the current context, so spans opened inside join it.

    The agent's own spans — the run, each `chat` with its prompt and answer, each tool —
    have no run id of their own; opened under this they share the run's trace id, which is
    what "Open trace" on the run viewer looks up.
    """
    parent = _context(run_id)
    token = None if parent is None else otel_context.attach(parent)
    try:
        yield
    finally:
        if token is not None:
            otel_context.detach(token)


def start_run(
    run_id: str, name: str, metadata: dict[str, Any] | None = None, mission_id: str = ""
) -> str:
    """Open the trace of one run. The trace id is the run id."""
    tracer = _tracer()
    if tracer is None:
        return ""
    with tracer.start_as_current_span(
        f"run:{name}",
        context=_context(run_id),
        attributes={SPAN_KIND: "AGENT", "awp.mission_id": mission_id or run_id},
    ) as span:
        for key, value in (metadata or {}).items():
            span.set_attribute(f"awp.{key}", str(value))
    return run_id


def span(
    run_id: str, name: str, payload: dict[str, Any] | None = None, mission_id: str = ""
) -> None:
    """Record one span inside a run's trace.

    `awp.mission_id` is on every span and matches the header every model call carries and
    the Temporal workflow id of the mission (D44): one id to search all three by. It is
    the root of the delegation tree, so the spans of a parent and its children answer one
    query; the run id, which is the trace id, is what separates them again.
    """
    tracer = _tracer()
    if tracer is None:
        return
    kind = "TOOL" if name.startswith("tool") else "CHAIN"
    with tracer.start_as_current_span(
        name,
        context=_context(run_id),
        attributes={SPAN_KIND: kind, "awp.mission_id": mission_id or run_id},
    ) as recorded:
        for key, value in (payload or {}).items():
            recorded.set_attribute(f"awp.{key}", str(value))


def close_run(run_id: str, status: str, scores: dict[str, float]) -> str:
    """Attach the eval scores and flush. Returns the trace id for the Run row."""
    tracer_provider = provider()
    tracer = _tracer()
    if tracer is None or tracer_provider is None:
        return ""
    with tracer.start_as_current_span(
        "run:end", context=_context(run_id), attributes={SPAN_KIND: "AGENT"}
    ) as recorded:
        recorded.set_attribute("awp.status", status)
        for name, value in scores.items():
            recorded.set_attribute(f"awp.eval.{name}", value)
    tracer_provider.force_flush()
    return run_id


async def tracing_healthy() -> bool:
    """True when Phoenix is configured and answers."""
    config = settings()
    if not config.tracing_enabled:
        return False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{config.phoenix_base_url}/healthz")
    except Exception:  # noqa: BLE001 - a health probe reports, it never raises
        return False
    return response.status_code == httpx.codes.OK
