---
title: Configuration
status: draft
owner: architect
related: [deployment.md, runbook.md]
version: 0.2
last-updated: 2026-11-19
---

# Configuration

## Web application (`apps/web`, `.env.local` locally)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://hiwar:hiwar@localhost:5433/hiwar` | PostgreSQL with pgvector |
| `APP_URL` | `http://localhost:3000` | Public address, used in links, the snippet and cookie security |
| `SECRET_KEY` | development key | 32 bytes, base64; seals TOTP secrets and tool secrets. Required in production |
| `AGENT_SERVICE_URL` | `http://localhost:8088` | Agent service |
| `AGENT_SERVICE_TOKEN` | `dev-agent-token` | Shared token for calls in both directions |
| `SMTP_URL` | `smtp://localhost:1025` | Mail server (Mailpit locally) |
| `MAIL_FROM` | `Hiwar <no-reply@hiwar.local>` | Sender of system email |
| `FILES_DIR` | `../../.data/files` | Uploaded knowledge files; the agent service mounts the same folder |
| `ALLOW_PRIVATE_EGRESS` | unset | `1` lets domain verification reach private addresses. Development only |
| `STRIPE_SECRET_KEY` | unset | Turns on the payment provider. Unset, Plan and usage uses its development card dialog |
| `STRIPE_WEBHOOK_SECRET` | unset | Verifies `POST /api/payments/webhook`; subscribe the endpoint to `payment_intent.succeeded` and `payment_intent.payment_failed` |
| `STRIPE_API_BASE` | unset | Points the client at another API host, for example `http://localhost:12111` for `stripe-mock` in tests |

| `AI_AGENT_SERVICE_URL` | unset | The AI module's agent service (`services/ai-agent`), which starts and streams runs |
| `PLATFORM_MCP_URL`, `RUN_TOKEN_SIGNING_KEY`, `APP_KEK` | unset | The platform MCP server URL the module's workers call, the key that signs run tokens, and the key that encrypts module credentials (32 bytes, base64) |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` | unset, `hiwar` | Temporal for the module's runs |
| `AGW_LLM_URL`, `AGW_MCP_BASE_URL`, `AI_NAMESPACE`, `AI_GATEWAY_NAME` | unset | agentgateway's model and MCP listeners, and where the web application renders its routes |
| `VALKEY_URL` | unset | Valkey for the module's run events and live updates |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | unset | Object storage for module files, skills and run payloads |
| `CONNECTOR_RUNTIME_URL`, `EGRESS_PROXY_URL` | unset | The connector runtime, and the proxy every outbound provider call goes through |
| `NEO4J_URI`, `PHOENIX_BASE_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Graph retrieval and LLM traces (`full` profile) |

Each module variable is optional: without it the screens still work and the System screen shows the dependency as Disabled. The full list with development values is `.env.example.platform`; `scripts/secrets-from-env.sh` turns the file named by `ENV_FILE` into the cluster Secrets.

## Agent service (`services/agent`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | as above | For `kb.chunks` |
| `MODEL_BASE_URL`, `MODEL_API_KEY` | model stub | OpenAI-compatible provider |
| `MODEL_FAST`, `MODEL_STANDARD`, `MODEL_ADVANCED` | provider model names | The three model tiers of AGT-001 |
| `EMBED_MODEL`, `EMBED_DIMENSIONS` | `text-embedding-3-small`, `1024` | Embeddings; the dimension must match `kb.chunks.embedding` |
| `PRICE_FAST`, `PRICE_STANDARD`, `PRICE_ADVANCED` | AED per million input and output tokens | Cost shown per turn and used for margin |
| `WEB_CALLBACK_URL` | `http://localhost:3000` | Where source status is reported |
| `AGENT_SERVICE_TOKEN` | `dev-agent-token` | Must equal the web application's |
| `FILES_DIR` | `/files` in the container | Read-only mount of uploaded files |
| `ALLOW_PRIVATE_EGRESS` | `0` | Development only |
| `LOW_CONFIDENCE_BELOW` | `0.2` | Retrieval score under which an answer is low confidence |

## Organization settings kept in the database

Session length, 2-step requirement, auto-close minutes (default 30), alert thresholds, limit behaviour and overage cap are columns of `organizations`; plan prices and limits are `plan_versions`, edited in the operator portal.
