---
title: Deployment
status: draft
owner: architect
related: [configuration.md, runbook.md, ../02-architecture/tech-stack.md]
version: 0.2
last-updated: 2026-11-19
---

# Deployment

One set of images and one Helm chart (`infra/charts/hiwar`) for three environments: kind locally, kubeadm on bare metal for staging, AKS for production ([tech stack](../00-input-requirements/tech-stack.md)).

## Local: kind

Prerequisites: Docker, kind 0.23+, kubectl 1.30+, helm 3.14+, helmfile 1.0+, Node.js 22+, bash (Git Bash on Windows). The Docker daemon needs 4 CPUs and 12 GB for the `core` profile (leaves out Neo4j and Phoenix), 8 CPUs and 20 GB for `full`.

```bash
cp .env.example.platform .env.platform     # then generate the secrets with the commands at its top
make kind-up PROFILE=core                  # registry, cluster, Cilium, Traefik, cert-manager, CloudNativePG,
                                           # agentgateway, Valkey, MinIO, Temporal, Mailpit, then the hiwar chart
make seed                                  # AI module seed and the Gulf Bites demo organization
make test-e2e                              # the Playwright journey in tests/e2e against the cluster
```

An antivirus that scans HTTPS (AVG and Avast Web Shield, for example) re-signs the kind API server's certificate on `127.0.0.1`, and kubectl and helm then fail with `x509: certificate signed by unknown authority`. Either exclude the API port from scanning, or run the bootstrap from a container on the Docker VM's network (`docker run --network host` with the Docker socket, the repository, and a kubeconfig from `kind get kubeconfig`), where the traffic never passes the host's scanner.

The platform answers at `https://hiwar.localtest.me:8443` (the local CA from cert-manager signs the certificate). `make deploy` upgrades the chart; `make deploy-web` and `make deploy-agent` rebuild one image and roll it out; `make kind-down` deletes the cluster.

On a shared workstation, cap the kind nodes after `kind-up`, for example `docker update --memory 7g --memory-swap 7g hiwar-worker`.

### Without a cluster

`compose.yaml` runs PostgreSQL 18 with pgvector, Mailpit, the model stub and Hiwar's agent service; the web application runs with `npm run dev` ([README](../../README.md)). The AI capabilities screens work against that database; runs that need Temporal, agentgateway or the object store need the cluster.

## Chart contents

| Workload | Image | Source |
| --- | --- | --- |
| `web` | `hiwar/web` | `apps/web/Dockerfile` (Next.js standalone) |
| `db-migrate` Job (Helm hook) | `hiwar/web` | Drizzle migrations, including the AI module's prerequisites |
| `widget-agent` | `hiwar/widget-agent` | `services/agent` |
| `agent-service`, `agent-worker-{agent-runs,ingestion,maintenance}` | `hiwar/agent` | `services/ai-agent` |
| `connector-runtime` | `hiwar/connector-runtime` | `services/connectors` |
| `sandbox-manager` | `hiwar/sandbox-manager` | `services/sandbox` |
| `model-engine` (local only) | `hiwar/model-engine` | `services/modelstub` |
| `egress-proxy` | `ubuntu/squid` | the only workload allowed out of the cluster |

Platform charts come from `infra/platform/helmfile.yaml`: the CloudNativePG cluster `hiwar-pg` (databases `hiwar`, `hiwar_kb`, `temporal`, `temporal_visibility`, `phoenix`), Valkey, MinIO (or Rook Ceph), Temporal, agentgateway, and with the `full` profile Neo4j and Phoenix.

## Staging and production

`values-test.yaml` (staging) and `values-live.yaml` (production) set the registry, public host, replica counts and a ReadWriteMany class for the knowledge files volume (`widgetAgent.filesStorageClass`). Certificates come from cert-manager with Let's Encrypt (DNS-01, Cloudflare); DNS records are Terraform-managed. Provider keys live in the `agentgateway-providers` Secret in `hiwar-ai`; no application workload holds a provider key.

The payment provider needs `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the `hiwar-app` Secret and the webhook endpoint `https://<host>/api/payments/webhook`.

Periodic work (auto-close, the no-person behaviour, trial end, scheduled plan changes, invoices) runs every 30 seconds inside each web instance (`src/instrumentation.ts`); each step is idempotent, so several replicas can run it. On start-up the web application also republishes agentgateway's routes from Models & routes.
