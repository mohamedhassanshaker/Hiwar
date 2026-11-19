"""The tools the harness itself provides, on top of the MCP servers.

They are offered to every agent and are executed inside the harness rather than over MCP:
the memory tool, knowledge retrieval, the context handoff, asking a person and delegation.

Loading a skill is not among them: the model loads a granted skill, and reads its files,
with `skill_load` and `skill_file_read`, which come with the skill rather than a grant (D377).
"""

from __future__ import annotations

from awp_agent.harness.types import ToolSpec, ToolTier

MEMORY_SEARCH = "memory_search"
REQUEST_READ = "request_read"
WORK_ITEM_READ = "work_item_read"
FILE_SEARCH = "file_search"
PAGE_READ = "page_read"
MY_ATTENTION = "my_attention"
MEMORY_WRITE = "memory_write"
KNOWLEDGE_SEARCH = "knowledge_search"
WRITE_HANDOFF = "write_handoff"
ASK_PERSON = "ask_person"
DELEGATE = "delegate_to_agent"
GENERATE_DOCUMENT = "generate_document"
ARTIFACT_CREATE = "artifact_create"
SKILL_SCRIPT_RUN = "skill_script_run"
WORKSPACE_FILE_WRITE = "workspace_file_write"
WORKSPACE_FILE_READ = "workspace_file_read"
WORKSPACE_FILE_SAVE = "workspace_file_save"
#: Offered with any granted skill, which is their grant; answered in `mission/skill_files.py`.
SKILL_LOAD = "skill_load"
SKILL_FILE_READ = "skill_file_read"

BUILTIN_SERVER = "harness"

#: The built-ins the harness answers itself, which never reach the platform MCP server.
#:
#: Every other built-in is a platform tool wearing the harness's label: `_run_builtin`
#: rewrites its server to the platform one and calls it over MCP like any other. That
#: distinction decides which of them a run's grant has to cover — a tool the platform
#: never sees cannot be granted or refused there, and one it does see must be granted or
#: the model is being offered something its token will refuse (D37).
#:
#: `ask_person`, `delegate_to_agent` and `write_handoff` are intercepted in the workflow
#: before `tool_call` runs at all; `knowledge_search` retrieves locally; and
#: `generate_document` renders a file that belongs to nobody until `artifact_create` is
#: told to keep it. The `skill_script_run` and `workspace_file_*` tools work in the run's
#: sandbox (`mission/sandbox.py`).
HARNESS_RUN_TOOLS: frozenset[str] = frozenset(
    {
        KNOWLEDGE_SEARCH,
        GENERATE_DOCUMENT,
        ASK_PERSON,
        DELEGATE,
        WRITE_HANDOFF,
        SKILL_SCRIPT_RUN,
        WORKSPACE_FILE_WRITE,
        WORKSPACE_FILE_READ,
        WORKSPACE_FILE_SAVE,
    }
)

