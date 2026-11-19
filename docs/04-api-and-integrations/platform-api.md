---
title: Platform API
status: draft
owner: architect
related: [external-systems.md, ../02-architecture/solution-design.md]
version: 0.1
last-updated: 2026-11-19
---

# Platform API

The control panel uses server actions (in each screen's `actions.ts`) and these route handlers. A public API and webhooks are P2.

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /widget.js` | customer site | Widget loader: adds the iframe |
| `GET /embed/{key}` | browser, inside the iframe | Widget page; `frame-ancestors` lists the deployment's origins |
| `GET /api/widget/state`, `GET /api/widget/live` | widget | Conversation as the visitor sees it; server-sent events |
| `POST /api/widget/{message,person,cancel,contact,feedback,confirm}` | widget | Visitor actions; body has the deployment `key` and the visitor `token` |
| `GET /api/live?topic=org` or `conv:{id}` | control panel | Server-sent events for the organization or one conversation |
| `POST /api/knowledge/upload` | control panel | Knowledge files (multipart) |
| `GET /api/audit/export`, `GET /api/analytics/export` | control panel | CSV exports, audited |
| `GET /api/invoices/{id}` | control panel | Invoice PDF |
| `POST /api/notifications/read` | control panel | Mark all as read |
| `POST /api/auth/sign-out` | control panel | Ends the session |
| `POST /api/internal/sources/{id}` | agent service | Source status callback; bearer `AGENT_SERVICE_TOKEN` |
| `GET /api/payments/setup-complete` | browser, back from Stripe | Stores the new card's brand and last 4 digits |
| `POST /api/payments/webhook` | Stripe | Signed payment events for invoices |

## Agent service (`services/agent`)

Bearer `AGENT_SERVICE_TOKEN` on every route except `/healthz`.

| Route | Purpose |
| --- | --- |
| `POST /turn` | One agent turn: retrieval, model call, tools; returns text, citations, tool events, escalation, confidence and token cost |
| `POST /ingest` | Prepares a source in the background and reports its status to the web application |
| `DELETE /sources/{id}?org_id=` | Removes a source's chunks |
| `POST /tools/run` | Runs an approved HTTP tool once |
