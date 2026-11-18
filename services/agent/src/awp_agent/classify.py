"""Typed classification of what somebody wrote into a request (`UC-28.2-01` … `-06`).

The console lets a person describe what they need in their own words instead of filling a
form. Turning that into a request type and a set of attribute values is a model call, and
model calls belong here: the agent service owns the gateway, its routes and its budgets.

The route is the typesafe one (`classifier-typed` in the model catalogue), so the answer is
validated against a schema rather than parsed out of prose. Pydantic AI retries the model
when the output does not validate, which is the retry `UC-28.2-06` asks for; after that the
failure is reported and the console offers the template form instead.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, create_model
from pydantic_ai import Agent
from pydantic_ai.exceptions import UnexpectedModelBehavior

from awp_agent.clients import gateway_client
from awp_agent.logging import logger

log = logger("awp_agent.classify")

# The route alias the model catalogue publishes for typed classification.
CLASSIFIER_ROUTE = "classifier-typed"

# The Decision route a discussion room chooses its answering agent on (D290).
AGENT_CHOICE_ROUTE = "agent-choice"

# Below this the agent asks the person which type they meant rather than choosing for them.
CONFIDENCE_FLOOR = 0.72


class AttributeSpec(BaseModel):
    """One attribute of a candidate request type, as the console knows it."""

    key: str
    label: str
    data_type: str
    required: bool = False
    # A list attribute's allowed values; empty for every other type.
    options: list[str] = Field(default_factory=list)


class TypeSpec(BaseModel):
    """One request type the person is allowed to raise."""

    code: str
    name: str
    category: str = ""
    attributes: list[AttributeSpec] = Field(default_factory=list)


class ClassifyRequest(BaseModel):
    """What the console sends: the words, and the types they may be classified into."""

    text: str
    types: list[TypeSpec]
    locale: str = "en"


class RequestClassification(BaseModel):
    """The schema the typesafe route is held to.

    `type_code` empty means the model would not choose, which is `UC-28.2-04`: the console
    then asks the person to pick from `candidates`.
    """

    type_code: str = Field(
        default="", description="The code of the request type, or empty when unsure."
    )
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    title: str = Field(default="", description="A short title for the request.")
    attributes: dict[str, str] = Field(
        default_factory=dict, description="Extracted attribute values by key."
    )
    missing: list[str] = Field(
        default_factory=list, description="Keys of required attributes the text does not give."
    )
    candidates: list[str] = Field(
        default_factory=list, description="Type codes that also fit, when the choice is not clear."
    )
    question: str = Field(
        default="", description="What to ask the person when something is missing or unclear."
    )


INSTRUCTIONS = """You classify what a person wrote into one of the request types you are given.

Rules:
- Choose only from the request types supplied. Never invent a code.
- Extract a value for every attribute you can support from the text. Do not guess values the
  text does not contain; list those keys in `missing` instead.
- A required attribute with no value in the text belongs in `missing`, and `question` should
  ask for exactly those.
- When two or more types fit about equally, leave `type_code` empty, put their codes in
  `candidates`, and ask which one in `question`.
- `confidence` is how sure you are of `type_code`, from 0 to 1.
- Answer in the person's language for `title` and `question`.
"""


def _catalogue(types: list[TypeSpec]) -> str:
    """The candidate types as the prompt states them, including what each one needs."""
    lines: list[str] = []
    for spec in types:
        attributes = ", ".join(
            f"{attribute.key} ({attribute.data_type}{', required' if attribute.required else ''}"
            f"{', one of: ' + ' | '.join(attribute.options) if attribute.options else ''})"
            for attribute in spec.attributes
        )
        lines.append(
            f"- {spec.code}: {spec.name} [{spec.category}] attributes: {attributes or 'none'}"
        )
    return "\n".join(lines)


async def classify(request: ClassifyRequest) -> RequestClassification:
    """Classify one piece of text, or raise when the route cannot produce valid output.

    :raises UnexpectedModelBehavior: the typesafe route did not return valid output after
        its retries, which the console turns into an offer to use the template form.
    """
    agent: Agent[None, RequestClassification] = Agent(
        gateway_client.model_for_route(CLASSIFIER_ROUTE),
        output_type=RequestClassification,
        instructions=INSTRUCTIONS,
        retries=2,
    )
    prompt = (
        f"Request types available:\n{_catalogue(request.types)}\n\n"
        f"The person wrote (language: {request.locale}):\n{request.text}"
    )
    result = await agent.run(prompt)
    return hold_to_catalogue(result.output, {spec.code for spec in request.types})


def hold_to_catalogue(answer: RequestClassification, known: set[str]) -> RequestClassification:
    """What the service does with an answer it cannot act on.

    A code the catalogue does not contain is the same as no choice at all: the console must
    never be told to submit against a type that does not exist. `UC-28.2-04`: below the
    route's confidence floor the person chooses, and the model's guess becomes a candidate.
    """
    if answer.type_code and answer.type_code not in known:
        log.warning("classify.unknown_type", proposed=answer.type_code)
        answer.candidates = [code for code in answer.candidates if code in known]
        answer.type_code = ""

    if answer.type_code and answer.confidence < CONFIDENCE_FLOOR:
        others = [code for code in answer.candidates if code != answer.type_code]
        answer.candidates = [answer.type_code, *others]
        answer.type_code = ""

    return answer


async def classify_or_none(request: ClassifyRequest) -> dict[str, Any] | None:
    """`UC-28.2-06`: the classification, or `None` when the route could not produce one."""
    try:
        return (await classify(request)).model_dump()
    except UnexpectedModelBehavior as problem:
        log.warning("classify.invalid_output", problem=str(problem))
        return None
    except Exception as problem:  # noqa: BLE001 - the console falls back to the form
        log.warning("classify.failed", problem=str(problem))
        return None


class AgentSpec(BaseModel):
    """One agent in a discussion room that could answer the message."""

    code: str
    name: str
    #: The opening of the agent's instructions: what it is for.
    purpose: str = ""


class ChooseAgentRequest(BaseModel):
    """A person's room message, the conversation before it, and the room's agents."""

    text: str
    agents: list[AgentSpec] = Field(min_length=2)
    conversation: list[str] = Field(default_factory=list)


CHOOSE_INSTRUCTIONS = (
    "Which one agent in this discussion room should answer the person's message? Choose the "
    "agent whose purpose fits the message best; when the message continues the conversation, "
    "prefer the agent already handling that subject."
)


async def choose_agent(request: ChooseAgentRequest) -> str:
    """The code of the room agent that answers the message (D289, D290).

    One `choice` question on the Decision route, one option per agent. The answer is validated
    against a type that allows only the given codes, so the route cannot name an agent that is
    not in the room.

    :raises pydantic.ValidationError: the route answered with no valid choice.
    """
    codes = tuple(spec.code for spec in request.agents)
    choice = create_model(
        "AgentChoice",
        choice=(Literal[codes], ...),  # type: ignore[arg-type]
        confidence=(float, Field(default=0.0, ge=0.0, le=1.0)),
    )
    answers = await gateway_client.decide(
        AGENT_CHOICE_ROUTE,
        state={"message": request.text, "conversation": request.conversation[-6:]},
        questions={
            "agent": {
                "type": "choice",
                "instructions": CHOOSE_INSTRUCTIONS,
                "criteria": {
                    spec.code: f"{spec.name}. {spec.purpose}".strip() for spec in request.agents
                },
            }
        },
    )
    answer: Any = choice.model_validate(answers.get("agent"))
    log.info("classify.agent_chosen", agent=answer.choice, confidence=answer.confidence)
    code: str = answer.choice
    return code
