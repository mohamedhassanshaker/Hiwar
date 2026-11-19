# `services/agent`

The agent service: the AG-UI run endpoints, the generic agent runtime every agent runs on, the
Temporal workers, knowledge ingestion and retrieval, and the scheduled work-item firing.

How it fits into the platform is described in
[docs/03-architecture/ai-platform.md](../../docs/03-architecture/ai-platform.md); what a mission does
is specified in [docs/03-architecture/agent-runtime-spec.md](../../docs/03-architecture/agent-runtime-spec.md).

## What runs where

One image, two kinds of process.

| Process | Command | What it does |
| --- | --- | --- |
| `agent-service` | `uvicorn awp_agent.main:app` (port 8000) | `/agui/runs/*`, `/ingestion/runs/*`, `/knowledge/retrieve`, `/classify/request`, `/documents/extract`, `/healthz`. Starts missions, streams their AG-UI events from Valkey, delivers approvals, answers and cancellations as signals. Stateless. |
| `agent-worker` | `python -m awp_agent.worker <task-queue>` (console script `awp-agent-worker`) | One process per queue: `agent-runs`, `ingestion`, `maintenance`. Health on `AWP_WORKER_HEALTH_PORT` (8010). |

In development, `AWP_WORKER_IN_PROCESS=1` makes the API process serve the `agent-runs` queue too,
so one container is enough.

## Layout

```
src/awp_agent/
  main.py                FastAPI app (`awp_agent.main:app`)
  worker.py              Temporal worker entry point (`awp-agent-worker`); registers PydanticAIPlugin
  wait_for.py            dependency wait used by the Helm init containers
  config.py, logging.py, tracing.py   settings, logging, OTLP traces (trace id = run id)
  classify.py            request classification for agentic request entry
  api/                   FastAPI routers: runs, ingestion, knowledge, classification,
                         documents, health, the shared Temporal client
  mission/               the one agent every run executes (D87)
    runtime.py           Agent "awp-mission" and MissionWorkflow
    deps.py              MissionDeps, the per-run configuration
    tools.py             generate_document and write_handoff
    sandbox.py           skill-script and workspace tools in the run's sandbox Pod
    skills.py            granted skills read into the instructions
    approvals.py         create_approval activity (approval_create on the harness token)
    questions.py         ask_person and the create_question activity
    delegation.py        delegate_to_agent and the register_child_mission activity
    stream.py            the mission's AG-UI events to Valkey
    timeline.py          the run-viewer timeline built from the mission's messages
  clients/               the services a mission reaches
    platform_mcp.py      platform MCP server, the only path to domain data
    gateway_client.py    agentgateway: base URL, embeddings, health, cost estimate
    object_store.py      S3 client
    events.py            AG-UI event stream per run on Valkey (run:<id>:agui)
  temporal/              Temporal plumbing
    codec.py             AES-GCM payload codec (TEMPORAL_CODEC_KEY)
    storage.py           large payloads kept in object storage (D287)
  harness/
    types.py             the wire contract with the web app
    capabilities.py      compaction and other capability factories
    activities/          finalize (writes the outcome back), approvals (open_trace),
                         verify (step_contract), credentials (run_token_refresh)
    tools/               builtin.py (harness tool specs), document_builder.py (Word, Excel,
                         PowerPoint and PDF rendering)
    guardrails.py, spend.py, profiles/, hooks/, skills/
  ingestion/             IngestionWorkflow: parse, normalise, mask, chunk, pgvector index,
                         Graphiti graph, retrieval
  maintenance/           ScheduleFireWorkflow for scheduled work items
tests/                   one folder per package above (mission/, harness/, ingestion/,
                         maintenance/, temporal/); cross-cutting tests and conftest.py at the top
```

**Functions without a caller.** `harness/skills/loader.py`, `harness/spend.py`,
`gateway_client.call_settings` and part of `harness/capabilities.py` belonged to the deleted
hand-rolled loop and have no caller on the mission path. They and the gaps they leave are listed in
[the runtime conflicts](../../docs/03-architecture/agent-runtime-spec.md#-unresolved-conflicts-with-the-code).

## Rules this package keeps

- **No domain database.** Every read and change of domain data goes through the platform MCP
  server under the run's token. The package owns only the `awp_kb` passage index.
- **Model calls go through agentgateway.** No provider SDK is called directly.
- **Workflows are deterministic.** Everything that touches the world is an activity, and a workflow
  reads no environment: every URL a mission needs is carried in its deps (D119).

## Commands

```bash
uv sync                          # install, including the dev group
uv run ruff check .              # lint
uv run mypy --strict src tests   # type-check, as scripts/verify.sh runs it
uv run pytest -q                 # tests
```

The `parsers` extra (docling, Presidio, Tesseract bindings, spaCy) is installed in the image
(`uv sync --frozen --no-dev --extra parsers`), not by a plain `uv sync`: it pulls a large native
stack. `ingestion/parsing.py` imports docling lazily and raises when it is missing; it reads
`.xls` with xlrd (ADR-0002) and refuses `.ppt` with the format to save it as. `POST /documents/extract`
also reads a `.zip`, file by file (`ingestion/archives.py`: at most 50 files and 100 MB of contents,
no nested archives); knowledge ingestion does not open archives. `harness/guardrails.py` loads Presidio lazily for name and IP detection and uses the
`pydantic-ai-harness` pattern detectors for the rest.
