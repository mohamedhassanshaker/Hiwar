---
title: Runbook
status: draft
owner: architect
related: [configuration.md, deployment.md]
version: 0.1
last-updated: 2026-11-19
---

# Runbook

| Symptom | Check | Fix |
| --- | --- | --- |
| The AI does not reply; the thread shows "The AI could not reply (service unavailable)" | `docker compose ps agent`, `curl http://localhost:8088/healthz`, `docker compose logs agent` | Start or rebuild the agent service; check `MODEL_BASE_URL` and the provider key |
| Sources stay Queued or Processing | agent logs for `source status callback failed` | `WEB_CALLBACK_URL` must reach the web application from the agent container (`host.docker.internal:3000` locally); the tokens must match |
| A source fails with "The address points to a private network" | the crawl or tool address | Expected for internal addresses. Locally set `ALLOW_PRIVATE_EGRESS=1` |
| The widget does not appear on a site | browser console: a `frame-ancestors` refusal | Add the site under Allowed origins, verify it and make the deployment live |
| Verify domain says "Snippet not found on the page" | view the page source of the address entered | Install the snippet on that page, or enter the address of a page that has it |
| No emails arrive locally | Mailpit at `http://localhost:8025` | `SMTP_URL` must point at Mailpit |
| A customer cannot sign in: "This organization is suspended" | operator portal, organization detail | Reactivate with a reason (Platform admin) |
| An operator cannot open a customer's panel | operator portal, Support | The customer must grant support access in Team and roles |
