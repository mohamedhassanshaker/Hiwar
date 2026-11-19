---
title: Solution design
status: draft
owner: architect
related: [overview.md, tech-stack.md, ../01-product-requirements/specs/README.md]
version: 0.1
last-updated: 2026-11-18
---

# Solution design

## Code layout

| Path | Holds |
| --- | --- |
| `apps/web/src/app/(site)` | Public Home and Pricing |
| `apps/web/src/app/(auth)` | Sign-up, sign-in, 2-step, invitation, password reset |
| `apps/web/src/app/(panel)` | Control panel screens (C-*) |
| `apps/web/src/app/(ops)` | Operator portal (O-*) |
| `apps/web/src/app/api` | JSON and SSE routes for the panel and the widget |
| `apps/web/public/widget.js` | The embeddable widget |
| `apps/web/src/server` | Domain logic: one module per spec module (`inbox`, `agents`, `knowledge`, `deployments`, `billing`, `org`, `ops`), data access, authorization |
| `apps/web/src/db` | Drizzle schema, migrations, seed |
| `services/agent` | FastAPI: `/turn`, `/ingest`, `/retrieve`, `/tools/run` |
| `services/modelstub` | Deterministic OpenAI-compatible engine |

## A visitor message

1. The widget posts the message with its deployment key. The web application resolves the deployment, checks the origin against the allowed origins and the quotas, and stores the message.
2. Inside one transaction it reads the conversation's state and owner. AI_ACTIVE: it records a turn and calls the agent service. HUMAN_ACTIVE: the message is delivered to the owner only. HANDOVER_PENDING: the message is queued.
3. The agent service builds the prompt from the agent version (instructions in the system channel, visitor text as data), retrieves chunks for the organization, calls the model with the enabled tools, and streams events: text, citations, tool proposals, escalation requests, token counts.
4. Before each AI message is stored, the web application checks that the conversation is still AI_ACTIVE at the turn's `ownership_version`. A take over in between increases the version, so the AI reply is discarded and never delivered.

## Ownership changes

Every change (take over, claim, hand back, release, close, cancel, reopen, tool approval handover) is one SQL `UPDATE ... WHERE id = $1 AND ownership_version = $2` that increases the version. Zero rows updated means another change won; the caller gets the current state. This gives "first valid claim wins" without locks held across requests.

## Tool calls

The agent service proposes a call. Read tools and write tools with "Run automatically" run in the agent service at once. "Require staff approval" stores the proposal and moves the conversation to HANDOVER_PENDING (`tool_approval`). "Ask the visitor first" sends a confirmation to the widget. An approved call is run by the agent service's `/tools/run`. HTTP tools and website crawls go through an egress guard that refuses private and loopback addresses.

## Knowledge

Uploads are stored by the web application, which then calls `/ingest`. The agent service extracts text (PDF, DOCX, TXT, MD, CSV, HTML), normalises Arabic for search keys, splits into chunks, embeds them and writes them to `kb.chunks` with `org_id` and `source_id`. Status changes (Queued, Processing, Ready, Failed with reason) are written back through a callback to the web application.

## Metering

An AI conversation is counted when the first AI reply in it is stored. Usage rows are append-only and are the source for meters, alerts, overage and invoices.

## Live updates

Writes that change what a viewer sees issue `NOTIFY` on a channel per organization and per conversation. SSE routes listen and push to the panel and the widget.
