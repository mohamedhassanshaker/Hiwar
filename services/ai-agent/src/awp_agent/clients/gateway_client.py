"""The only module that calls agentgateway.

Stack specification 6.1: every model and embedding call is built here, against the
gateway's OpenAI-compatible base URL, with the route alias as the model name. No provider
SDK is used anywhere else in the service, and no provider credential ever reaches it: the
gateway holds those, and the per-run JWT is what identifies the caller.

The `openai-chat:` surface, not the Responses API (5.4): the gateway route is called through
Chat Completions.
"""

from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from typing import Any

import httpx
import httpx2
from openai import AsyncOpenAI
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.openai import OpenAIProvider

from awp_agent.config import settings

# Estimated AED per 1000 tokens. The platform shows estimated cost everywhere, never a billed
# amount; the Models and routes screen keeps the per-route figures and sends them with the run.
DEFAULT_INPUT_AED_PER_1K = Decimal("0.0110")
DEFAULT_OUTPUT_AED_PER_1K = Decimal("0.0330")


@lru_cache(maxsize=1)
def _http_client() -> httpx2.AsyncClient:
    """The client the OpenAI-compatible provider and the raw client share.

    `httpx2`, not `httpx`: Pydantic AI v2 deprecated the `httpx` client for
    OpenAI-compatible providers and removes it in v3.
    """
    return httpx2.AsyncClient(timeout=httpx2.Timeout(120.0, connect=10.0))


@lru_cache(maxsize=1)
def _probe_client() -> httpx.AsyncClient:
    """A plain client for the gateway health probe, which is not a model call."""
    return httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))


def _api_key() -> str:
    """The per-run JWT agentgateway validates. Empty outside a run, which the gateway
    rejects for anything but its health endpoint."""
    return settings().run_token or "anonymous"


def openai_base_url() -> str:
    """agentgateway's OpenAI-compatible base, including the version segment.

    The OpenAI client appends `/chat/completions` and `/embeddings` to whatever it is
    given, so the base has to carry `/v1` already. `AGW_LLM_URL` names the listener, not
    the API, and without this every call went to `/chat/completions` and agentgateway
    answered `404 route not found` — while the health probe, which spells out `/v1/models`
    itself, went on reporting the gateway up.
    """
    return f"{settings().agw_llm_url.rstrip('/')}/v1"


@lru_cache(maxsize=1)
def provider() -> OpenAIProvider:
    """The OpenAI-compatible provider pointed at agentgateway's LLM listener."""
    return OpenAIProvider(
        base_url=openai_base_url(),
        api_key=_api_key(),
        http_client=_http_client(),
    )


#: The headers agentgateway and the provider see a call's place in the tree on.
#:
#: A mission is one id everywhere: the Temporal workflow id of the run a person started,
#: the id the spend counter is keyed on, and this (D44). Until it was threaded, a mission
#: that made six model calls appeared in the gateway's logs as six unrelated calls, so
#: neither its cost nor its failures could be read end to end. Headers rather than body
#: fields: an unrecognised header is ignored by every hop, where an unrecognised body
#: field can be rejected outright.
MISSION_HEADER = "x-awp-mission-id"
RUN_HEADER = "x-awp-run-id"
PARENT_RUN_HEADER = "x-awp-parent-run-id"
PERSON_HEADER = "x-awp-person-id"


def call_settings(
    mission_id: str, run_id: str, person_id: str, parent_run_id: str = ""
) -> OpenAIChatModelSettings:
    """What every model call of one run carries, so the three systems agree.

    Three ids, because a delegation tree needs all three to be read: the mission is the
    root every run in the tree shares, which is what the gateway groups on and what the
    spend counter is keyed on (D44, D11); the run is this one agent run, which is its own
    Phoenix trace; the parent run is the delegation that caused it, omitted at the root
    (D46). Sending the run id as the mission, as this did, made a delegated run its own
    mission in the gateway while its cost accrued against the tree's counter, so the two
    views of the same spend disagreed.

    `openai_user` stays the real platform person, never the mission or the agent (D45):
    provider-side abuse signals and cost attribution have to point at somebody, and an
    agent is not somebody. The ids travel beside it in headers.
    """
    headers = {MISSION_HEADER: mission_id, RUN_HEADER: run_id, PERSON_HEADER: person_id}
    if parent_run_id:
        headers[PARENT_RUN_HEADER] = parent_run_id
    return OpenAIChatModelSettings(extra_headers=headers, openai_user=person_id)


@lru_cache(maxsize=32)
def model_for_route(route: str) -> OpenAIChatModel:
    """The Pydantic AI model for one route alias from Models and routes.

    The alias is an agentgateway route, so the fallback chain configured there is what
    decides which provider actually serves the call.
    """
    return OpenAIChatModel(route, provider=provider())


@lru_cache(maxsize=1)
def raw_client() -> AsyncOpenAI:
    """The raw gateway client, used for embeddings and for the gateway health probe."""
    return AsyncOpenAI(
        base_url=openai_base_url(),
        api_key=_api_key(),
        http_client=_http_client(),
    )


async def embed(texts: list[str], route: str | None = None) -> list[list[float]]:
    """Embed a batch of texts through the gateway's embedding route."""
    alias = route or settings().embedding_route
    response = await raw_client().embeddings.create(model=alias, input=texts)
    return [item.embedding for item in response.data]


async def decide(route: str, state: dict[str, Any], questions: dict[str, Any]) -> dict[str, Any]:
    """Ask a Decision route its questions and return the provider's answers by name (D290).

    agentgateway has no decisions format, so a Decision route's steps send the gateway's chat
    format to the provider's decisions endpoint: the decisions request goes where a chat call
    goes, with the empty `messages` the gateway's parser requires.
    """
    response = await _http_client().post(
        f"{openai_base_url()}/chat/completions",
        json={"model": route, "messages": [], "state": state, "questions": questions},
        headers={"Authorization": f"Bearer {_api_key()}"},
    )
    response.raise_for_status()
    answers: dict[str, Any] = response.json()["answers"]
    return answers


async def gateway_healthy() -> bool:
    """True when the gateway serves the model list.

    `/v1/models` and not `/healthz`: agentgateway serves the OpenAI-compatible API on this
    listener and nothing else, so a 404 on any other path says only that the path is
    unknown. The model list answering is what tells the service a route exists to call.
    """
    try:
        response = await _probe_client().get(f"{settings().agw_llm_url}/v1/models")
    except httpx.HTTPError:
        return False
    return response.status_code == httpx.codes.OK


def estimate_cost_aed(
    tokens_in: int,
    tokens_out: int,
    input_aed_per_1k: Decimal = DEFAULT_INPUT_AED_PER_1K,
    output_aed_per_1k: Decimal = DEFAULT_OUTPUT_AED_PER_1K,
) -> Decimal:
    """The estimated cost of one model step, to four decimal places."""
    cost = (
        Decimal(tokens_in) / 1000 * input_aed_per_1k
        + Decimal(tokens_out) / 1000 * output_aed_per_1k
    )
    return cost.quantize(Decimal("0.0001"))