BUILTIN_TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name=MEMORY_SEARCH,
        description="Search the memory scopes this agent may read.",
        parameters_json_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}},
            "required": ["query"],
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=MEMORY_WRITE,
        description="Remember a fact in a writable memory scope. It is reviewed before reuse.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "scope": {"type": "string"},
                "content": {"type": "string"},
                "confidence": {"type": "number"},
            },
            "required": ["scope", "content"],
        },
        tier=ToolTier.T1,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=KNOWLEDGE_SEARCH,
        description=(
            "Retrieve cited passages from the agent's knowledge collections. Leave "
            "`collection_id` out to search every collection this agent is granted; set it "
            "to narrow to one, naming an id from the Knowledge index rather than a guess."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "collection_id": {"type": "string"},
                "mode": {"type": "string", "enum": ["Vector", "Graph", "Hybrid"]},
            },
            "required": ["query"],
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=ASK_PERSON,
        description="Ask the person a question and wait for the answer.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                # The answers this question will accept. A person picks one instead of
                # typing, and the run gets back something it can act on.
                "options": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["question"],
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=DELEGATE,
        description=(
            "Hand part of this task to another agent and wait for its answer. `agent_code` "
            "names one of the real agents in the Agent index, never a skill id."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "agent_code": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["agent_code", "title"],
        },
        tier=ToolTier.T1,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=GENERATE_DOCUMENT,
        description=(
            "Render structured content into a real Word, Excel, PowerPoint or PDF file and "
            "return it as base64. This tool only renders the file; it does not attach it to "
            "anything — pass what it returns to `artifact_create` over the platform MCP "
            "server to actually save it against a work item, a request or a room."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "format": {"type": "string", "enum": ["docx", "xlsx", "pptx", "pdf"]},
                "title": {"type": "string"},
                "sections": {
                    "type": "array",
                    "description": "For docx and pdf: the document's blocks, in order.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "heading": {"type": "string"},
                            "level": {"type": "integer", "minimum": 1, "maximum": 3},
                            "paragraph": {"type": "string"},
                            "bullets": {"type": "array", "items": {"type": "string"}},
                            "table": {
                                "type": "object",
                                "properties": {
                                    "headers": {"type": "array", "items": {"type": "string"}},
                                    "rows": {
                                        "type": "array",
                                        "items": {"type": "array", "items": {"type": "string"}},
                                    },
                                },
                            },
                        },
                    },
                },
                "sheets": {
                    "type": "array",
                    "description": "For xlsx: one entry per worksheet.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "headers": {"type": "array", "items": {"type": "string"}},
                            "rows": {"type": "array", "items": {"type": "array"}},
                        },
                    },
                },
                "slides": {
                    "type": "array",
                    "description": "For pptx: one entry per slide after the title slide.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "bullets": {"type": "array", "items": {"type": "string"}},
                        },
                    },
                },
            },
            "required": ["format", "title"],
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=ARTIFACT_CREATE,
        description=(
            "Save a generated file as a versioned artifact in a project, optionally attached "
            "to a work item, a request or a room. Pass `generate_document`'s own output "
            "straight through — its file_name, mime_type and content_base64 — rather than "
            "re-encoding it."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "project_key": {"type": "string"},
                "title_en": {"type": "string"},
                "title_ar": {"type": "string"},
                "file_name": {"type": "string"},
                "mime_type": {"type": "string"},
                "content_base64": {"type": "string"},
                "linked_to_type": {"type": "string", "enum": ["WorkItem", "Request", "Room"]},
                "linked_to_key": {"type": "string"},
                "run_id": {"type": "string"},
            },
            "required": [
                "project_key",
                "title_en",
                "title_ar",
                "file_name",
                "mime_type",
                "content_base64",
            ],
        },
        tier=ToolTier.T1,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=REQUEST_READ,
        description=(
            "Read one request in full: its description, attributes, the step it is at and "
            "every step of its flow, its attachments, and its whole history — each "
            "transition, comment and assignment. Call this before working a request's step."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=WORK_ITEM_READ,
        description=(
            "Read one work item in full: description, acceptance criteria, sub items, "
            "attachments, comments and history. The counterpart of `request_read`."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=FILE_SEARCH,
        description=(
            "Search the files and artifacts this run may read, by name or title. Use it to "
            "find an attachment before citing it; an empty query lists what there is."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=PAGE_READ,
        description=(
            "Read what is on a console screen, as that screen itself reads it. `path` is "
            "the console path the question is about. Use it to summarise or answer about "
            "the page the person is on, from its real content rather than its title."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=MY_ATTENTION,
        description=(
            "What is waiting on the person this run acts for, most blocking first: "
            "approvals and questions a run is paused on, SLA risks and reviews, mentions, "
            "then their own open work by due date. Each entry carries the path that opens "
            "it, so the answer can link to the thing rather than only name it."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 50}},
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
    ToolSpec(
        name=WRITE_HANDOFF,
        description="Write the context handoff: goal, decisions, open questions, next step.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "goal": {"type": "string"},
                "decisions": {"type": "array", "items": {"type": "string"}},
                "open_questions": {"type": "array", "items": {"type": "string"}},
                "next_step": {"type": "string"},
            },
            "required": ["goal", "next_step"],
        },
        tier=ToolTier.T0,
        server=BUILTIN_SERVER,
    ),
)

BUILTIN_NAMES: frozenset[str] = frozenset(tool.name for tool in BUILTIN_TOOLS)
