"""The deterministic engine behind the OpenAI-compatible surface.

The platform's model contract is the OpenAI-compatible API, reached through agentgateway.
This engine implements that contract and answers from the request alone, so a run is
repeatable: the same conversation always produces the same reply, the same tool call and
the same token counts.

It exists because the behaviour the acceptance document asks for — a reply streaming into a
room, a T2 tool call pausing a run until a human decides, a typesafe route retrying invalid
output, an estimated cost counted against a budget — is behaviour of **the platform**, not
of any model. Without a local engine none of it can be exercised, and with a live provider
none of it can be asserted, because the answer differs every time.

It is a provider, never a platform component. It is registered through the product's own
custom-provider mechanism (specification 7.4.8, the on-prem engines), so the harness, the
gateway route, the failover chain and the budget meter are all the real ones.

**Directives.** A test drives a specific path by putting a directive in the user message.
Anything with no directive gets the ordinary reply path.

| Directive | Effect |
| --- | --- |
| `[[tool:NAME]]` | Answer with a tool call to `NAME`, so tiers and approvals run |
| `[[tool:NAME {json}]]` | The same, with those arguments |
| `[[json]]` | Answer with an object that satisfies the requested schema |
| `[[invalid-json]]` | Answer with output that fails the schema, so the retry and fallback run |
| `[[fail]]` | Answer 503, so the failover chain and the error paths run |
| `[[tokens:N]]` | Report N completion tokens, so budget thresholds are reachable |
| `[[say:TEXT]]` | Answer with exactly TEXT |
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any

#: Completion tokens a reply reports when nothing asks for a specific number.
DEFAULT_COMPLETION_TOKENS = 48

#: Words the ordinary reply is built from. Chosen to be neutral and obviously synthetic, so
#: nobody mistakes an engine answer for a model's judgement.
_VOCABULARY = (
    "acknowledged",
    "reviewed",
    "the",
    "request",
    "within",
    "policy",
    "and",
    "recorded",
    "for",
    "approval",
)

_DIRECTIVE = re.compile(r"\[\[(?P<name>[a-z-]+)(?::(?P<value>[^\]]*))?\]\]")


class EngineUnavailableError(Exception):
    """Raised for `[[fail]]`, which asks the engine to answer as an unavailable provider."""


@dataclass(frozen=True)
class Directive:
    name: str
    value: str = ""


@dataclass
class Reply:
    """One answer, in the shape the OpenAI-compatible surface serialises."""

    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def finish_reason(self) -> str:
        """`tool_calls` when the reply calls a tool, otherwise `stop`."""
        return "tool_calls" if self.tool_calls else "stop"


def directives(messages: list[dict[str, Any]]) -> list[Directive]:
    """Every directive in the conversation, in order, newest message last."""
    found: list[Directive] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, str):
            continue
        for match in _DIRECTIVE.finditer(content):
            found.append(Directive(match.group("name"), (match.group("value") or "").strip()))
    return found


def _seed(model: str, messages: list[dict[str, Any]]) -> int:
    """A stable number for this exact request, so the same input gives the same output."""
    material = json.dumps({"model": model, "messages": messages}, sort_keys=True, default=str)
    return int.from_bytes(hashlib.sha256(material.encode()).digest()[:8], "big")


def _count_tokens(messages: list[dict[str, Any]]) -> int:
    """A word count standing in for a tokeniser. The platform meters whatever is reported."""
    words = 0
    for message in messages:
        content = message.get("content")
        if isinstance(content, str):
            words += len(content.split())
    return max(1, words)


def _sentence(seed: int, length: int = 12) -> str:
    """A repeatable sentence, so an assertion on a reply is an assertion on a constant."""
    words = [_VOCABULARY[(seed >> (index * 3)) % len(_VOCABULARY)] for index in range(length)]
    return " ".join(words).capitalize() + "."


def _schema_of(response_format: dict[str, Any] | None) -> dict[str, Any] | None:
    """The JSON Schema a typesafe route asked the answer to satisfy, if it asked for one."""
    if not response_format:
        return None
    if response_format.get("type") == "json_schema":
        schema = response_format.get("json_schema", {})
        value = schema.get("schema")
        return value if isinstance(value, dict) else None
    return None


def _satisfy(schema: dict[str, Any], seed: int) -> Any:
    """The smallest value that satisfies a schema, built from its own declaration."""
    kind = schema.get("type")
    if kind == "object":
        properties: dict[str, Any] = schema.get("properties", {})
        required: list[str] = schema.get("required", list(properties))
        return {
            name: _satisfy(properties.get(name, {}), seed + index)
            for index, name in enumerate(required)
        }
    if kind == "array":
        return [_satisfy(schema.get("items", {}), seed)]
    if kind == "number" or kind == "integer":
        low = schema.get("minimum", 0)
        high = schema.get("maximum", low + 1)
        value = low + (seed % max(1, int(high - low) + 1))
        return value if kind == "integer" else float(value)
    if kind == "boolean":
        return bool(seed % 2)
    options = schema.get("enum")
    if options:
        return options[seed % len(options)]
    return _sentence(seed, 4)


def _required_tool(
    tools: list[dict[str, Any]] | None, tool_choice: Any
) -> dict[str, Any] | None:
    """The tool the caller insists on, when it insists on one.

    An agent that takes its answer as a typed object asks for it as a tool call and requires
    one: `tool_choice` is `required`, or it names the function. Answering with prose there is
    not an answer at all, so the engine calls what was asked for and fills the arguments from
    that tool's own schema.
    """
    if not tools:
        return None
    if tool_choice == "required":
        return tools[0]
    if isinstance(tool_choice, dict):
        wanted = (tool_choice.get("function") or {}).get("name")
        for tool in tools:
            if (tool.get("function") or {}).get("name") == wanted:
                return tool
    return None


def answer(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    response_format: dict[str, Any] | None = None,
    tool_choice: Any = None,
) -> Reply:
    """The reply to one request.

    Raises EngineUnavailableError when the conversation carries `[[fail]]`.
    """
    seed = _seed(model, messages)
    prompt_tokens = _count_tokens(messages)
    found = {directive.name: directive.value for directive in directives(messages)}

    if "fail" in found:
        raise EngineUnavailableError("the engine was asked to answer as an unavailable provider")

    completion_tokens = DEFAULT_COMPLETION_TOKENS
    if "tokens" in found and found["tokens"].isdigit():
        completion_tokens = int(found["tokens"])

    if "tool" in found and tools:
        name, _, raw = found["tool"].partition(" ")
        try:
            arguments = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            arguments = {"argument": raw.strip()}
        # A directive may name a tool the caller never offered. The engine answers with it
        # anyway: rejecting a tool call for a tool an agent may not use is the harness's
        # job, and this is how that path gets exercised.
        return Reply(
            tool_calls=[
                {
                    "id": f"call_{seed % 10**8:08d}",
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(arguments, sort_keys=True),
                    },
                }
            ],
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    required = _required_tool(tools, tool_choice)
    if required is not None and "invalid-json" not in found:
        function = required.get("function") or {}
        schema_of_tool = function.get("parameters") or {"type": "object", "properties": {}}
        arguments = _satisfy(schema_of_tool, seed)
        return Reply(
            tool_calls=[
                {
                    "id": f"call_{seed % 10**8:08d}",
                    "type": "function",
                    "function": {
                        "name": function.get("name", "final_result"),
                        "arguments": json.dumps(arguments, sort_keys=True),
                    },
                }
            ],
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    schema = _schema_of(response_format)
    if "invalid-json" in found:
        # Deliberately not the shape the schema asked for, so the typesafe route's retry and
        # then its fallback are what answer (`UC-60.1-03`, `UC-28.2-06`).
        return Reply(
            text='{"unexpected": true}',
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
    if schema is not None or "json" in found:
        payload = _satisfy(schema or {"type": "object", "properties": {}}, seed)
        return Reply(
            text=json.dumps(payload, sort_keys=True),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    if "say" in found:
        return Reply(
            text=found["say"],
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    return Reply(
        text=_sentence(seed),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )


def embedding(text: str, dimensions: int) -> list[float]:
    """A repeatable unit vector for a passage, so an index built twice is the same index."""
    digest = hashlib.sha256(text.encode()).digest()
    # Two bytes per dimension, wrapping around the digest. The window always starts inside
    # the digest and `int.from_bytes` accepts a short tail, so there is no empty slice.
    raw = [
        int.from_bytes(digest[index % len(digest) :][:2], "big") / 65535 - 0.5
        for index in range(dimensions)
    ]
    norm = sum(value * value for value in raw) ** 0.5 or 1.0
    return [value / norm for value in raw]
