"""The engine's contract: the same request always answers the same way.

That property is the whole reason this service exists. A platform behaviour — a reply
streaming into a room, a tool call pausing a run, a typesafe route retrying — can only be
asserted if the model's half of it is a constant.
"""

from __future__ import annotations

import json
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient

from awp_modelstub.engine import (
    DEFAULT_COMPLETION_TOKENS,
    EngineUnavailableError,
    answer,
    embedding,
)
from awp_modelstub.main import EMBEDDING_DIMENSIONS, MODELS, app

TOOLS = [
    {"type": "function", "function": {"name": "erp/purchase_order.submit", "parameters": {}}}
]


def user(text: str) -> list[dict[str, str]]:
    return [{"role": "user", "content": text}]


class TestDeterminism:
    def test_the_same_request_answers_the_same_way(self) -> None:
        first = answer("hiwar-local-fast", user("review claim EXP-4471"))
        second = answer("hiwar-local-fast", user("review claim EXP-4471"))
        assert first.text == second.text
        assert first.completion_tokens == second.completion_tokens

    def test_a_different_request_answers_differently(self) -> None:
        first = answer("hiwar-local-fast", user("review claim EXP-4471"))
        second = answer("hiwar-local-fast", user("review claim EXP-9999"))
        assert first.text != second.text

    def test_the_model_is_part_of_the_request(self) -> None:
        fast = answer("hiwar-local-fast", user("same")).text
        reasoning = answer("hiwar-local-reasoning", user("same")).text
        assert fast != reasoning


class TestDirectives:
    def test_say_answers_with_exactly_that_text(self) -> None:
        assert answer("m", user("[[say:Approved within limit.]]")).text == "Approved within limit."

    def test_tool_answers_with_a_tool_call_so_tiers_and_approvals_run(self) -> None:
        reply = answer(
            "m",
            user('[[tool:erp/purchase_order.submit {"amount": 5200}]]'),
            tools=TOOLS,
        )
        assert reply.finish_reason == "tool_calls"
        assert reply.tool_calls[0]["function"]["name"] == "erp/purchase_order.submit"
        assert json.loads(reply.tool_calls[0]["function"]["arguments"]) == {"amount": 5200}

    def test_a_tool_call_is_offered_only_when_the_caller_offered_tools(self) -> None:
        # With no tools in the request there is nothing to call, so the engine answers in text.
        assert answer("m", user("[[tool:anything]]")).tool_calls == []

    def test_tokens_sets_what_the_budget_meters(self) -> None:
        assert answer("m", user("[[tokens:4096]]")).completion_tokens == 4096
        assert answer("m", user("ordinary")).completion_tokens == DEFAULT_COMPLETION_TOKENS

    def test_fail_answers_as_an_unavailable_provider(self) -> None:
        with pytest.raises(EngineUnavailableError):
            answer("m", user("[[fail]]"))


class TestStructuredOutput:
    schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "required": ["category", "confidence"],
        "properties": {
            "category": {"type": "string", "enum": ["expense", "purchase", "leave"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
    }

    def response_format(self) -> dict[str, object]:
        return {
            "type": "json_schema",
            "json_schema": {"name": "classification", "schema": self.schema},
        }

    def result_tool(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {"name": "final_result", "parameters": self.schema},
            }
        ]

    def test_a_required_tool_call_is_answered_with_one(self) -> None:
        """An agent whose answer is a typed object asks for it as a tool call."""
        reply = answer(
            "m",
            user("reimburse my taxi fares"),
            tools=self.result_tool(),
            tool_choice="required",
        )
        assert reply.finish_reason == "tool_calls"
        call = reply.tool_calls[0]["function"]
        assert call["name"] == "final_result"
        payload = json.loads(call["arguments"])
        assert payload["category"] in ["expense", "purchase", "leave"]
        assert 0 <= payload["confidence"] <= 1

    def test_a_named_tool_choice_calls_that_tool(self) -> None:
        reply = answer(
            "m",
            user("reimburse my taxi fares"),
            tools=self.result_tool(),
            tool_choice={"type": "function", "function": {"name": "final_result"}},
        )
        assert reply.tool_calls[0]["function"]["name"] == "final_result"

    def test_a_tool_the_caller_only_offers_is_not_called(self) -> None:
        """`tool_choice` absent means the model may answer in words, and this one does."""
        reply = answer("m", user("hello"), tools=self.result_tool())
        assert reply.tool_calls == []
        assert reply.text

    def test_a_typesafe_route_gets_output_that_satisfies_its_schema(self) -> None:
        reply = answer(
            "m",
            user("reimburse my taxi fares"),
            response_format=self.response_format(),
        )
        payload = json.loads(reply.text)
        assert payload["category"] in self.schema["properties"]["category"]["enum"]
        assert 0 <= payload["confidence"] <= 1

    def test_invalid_json_gives_the_retry_and_fallback_something_to_do(self) -> None:
        reply = answer("m", user("[[invalid-json]]"), response_format=self.response_format())
        payload = json.loads(reply.text)
        assert "category" not in payload


class TestEmbeddings:
    def test_a_passage_embeds_to_the_same_vector_every_time(self) -> None:
        passage = "hotel per-diem in Riyadh"
        assert embedding(passage, 64) == embedding(passage, 64)

    def test_different_passages_embed_differently(self) -> None:
        assert embedding("one", 64) != embedding("two", 64)

    def test_the_vector_is_a_unit_vector(self) -> None:
        vector = embedding("anything", 128)
        assert len(vector) == 128
        assert abs(sum(value * value for value in vector) ** 0.5 - 1.0) < 1e-9


class TestSurface:
    client = TestClient(app)

    def test_discover_models_lists_what_this_engine_serves(self) -> None:
        response = self.client.get("/v1/models")
        assert response.status_code == 200
        assert [entry["id"] for entry in response.json()["data"]] == list(MODELS)

    def test_a_completion_reports_usage_so_the_budget_can_meter_it(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "hiwar-local-fast", "messages": user("[[tokens:120]]")},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["usage"]["completion_tokens"] == 120
        assert body["choices"][0]["finish_reason"] == "stop"

    def test_a_streamed_completion_arrives_in_chunks_and_ends_with_usage(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={
                "model": "hiwar-local-fast",
                "messages": user("[[say:one two three]]"),
                "stream": True,
            },
        )
        assert response.status_code == 200
        frames = [line for line in response.text.splitlines() if line.startswith("data: ")]
        assert frames[-1] == "data: [DONE]"

        payloads = [json.loads(frame[6:]) for frame in frames[:-1]]
        content = "".join(
            payload["choices"][0].get("delta", {}).get("content", "")
            for payload in payloads
            if payload.get("choices")
        )
        assert content.strip() == "one two three"
        assert any("usage" in payload for payload in payloads)

    def test_a_refusal_answers_503_like_an_unavailable_provider(self) -> None:
        response = self.client.post(
            "/v1/chat/completions",
            json={"model": "hiwar-local-fast", "messages": user("[[fail]]")},
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "unavailable"

    def test_embeddings_return_the_requested_dimension(self) -> None:
        response = self.client.post(
            "/v1/embeddings",
            json={"model": "hiwar-local-embedding", "input": ["one", "two"]},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data) == 2
        assert len(data[0]["embedding"]) == EMBEDDING_DIMENSIONS
