# Tech stack

| Item | Value |
| --- | --- |
| Purpose | Every technology the platform uses, the version an install actually gets, where it is declared and why it is there |
| Audience | Developers, architects, operations |
| Related | [Architecture overview](overview.md) · [Stack decisions](../03-decisions/stack-decisions.md) · [versions.lock.md](../../versions.lock.md) · [Deployment](../08-devops-and-deployment/deployment.md) · [Conventions](../10-user-and-developer-guides/conventions.md) |
| Last verified against code | 2026-10-29 (`apps/web/package-lock.json`, `services/*/uv.lock`, `infra/`) |

Versions are the **resolved** versions in the lock files, chart values and Dockerfiles at commit
`68fff99`, not the declared ranges. Image digests and licences are recorded in
[versions.lock.md](../../versions.lock.md), which `scripts/versions-lock.sh` refreshes.

## Principles

From the stack specification §1 (archived), with how the code stands.

| # | Principle | Effect on the stack | Status |
| --- | --- | --- | --- |
| SP-1 | Two application runtimes | **Next.js (TypeScript)** for UI and domain logic; **Python** for the agent harness, Temporal workers and knowledge ingestion. | Holds. |
| SP-2 | One relational engine | **PostgreSQL** holds domain data, passage vectors (pgvector), Temporal state and Phoenix traces, in one cluster with separate databases. | Holds. |
| SP-3 | Standards over proprietary formats | MCP, Agent Skills, AG-UI, CopilotKit, OpenAI-compatible model API, A2A, Gateway API, S3 API, OpenTelemetry. | Holds, except A2A, which nothing uses. |
| SP-4 | One gateway for AI traffic | Every model call goes through **agentgateway**. MCP-connector and A2A traffic are this principle's design target, not its current state. | Holds for agent and service model calls. A model connection test calls the provider directly through the egress proxy (`lib/model-probe.ts`), so a connection no route uses yet can be tested. |
| SP-5 | Durable by default | Every agent run, schedule and ingestion job is a Temporal workflow. | Holds. |
| SP-6 | Minimum moving parts | A component is in the stack only if no component already present can do the job. Infrastructure concerns (networking, certificates, secrets, logging, metrics, node hardening) belong to the cluster platform, not to Mirqah. | Holds. |
| SP-7 | Pin everything | Images by digest, packages in lock files, versions recorded in `versions.lock.md`. | ⚠ Conflicts with the project rule in `CLAUDE.md` ("Never use exact `X.Y.Z`, digest, or commit-SHA pins in declarations"). Today base images are digest-pinned in the Dockerfiles of the web app and the four services, chart images by tag, and `react` and `react-dom` are exact pins in `apps/web/package.json`. Unresolved: needs an owner decision. |
| SP-8 | One orchestration model | Kubernetes in every environment, with kind locally. | Holds. |

## Runtimes

| Runtime | Version | Declared in | Note |
| --- | --- | --- | --- |
| Node.js | 24.11.0 in the image; `>=20.9.0` in the manifest | `apps/web/Dockerfile`, `apps/web/package.json` `engines` | CI's `setup-node` reads `engines`, so CI and the image can run different Node majors. ⚠ Recorded as a conflict; see [Version conflicts](#version-conflicts) |
| Python | 3.12.12 in the image; `==3.12.*` in the manifests | `services/*/Dockerfile`, `services/*/pyproject.toml` | All four services. The sandbox workspace image (`services/sandbox/workspace/Dockerfile`) uses `python:3.12-slim-bookworm` and `node:24-bookworm-slim` by tag (D209) |
| uv | 0.12.9 in the images; unpinned in CI | `services/*/Dockerfile`, `.github/workflows/verify.yml` | Python package manager |
| npm | from the Node image | `apps/web/package-lock.json` (lockfile v3) | No workspaces, no root `package.json` |
| PostgreSQL | 18.6 (cluster); `postgres:18` (CI and `make dev-local`) | `infra/charts/cnpg-clusters/values.yaml`, `scripts/dev-local.sh` | SD-2 |

## Web application (`apps/web`)

