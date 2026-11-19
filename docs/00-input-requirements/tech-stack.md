# Tech stack

Three environments, one set of images and one Helm chart. PostgreSQL 18 is the database in all three. The application names model and tool aliases. AgentGateway resolves them. No service holds a provider key.

## Environments

| | Substrate | Role |
|---|---|---|
| Local | kind | Kubernetes in Docker. One long-lived cluster per project. Development and the full test suite. |
| Staging | kubeadm on bare metal (`nvc`) | Real hardware, GPUs, storage, and ingress before production. |
| Production | AKS (`2pz-ai-prod`) | Serving. |

Kubernetes lines: 1.37 local, 1.36 staging, 1.35 production.

## Platform

| Component | Where | Role |
|---|---|---|
| containerd | all | Container runtime. |
| gVisor | staging, opt-in | `RuntimeClass` for isolation. GPU pods stay on the NVIDIA runtime. |
| Cilium | staging | eBPF CNI and kube-proxy replacement. LB-IPAM with BGP. |
| Azure CNI | production | Cluster networking. |
| Traefik | staging, production | Ingress on Gateway API. Local has no ingress; the host reaches services directly. |
| Gateway API | all | `HTTPRoute` and `TLSRoute`. One route per external hostname. |
| cert-manager + Let's Encrypt | staging, production | DNS-01 wildcard certificates. |
| Cloudflare | staging, production | DNS, Terraform-managed. |
| Harbor | staging | Image registry. |
| Azure Container Registry | production | Image registry. Pulled by the kubelet identity. |
| NVIDIA device plugin | staging | GPU access, time-sliced. |
| Helm | all | One chart, three value profiles. |
| Terraform | staging, production | Cloudflare DNS. |

Images are built once and promoted. Local loads them into kind.

## Data and state

| Component | Role |
|---|---|
| PostgreSQL 18 | Application database, run by CloudNativePG in every environment. One instance locally, 2–3 on staging and production. Two DSNs: an owner role for migrations, a non-owner role for the API, with row-level security. |
| pgvector | Vector type and HNSW/IVF indexes in the same PostgreSQL cluster. |
| Barman | PostgreSQL backups to object storage. Ceph on staging, Azure Blob in production. None locally. |
| Ceph | Staging block storage and RGW object storage (`ObjectBucketClaim`). |
| MinIO | Local object-storage option. |
| Valkey | Cache and light queue. Redis protocol. Eviction policy is part of correctness once it holds a queue. |
| Temporal | Durable workflows: compensation, human-in-the-loop, long timers, replay. |
| Apache AGE | In-database graph (openCypher) in the same PostgreSQL cluster. |

## Application

| Layer | Stack |
|---|---|
| Python | 3.14, `uv`, `hatchling`, FastAPI, `uvicorn[standard]`, Pydantic 2, `psycopg` 3 or `asyncpg` |
| TypeScript | Node 24, npm workspaces, Fastify 5, `pg`, `node-pg-migrate`, Zod 4, Ajv 8, Pino 10 |
| Web | Next.js 16 App Router, or Vite + React Router when there is no server rendering. React 19, Tailwind CSS v4, shadcn-style primitives on Radix, TanStack Query |
| Docs | Astro + Starlight + `starlight-llms-txt`, synced from `docs/` at build |
| Checks | Ruff, mypy `--strict` or Pyright, oxlint, pytest 9, Vitest 4, Playwright |

## AI

| Component | Role |
|---|---|
| Pydantic AI | Agent core: tool loops, structured output, hooks. Package `pydantic-ai-slim` with the extras in use (`openai`, `anthropic`, `mcp`, `ag-ui`, `temporal`). |
| Pydantic AI Harness | Optional capabilities on the same `capabilities=[...]` API: Code Mode (sandboxed Python over tools), filesystem, shell, sub-agents, planning, context compaction. |
| AgentGateway | Model and tool egress in every environment. Local refuses until a key is supplied. Staging fronts KServe and hosted providers. Production fronts Azure AI Foundry. Separate ports for model calls and knowledge/MCP calls. |
| KServe + vLLM | In-cluster model serving on staging GPUs. KServe in Standard/RawDeployment mode. |
| MCP | Tool and data exposure over Streamable HTTP. Machine endpoints enforce auth in process. They are not placed behind a redirect proxy. |
| AG-UI + CopilotKit | UI-attached agents. CopilotKit on the React side when the console embeds a conversation. |
| LiveKit + LiveKit Agents | Real-time voice and video. Agents plugins cover STT, TTS, VAD, turn detection, noise cancellation, and avatar. Shared SFU on staging and production. |
| Phoenix | LLM traces and evaluation: per-stage traces, token and cost telemetry. |
| OpenTelemetry | Application traces. SDK to OTLP. |
| Cohere Rerank | Reranking, reached through Azure AI Foundry. The application names a rerank alias; the gateway resolves it. |

The service names an alias (`embeddings`, `rerank`, a model name). Moving a model between tiers is a gateway route change.

## Observability and policy

| Component | Role |
|---|---|
| Prometheus, Grafana, Alertmanager | Metrics. Apps expose `/metrics` (`prometheus-client` or `prom-client`). Charts ship a `ServiceMonitor` and a `PrometheusRule`. kube-prometheus-stack. |
| Uptime Kuma | External status checks on `nvc`. |
| OpenFGA | Relationship-based authorization where the model is relational. |
| OPA | Policy decisions. |
| Presidio | Detection and redaction of sensitive data. |

Health is split: `/livez`, `/readyz`, `/healthz`. Logs are structured (`structlog`, `loguru`, or Pino) to stdout.

## Delivery

| Component | Role |
|---|---|
| GitHub Actions | CI. Every gate is a script under `scripts/ci`. The workflow calls those scripts. |
| Make / `scripts/ci` | Local entry point. `make ci` runs the same sequence as Actions and stops at the first failure. |

`main` is the only branch. Dependencies declare a minor line and leave the patch floating. Lockfiles record the resolution.
