---
title: Tech stack
status: draft
owner: architect
related: [overview.md, solution-design.md, ../00-input-requirements/tech-stack.md]
version: 0.2
last-updated: 2026-11-19
---

# Tech stack

The target is [the owner's tech stack](../00-input-requirements/tech-stack.md). The AI capabilities come from the TAWP AI capabilities module (`ai-capabilities-module.zip`), merged into this repository. This page records what is in place and where it differs from the target.

| Area | Choice | Notes |
| --- | --- | --- |
| Environments | Local: kind (`make kind-up`, `infra/kind`). Staging: kubeadm on bare metal. Production: AKS | One Helm chart (`infra/charts/hiwar`) with three value profiles (`infra/charts/values/values-{local,test,live}.yaml`). Platform charts by helmfile (`infra/platform/helmfile.yaml`) |
| Cluster platform | Cilium, Traefik on Gateway API, cert-manager with a local CA, CloudNativePG, agentgateway | Versions in `infra/kind/versions.env` and `infra/versions.lock.md` |
| Web | Node 24 image, Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, `pg`, zod 4, pino | One application: public site, control panel, operator portal with the AI capabilities, widget and its API, platform MCP server (`/api/mcp`) |
| Database | PostgreSQL 18 with pgvector (CloudNativePG in the cluster, `pgvector/pgvector:0.8.1-pg18` in compose) | Schemas `public` and `kb` (Hiwar), `ai`, `gov`, `audit`, `core`, `work` (AI module). [Open: the owner's tech stack names MySQL; the module and Hiwar run on PostgreSQL](../01-product-requirements/open-questions.md) |
| Cache, queue, live events | Valkey (AI module); PostgreSQL `LISTEN/NOTIFY` (Hiwar inbox and widget) | |
| Durable workflows | Temporal (agent runs, ingestion, maintenance queues) | AI module agent service and workers |
| Object storage | MinIO locally, Ceph RGW on staging, Azure Blob in production (S3 API) | AI module files, skills, run payloads. Hiwar knowledge files sit on a volume (`FILES_DIR`) |
| AI runtime | Pydantic AI (`pydantic-ai-slim`), agentgateway for every model and tool call, MCP, AG-UI with CopilotKit for the page assistant | `services/ai-agent` (AI module, Temporal workers) and `services/agent` (Hiwar widget turns and customer knowledge) |
| Connectors and sandboxes | `services/connectors` (stdio MCP connectors, one Pod each), `services/sandbox` (per-run workspace Pods for skill scripts) | |
| Local model | `services/modelstub` as the cluster's `model-engine` | Deterministic engine behind agentgateway, never enabled outside `values-local.yaml` |
| Graph and traces | Neo4j and Phoenix (profile `full` only) | The `core` profile leaves both out |
| Styling | `hiwar.css` (design handoff); the module's screens use its `awp-*` layout classes mapped onto Hiwar's tokens in `app/ai.css` | The module's own design system is not used |
| Checks | Ruff, pytest, vitest (with happy-dom for the module's screen tests), Playwright, ESLint, `tsc` | `make verify` |

## Differences from the target stack

- Database: MySQL in the target, PostgreSQL 18 here (see the open question).
- Vector store: the target names Qdrant; the module and Hiwar use pgvector, and the module's graph store is Neo4j where the target names Apache AGE.
- Web styling: the target names Tailwind CSS v4 with shadcn-style primitives; Hiwar keeps the handoff's `hiwar.css`.
- The TypeScript server layer is Next.js route handlers and server actions; no separate Fastify service exists.