| Concern | Technology | Version | Why it is used |
| --- | --- | --- | --- |
| Framework | Next.js App Router, standalone output, Cache Components | 16.4.3 | Console, domain logic, route handlers and server actions in one codebase (AD-02) |
| UI library | React, React DOM | 19.3.0 | |
| Language | TypeScript, strict | 5.9.3 | |
| Design system | Tahseel Design System, vendored | as handed off | Tokens, components, icons, RTL (AD-04); `npm run ds:generate` builds `src/ds/generated/` from it |
| Data access | Drizzle ORM, drizzle-kit, `pg` | 0.45.4, 0.31.11, 8.17.0 | Typed schema and SQL migrations on PostgreSQL (SD-1) |
| Validation | Zod | 4.6.7 | Zod at server-action boundaries; request attribute values are checked by `attributeProblem` (`features/requests/attributes.ts`, D304). `ajv` 8.20.0 and `ajv-formats` 3.0.1 are declared in `package.json` and imported nowhere |
| Authentication | Auth.js v5 (`next-auth`), `@auth/drizzle-adapter`, `@simplewebauthn/server` and `/browser` | 5.0.0-beta.32, 1.11.3, 14.0.3 and 14.0.0 | Reads the server-side sessions in PostgreSQL that the console's password and UAE PASS sign-ins open (D387); passkeys (AD-17). `next-auth` is a beta |
| Run tokens | `jose` | 6.2.12 | Signs and verifies the per-run JWTs |
| Agent UI | `@copilotkit/react-core`, `@copilotkit/runtime` (v2 entry points), `@ag-ui/client` | 1.79.1, 1.79.1, 1.0.2 | The assistant panel and the runtime route (AD-05, SD-10); upgraded together |
| MCP server | `@modelcontextprotocol/sdk` (Streamable HTTP, stateless) | 1.32.1 | The platform MCP server at `/api/mcp` (D86) |
| Temporal client | `@temporalio/client` | 1.24.0 | Schedules for scheduled work items |
| Cache and live updates | `iovalkey` | 0.4.0 | Valkey pub/sub for SSE channels, run event replay, the mail job stream |
| Object storage | `@aws-sdk/client-s3` | 3.1149.0 | S3 API only, path-style |
| Kubernetes | `@kubernetes/client-node` | 2.0.0 | Renders and applies agentgateway `AgentgatewayModel` routes |
| Logging | pino | 10.4.0 | Structured JSON to stdout |
| HTTP client | undici | 8.12.3 | Requests to the internet through the egress proxy (`lib/egress.ts`, D234) |
| Mail | nodemailer | 10.2.1 | The platform's SMTP sends: system notifications and test emails (D240) |
| Rich text | @tiptap/react, @tiptap/starter-kit, @tiptap/pm | 3.32.0 | The email template editor (D247) |
| HTML sanitising | sanitize-html | 2.18.1 | Email template bodies, on save and on send (D247) |
| Markdown | react-markdown, remark-gfm | 10.1.0, 4.0.1 | Rendering agent and instruction text |
| Diagrams | `@xyflow/react` (React Flow), `@dagrejs/dagre` | 12.12.0, 3.1.3 | The request type's read-only workflow view, laid out by dagre (D317) |
| Other | uuidv7 1.0.2, yaml 2.9.1, fflate 0.8.3 (skill zips), html-to-image 1.11.13 (dashboard card capture) | | |
| Lint | ESLint with `eslint-config-next` | 9.39.5, 16.4.3 | `npm run lint` |
| Unit and database tests | Vitest; `happy-dom` for interaction tests | 4.1.12; 21.0.4 | `npm test`; `happy-dom` is switched on per test file (R13, D198) |
| Browser tests | Playwright | 1.64.0 | `npx playwright test` in `tests/` (`npm run test:e2e` from the repository root); ten browser and viewport projects, an `api` project, a `setup` project and a `live` project (`tests/AGENTS.md`) |
| Script runner | tsx | 4.23.15 | Migrations and seeds |

`rxjs` (7.8.1) and `@ag-ui/core` (1.0.2) are imported by `src/agents/middleware.ts` but are not
declared in `package.json`; they resolve only as transitive dependencies.

## Python services (`services/*`)

