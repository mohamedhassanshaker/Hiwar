---
title: Security
status: draft
owner: architect
related: [tenancy-and-roles.md, ../02-architecture/solution-design.md]
version: 0.1
last-updated: 2026-11-19
---

# Security

| Concern | Control | Code |
| --- | --- | --- |
| Passwords | scrypt (N = 2^15) with a per-password salt; at least 12 characters; failed sign-ins answer the same for unknown and known emails | `apps/web/src/server/password.ts`, `accounts.ts` |
| Brute force | 5 failed attempts in 15 minutes block the account for 15 minutes and email the account | `accounts.ts` |
| Sessions | random 32-byte cookie, HTTP-only, SameSite=Lax, Secure on HTTPS; the database stores only its SHA-256; length per organization | `session.ts` |
| 2-step sign-in | TOTP (RFC 6238); the secret is sealed with AES-256-GCM under `SECRET_KEY` | `accounts.ts`, `crypto.ts` |
| Tool secrets | sealed with AES-256-GCM; never returned to a browser; recorded in the audit log as "not shown" | `agents.ts` |
| Authorization | the permission matrix is checked on the server for every page, action and route | `authz.ts`, `session.ts` |
| Organization isolation | every query takes `org_id` from the session or the widget's deployment, never from input; knowledge retrieval filters on `org_id` | `src/server/*`, `services/agent/.../retrieval.py` |
| Widget embedding | the frame is served with `Content-Security-Policy: frame-ancestors` listing the deployment's origins | `src/proxy.ts` |
| Server-side requests to customer addresses | crawls, HTTP tools and domain verification refuse private, loopback, link-local and reserved addresses on every redirect hop | `services/agent/.../egress.py`, `deployments.ts` |
| Prompt injection | agent instructions go in the system channel; the model is told to treat visitor text as data; write tools need confirmation or approval by default | `services/agent/.../turn.py` |
| Personal data in transcripts | card numbers (Luhn-checked) and Emirates ID numbers are redacted before storage when the guardrail is on | `visitor.ts` |
| Support access | read-only, time-limited, only with the customer's grant; every page viewed is in the customer's audit log | `ops.ts`, `(panel)/layout.tsx` |
| Payment cards | only the brand and last 4 digits reach Hiwar | `billing.ts` |
| CSV exports | cells starting with `=`, `+`, `-` or `@` are prefixed so spreadsheets do not run them | `audit-log.ts` |
