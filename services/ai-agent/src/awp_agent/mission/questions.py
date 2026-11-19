"""The platform half of a question a mission asks a person (D125).

`ask_person` comes back to the mission workflow unexecuted, the way an approval does. This
module is the crossing: it records the question in the person's Inbox through the
platform MCP server, and carries their answer back as a signal. The question is recorded
on the harness token, so the model cannot raise one by naming the plumbing tool.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from temporalio import activity

from awp_agent.clients import platform_mcp
from awp_agent.mission.stream import tell_panel

QUESTION_TOOL = "agent_question_create"


class QuestionField(BaseModel):
    """One value the question asks for, shown to the person as a field of a form (D252)."""

    name: str
    label: str = ""
    #: The values it may take, when it is a choice.
    options: list[str] = Field(default_factory=list)
    #: What the field holds until the person changes it.
    default: str = ""


class QuestionWanted(BaseModel):
    """One question the model asked, as the platform needs it to raise one."""

    run_id: str
    question: str
    options: list[str] = Field(default_factory=list)
    #: Several values asked at once. They reach the panel only; the platform's record keeps
    #: the question, and the answer comes back as text either way.
    fields: list[QuestionField] = Field(default_factory=list)
    harness_token: str = ""


class QuestionAnswer(BaseModel):
    """A person's answer, delivered to the waiting mission as a signal."""

    question_id: str
    answer: str
    answered_by: str = ""
    #: Fresh credentials the platform minted as it sent this, so a mission resumed after a
    #: long pause does not carry on with expired tokens (D82). Empty from an older platform.
    mcp_token: str = ""
    harness_token: str = ""


@activity.defn(name="create_question")
async def create_question(wanted: QuestionWanted) -> str:
    """Raise the Inbox question the mission waits on, and return its id.

    An empty id means the platform refused to record it, and the mission tells the model
    so rather than waiting for an answer that cannot come.
    """
    payload = await platform_mcp.call_tool(
        wanted.harness_token,
        QUESTION_TOOL,
        {"run_id": wanted.run_id, "question": wanted.question, "options": wanted.options},
    )
    question_id = str(payload.get("id", "")) if isinstance(payload, dict) else ""
    if question_id:
        # The person watching the run answers it where they asked (D239).
        await tell_panel(
            wanted.run_id,
            "awp.agent.question",
            {
                "questionId": question_id,
                "question": wanted.question,
                "options": wanted.options,
                "fields": [field.model_dump() for field in wanted.fields],
            },
        )
    return question_id