| Concern | Technology | Version | Service | Why it is used |
| --- | --- | --- | --- | --- |
| HTTP | FastAPI, Uvicorn, Starlette | 0.143.0, 0.41.0, 1.7.0 / 1.8.0 | all | Service APIs; Starlette differs per lock file |
| Models and settings | Pydantic, pydantic-settings | 2.14.0, 2.15.0 | all | |
| Agent loop | `pydantic-ai-slim` with extras `ag-ui`, `mcp`, `openai`, `temporal` | 2.57.0 | agent | The agent loop, `MCPToolset`, `ToolSearch`, `ResolveModelId`, `TemporalDurability` (D01, D87, D137) |
| Agent capabilities | `pydantic-ai-harness` | 0.57.0 | agent | `ClearToolResults` and `SummarizingCompaction` on the mission (D137); `Skills(...).load()` for granted skills (D127); the spend and guardrail modules are wrapped in `harness/spend.py` and `harness/guardrails.py`, which no mission path calls (agent-runtime spec conflicts 4 and 7). 0.x: verify every API against the installed version |
| MCP client and server | `mcp`; `fastmcp-slim` client transport | 1.30.0; 3.4.0 | `mcp`: agent, connectors (declared but not imported in sandbox); `fastmcp-slim`: agent | Streamable HTTP to the platform MCP server; stdio and HTTP to connectors; the connector bridge's MCP server |
| Durable execution | `temporalio` | 1.34.0 | agent | Workers for the four task queues; AES-GCM payload codec with key rotation (D81, D204); `ExternalStorage` with its S3 driver for payloads of 32 KiB or more (D287) |
| Model client | `openai` | 3.28.0 | agent | OpenAI-compatible calls to agentgateway |
| Knowledge graph | `graphiti-core`, `neo4j` driver | 0.30.2, 5.28.6 | agent | Graph retrieval (SD-9) |
| Vector store | `psycopg` with pool, `pgvector` | 3.3.6, 0.5.1 | agent | Passage index in `mirqah_kb` (SD-8) |
| Object storage | `boto3` | 1.43.111 | agent | Raw documents, uploaded skill packages (D206), Temporal payloads in `run-payloads` (D287) |
| Cache and streams | `valkey` | 6.1.1 | agent | Run event streams (`run:<id>:agui`) |
| Tracing | `opentelemetry-sdk`, OTLP HTTP exporter, `arize-phoenix-otel`, `openinference-semantic-conventions` | 1.45.1, 1.45.1, 0.17.2, 0.1.41 | agent | Traces to Phoenix; trace id = run id |
| Logging | structlog | 25.5.0 | all | Structured JSON to stdout |
| Tokenising | tiktoken | 0.12.0 | agent | Chunk sizing; `cl100k_base` baked into the image |
| Kubernetes | `kubernetes` | 35.0.0 | connectors, sandbox | Creating connector and sandbox Pods |
| Parsing, OCR, PII (`parsers` extra, installed in the image) | docling, pypdf, python-docx, openpyxl, python-pptx, reportlab, pytesseract, presidio-analyzer and -anonymizer, spaCy `en_core_web_sm`, arabic-reshaper, python-bidi | 2.137.0, 6.20.0, 1.2.0, 3.1.5, 1.0.2, 4.5.1, 0.3.13, 2.2.364 and 2.2.362, 3.8.0, 3.0.1, 0.6.12 | agent | Document parsing and OCR for ingestion, document generation (Arabic PDF shaping and right-to-left order, D152), PII masking in ingestion. Tesseract with Arabic and English is installed by apt |
| Quality | ruff, mypy (strict), pytest, pytest-asyncio | 0.15.22, 1.20.2, 9.1.1, 1.4.0 | all | `scripts/verify.sh` runs all three in every service |

## Platform services

| Component | Version | Deployed by | Why it is used |
| --- | --- | --- | --- |
| PostgreSQL via CloudNativePG | PostgreSQL 18.6; operator chart 0.26.0 (operator 1.27.0) | `infra/charts/cnpg-clusters`, helmfile release `mirqah-pg` | System of record and the four other databases (AD-03, AD-16) |
| Valkey | 8.1.3 (`bitnamilegacy/valkey`), chart 3.0.26 | helmfile release `valkey` | Fan-out, streams, rate limits (AD-15) |
| Neo4j Community | 5.26.0, chart 5.26.0 | helmfile release `neo4j`, `full` profile only | Graphiti graph store (AD-13) |
| Object storage | MinIO `2025.7.23` locally (chart 17.0.21); Rook Ceph 1.21.0 in Test and Live | helmfile releases `minio` (`NO_ROOK=1`) or `rook-ceph` (`NO_ROOK=0`) | S3 API storage (AD-14) |
| Temporal | server 1.29, UI 2.40.1, chart 0.68.0 | helmfile release `temporal` | Durable execution (SP-5) |
| Arize Phoenix | 20.20.0 | `infra/charts/phoenix`, `full` profile only | LLM traces (AD-12) |
| agentgateway | 1.6.0 | helmfile release `agentgateway` | LLM gateway (AD-11) |
| Traefik | chart 41.7.1 (Traefik 3.7.14), Gateway API v1.5.1 | `infra/kind/bootstrap.sh` | North–south ingress |
| cert-manager | v1.19.1 | `infra/kind/bootstrap.sh` | Certificates (local self-signed CA) |
| Cilium | 1.17.8 | `infra/kind/bootstrap.sh` | CNI that enforces NetworkPolicy on kind |
| Squid egress proxy | `ubuntu/squid:6.13-25.04_edge` | `infra/charts/mirqah` | Egress allow-list |
| UAE PASS | staging `stg-id.uaepass.ae` (sandbox client `sandbox_stage`), production `id.uaepass.ae` | `features/auth/uae-pass.ts` | Sign-in (D387); reached through the egress proxy |
| Local mail sink | `axllent/mailpit:v1` | `infra/kind/mailpit.yaml` | Receives the platform's SMTP email on kind (D240) |
| Adminer, RedisInsight | `latest` (unpinned) | `infra/platform/admin-tools.yaml` | Data-tier consoles, behind the admin IP allowlist (D225) |
| Local image registry and its browser | `registry:3.0.0`, `joxit/docker-registry-ui:2.6.0` | `infra/kind/bootstrap.sh` | Local only; Test and Live use the platform team's registry |

