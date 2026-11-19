---
title: External systems
status: draft
owner: architect
related: [platform-api.md, ../08-devops-and-deployment/configuration.md]
version: 0.1
last-updated: 2026-11-19
---

# External systems

| System | Used for | Local stand-in |
| --- | --- | --- |
| OpenAI-compatible model provider | chat completions with tool calls, embeddings | `services/modelstub` |
| SMTP mail | verification, invitations, password reset, alerts, transcripts, install steps | Mailpit |
| Customer websites | crawled knowledge sources, domain verification | `/demo-site/{key}` |
| Customer HTTP tools | the agent's write and read tools | any reachable endpoint |
| Payment provider: Stripe (operates in the UAE, charges in AED) | hosted card form (Checkout in setup mode), off-session charges of month-end invoices, signed webhook for payment success and failure | `stripe-mock` (compose profile `payments`) in tests; the development card dialog when no key is set |
