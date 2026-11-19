# Hiwar

Hiwar (حوار) lets a business build AI agents, install them on its website as a chat widget, watch every conversation live, and let staff take over from the AI and hand back. The documentation starts at [docs/README.md](docs/README.md); the requirements are the [feature specs](docs/01-product-requirements/specs/README.md).

## Where things are

| Path | Holds |
| --- | --- |
| `apps/web` | Next.js application: public site, control panel, operator portal with the AI capabilities, widget and its API, platform MCP server, domain logic, database schema |
| `services/agent` | Hiwar's agent service: one widget turn, customer knowledge ingestion and retrieval |
| `services/ai-agent` | The AI capabilities module's agent service and Temporal workers (platform agents, runs, ingestion) |
| `services/connectors`, `services/sandbox` | MCP connector runtime and per-run sandboxes for skill scripts (AI module) |
| `services/modelstub` | Deterministic OpenAI-compatible model for local runs and tests |
| `packages/` | The AI module's JSON contracts and bundled skills |
| `infra/` | kind cluster, platform charts (helmfile), the `hiwar` Helm chart, gateway and policies |
| `compose.yaml` | PostgreSQL 18 with pgvector, Mailpit, the model stub and the agent service, for running the web application on the host |
| `docs/` | Documentation |

## Getting started

The platform runs on Kubernetes: `make kind-up PROFILE=core` then `make seed` brings everything up locally on kind ([deployment](docs/08-devops-and-deployment/deployment.md)). For day-to-day work on the web application, the compose setup below is lighter.

Requirements: Node.js 22 or later, Docker Desktop, and `uv` for working on the agent services.

```bash
docker compose --profile agent --profile payments up -d --build      # PostgreSQL, Mailpit (http://localhost:8025), model stub, agent service
cd apps/web
npm install
cp .env.example .env.local                        # local defaults; set ALLOW_PRIVATE_EGRESS=1 to verify localhost origins
npm run db:migrate
npm run db:seed:all                               # the AI module seed and the Gulf Bites demo organization
npm run dev                                       # http://localhost:3000
```

Sign up at `/sign-up`; the verification email arrives in Mailpit. The demo organization's accounts use the password `demo-password-1` (for example `noura.demo@gulfbites.example`). To try the widget locally, create a deployment, add `http://localhost:3000/demo-site/<public key>` as an allowed origin, verify it and make the deployment live, then open that address.

Give a staff account access to the operator portal at `/ops`, including the AI capabilities at `/ops/ai`, with `npm run ops:grant -- <email> platform_admin`.

## Checks

```bash
cd apps/web && npm run typecheck && npm run lint && npm test     # tests need the compose database running
cd services/agent && uv run ruff check src tests && uv run pytest
```