## Stack to screen

From the stack specification §15, corrected to the code.

| Screen group | Main components |
| --- | --- |
| Shell, profile, sign-in | Next.js, Tahseel DS, Auth.js, the project's `translate()` helper, CopilotKit (page assistant) |
| Dashboard, records, inbox | PostgreSQL, Valkey SSE, Temporal signals through the agent service |
| Projects, work items, requests, schedules | PostgreSQL `jsonb`, Temporal Schedules |
| Discussion rooms | `startRun` from the room's message service, Valkey channels and run streams over SSE (D161), the Decision route `agent-choice` for Autonomous rooms (D290), the generic runtime |
| Artifacts, files | Object storage (S3), PostgreSQL metadata |
| Agents, run viewer | Generic runtime, Temporal, Phoenix |
| Skills | Skill import and scan in `web`, object storage, sandbox pods |
| Connectors | `services/connectors`, connector bridge pods |
| Memory | Platform MCP memory tools, PostgreSQL versions |
| Knowledge | Graphiti (Neo4j), pgvector (`mirqah_kb`), docling, Presidio |
| Models & routes | agentgateway model routes rendered by `web` |
| Channels, embedded deployment, widget, visitor conversations | Channel gateway in `web`, the widget frame and API under `/embed/v1` (D231), Valkey channels for live transcripts (D342), Traefik public routes |
| Settings → Email | nodemailer over SMTP, the Valkey stream `mirqah:mail`, TipTap and sanitize-html for templates (D240, D247) |
| Budgets | Platform pricing estimate and PostgreSQL; no money ceiling (D73) |
| Integrations | Platform MCP server and the integration AG-UI route, both in `web` |
| System | `/api/health` across `web`, agent service, Temporal, agentgateway, Phoenix, PostgreSQL, Neo4j, Valkey, object storage |

## Named in the stack specification but not used

| Item | Stack specification says | Code |
| --- | --- | --- |
| next-intl | i18n library | Not installed; own helper (D-1 in [stack.md](../03-decisions/stack-decisions.md)) |
| React Hook Form, TanStack Query | Forms and server state | Not installed |
| Recharts | Charts | Not installed |
| React Flow | Org chart and storyline map | Installed for the request type workflow view only (D317); the org chart and storyline map do not use it |
| MDXEditor | Markdown editing | Not installed |
| date-fns with `@date-fns/tz` | Working calendar, SLA | Not used: the working and school calendar is `apps/web/src/lib/calendar.ts` on `Intl` time zones (M-007a, `decision-log.md` #50) |
| Testing Library | Component tests | Not installed; screens are tested by first-render snapshots and by interaction tests in `happy-dom` (R13, D198) |
| pnpm, Prettier, oxlint | Toolchain | npm is used; no Prettier or oxlint config is wired in (`apps/web/eslint.config.mjs` uses only `eslint-config-next`). The vendored `_adherence.oxlintrc.json` is not run, which NFR-32 relies on |
| `@aws-sdk/s3-request-presigner` | Presigned URLs (versions.lock.md) | Not installed; file bytes are served by `/api/files` |
| A2A | Agent-to-agent standard | No code |
| Pydantic AI durable execution "not used" | Stack specification §5.4 | Superseded: `TemporalDurability` is the durability layer (D04, D87) |

## Version conflicts

| Item | Recorded elsewhere | Lock file or code | Where recorded |
| --- | --- | --- | --- |
| fastapi | 0.121.x | 0.143.0 | versions.lock.md "Major packages" |
| pydantic-ai-slim | 2.55.x | 2.57.0 | versions.lock.md |
| `@simplewebauthn/server`, `/browser` | 9.x | 14.0.3, 14.0.0 | versions.lock.md |
| pydantic-ai-harness | absent | 0.57.0 | versions.lock.md has no row |
| next | 16.4.0 | 16.4.3 | versions.lock.md "Major packages" |
| `@copilotkit/react-core`, `@copilotkit/runtime` | 1.78.0 | 1.79.1 | versions.lock.md "Major packages" |
| model-engine base image | listed only for agent, sandbox-manager, connector-runtime | `services/modelstub/Dockerfile` uses the same Python base | versions.lock.md "Application base images" |
| Node.js | engines `>=20.9.0`, `@types/node ^20` | image 24.11.0 | `apps/web/package.json` against `apps/web/Dockerfile` |

`versions.lock.md` is maintained partly by a script; these rows need updating there.
