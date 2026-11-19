---
title: Data dictionary
status: draft
owner: architect
related: [data-model.md]
version: 0.1
last-updated: 2026-11-19
---

# Data dictionary

The column-level definitions are the Drizzle schema, [`apps/web/src/db/schema.ts`](../../apps/web/src/db/schema/hiwar.ts), which documents each table and generates the migrations in `apps/web/src/db/migrations`. This page lists the tables by area.

| Area | Tables |
| --- | --- |
| Tenancy and identity | `organizations`, `users`, `members`, `invitations`, `sessions`, `one_time_tokens` |
| Agents and tools | `agents`, `agent_versions`, `http_tools` |
| Knowledge | `sources`, `unanswered_questions`, `kb.chunks` |
| Deployments | `deployments`, `origins` |
| Conversations | `conversations`, `messages`, `ownership_events`, `tool_calls` |
| Plans, usage and billing | `plan_versions`, `usage_events`, `alerts_sent`, `invoices` |
| Audit, notifications and operators | `audit_entries`, `notifications`, `notification_reads`, `support_grants`, `operator_actions`, `sales_requests` |

JSON columns and their shapes: `agents.draft` and `agent_versions.config` are `AgentConfig`; `deployments.settings` is `DeploymentSettings`; `conversations.visitor` is `Visitor`; `messages.meta` is `MessageMeta`; `plan_versions.limits` is `PlanLimits`. All are TypeScript interfaces in the same file.
