"""The OpenAI-compatible surface of the deterministic local engine.

Only the three endpoints the platform calls: the model list the Models screen discovers, chat
completions the harness drives, and embeddings the ingestion pipeline and retrieval use.
agentgateway sits in front of it exactly as it sits in front of a cloud provider, so the
route, the failover chain, the token metering and the trace are the real ones.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from awp_modelstub.engine import EngineUnavailableError, answer, embedding

log = structlog.get_logger(__name__)

#: What this engine serves. Named for what they are, so no one mistakes one for a provider's.
MODELS = (
    "hiwar-local-reasoning",
    "hiwar-local-fast",
    "hiwar-local-classifier",
    "hiwar-local-embedding",
)

#: The dimension the embedding model returns, matching the collections the seed creates.
EMBEDDING_DIMENSIONS = 1024

app = FastAPI(title="Hiwar deterministic local engine", version="0.1.0")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """The health probe: always 200 with `{"status": "ok"}`."""
    return {"status": "ok"}


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    """What `Discover models` on a custom provider finds (`UC-59.1-05`)."""
    created = 1_700_000_000
    return {
        "object": "list",
        "data": [
            {"id": name, "object": "model", "created": created, "owned_by": "awp"}
            for name in MODELS
        ],
    }


def _completion(model: str, reply: Any, created: int) -> dict[str, Any]:
    """The reply as one non-streamed `chat.completion` object, with its usage."""
    message: dict[str, Any] = {"role": "assistant", "content": reply.text or None}
    if reply.tool_calls:
        message["tool_calls"] = reply.tool_calls
    return {
        "id": f"chatcmpl-{created}",
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": reply.finish_reason}],
        "usage": {
            "prompt_tokens": reply.prompt_tokens,
            "completion_tokens": reply.completion_tokens,
            "total_tokens": reply.prompt_tokens + reply.completion_tokens,
        },
    }


async def _stream(model: str, reply: Any, created: int) -> AsyncIterator[bytes]:
    """The reply as server-sent chunks, which is what makes a room reply arrive word by word."""

    def frame(delta: dict[str, Any], finish: str | None = None) -> bytes:
        """One `chat.completion.chunk` carrying `delta`, encoded as a `data:` event."""
        payload = {
            "id": f"chatcmpl-{created}",
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }
        return f"data: {json.dumps(payload)}\n\n".encode()

    yield frame({"role": "assistant"})
    if reply.tool_calls:
        yield frame({"tool_calls": reply.tool_calls})
    else:
        # Word by word, so a client that renders partial text has something to render.
        words = reply.text.split(" ")
        for index, word in enumerate(words):
            yield frame({"content": word if index == 0 else f" {word}"})
    yield frame({}, reply.finish_reason)
    # The usage frame, which is where the harness reads what to meter against the budget.
    usage = {
        "id": f"chatcmpl-{created}",
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [],
        "usage": {
            "prompt_tokens": reply.prompt_tokens,
            "completion_tokens": reply.completion_tokens,
            "total_tokens": reply.prompt_tokens + reply.completion_tokens,
        },
    }
    yield f"data: {json.dumps(usage)}\n\n".encode()
    yield b"data: [DONE]\n\n"


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> Any:
    """OpenAI chat completions: the engine's reply, streamed as server-sent events on `stream`.

    A conversation carrying `[[fail]]` gets 503 with an OpenAI-style error body.
    """
    body = await request.json()
    model = str(body.get("model", MODELS[0]))
    messages = list(body.get("messages", []))
    created = int(time.time())

    try:
        reply = answer(
            model,
            messages,
            tools=body.get("tools"),
            response_format=body.get("response_format"),
            tool_choice=body.get("tool_choice"),
        )
    except EngineUnavailableError as refusal:
        # The shape a provider uses when it cannot answer, so the route's failover and the
        # harness's error path both see what they would see in the field.
        log.info("engine.refused", model=model)
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": str(refusal),
                    "type": "server_error",
                    "code": "unavailable",
                }
            },
        )

    if body.get("stream"):
        return StreamingResponse(_stream(model, reply, created), media_type="text/event-stream")
    return _completion(model, reply, created)


@app.post("/v1/embeddings")
async def embeddings(request: Request) -> dict[str, Any]:
    """OpenAI embeddings: one repeatable unit vector per input, 1024 dimensions by default.

    `input` may be a string or a list; `dimensions` overrides the size. Prompt tokens are a
    word count.
    """
    body = await request.json()
    model = str(body.get("model", MODELS[-1]))
    raw = body.get("input", "")
    texts = raw if isinstance(raw, list) else [raw]
    dimensions = int(body.get("dimensions", EMBEDDING_DIMENSIONS))

    return {
        "object": "list",
        "model": model,
        "data": [
            {"object": "embedding", "index": index, "embedding": embedding(str(text), dimensions)}
            for index, text in enumerate(texts)
        ],
        "usage": {
            "prompt_tokens": sum(len(str(text).split()) for text in texts),
            "total_tokens": 0,
        },
    }
