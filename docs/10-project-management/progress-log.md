---
title: Progress log
status: draft
owner: product owner
version: 0.1
last-updated: 2026-11-19
related: [specs-pending.md]
---

# Progress log

- 2026-11-19: P1 implemented in `apps/web` and `services/agent`; typecheck, lint, 16 web tests and 11 agent tests pass; the core flows were exercised in a browser.
- 2026-11-19: Gaps closed (test console uses unsaved edits, question grouping, health alerts pushed, visitor country fallback, write-tool audit and one-at-a-time, crawl storage check, plan-version renewal). 30 of 31 specs completed with evidence; BIL-001 waits for a payment provider.
- 2026-11-19: Stripe integration for BIL-001 (hosted card form, off-session invoice charges, signed webhook), tested against stripe-mock; auto-close sweep fixed. All 31 specs completed.
- 2026-11-19: Continuation pass: typecheck, lint, 31 web tests, ruff, 11 agent tests, 8 Playwright scenarios, spec coverage (31 specs, 0 problems) and the spec board (0 pending, 31 completed) pass. No Stripe secret key or real model endpoint is configured, so live charges and real model answers remain unverified.
- 2026-11-19: Continuation pass: typecheck, lint, 31 web tests, ruff, 11 agent tests, 8 Playwright scenarios, spec coverage (31 specs, 0 problems) and the spec board (0 pending, 31 completed) pass. `STRIPE_SECRET_KEY` and a real `MODEL_BASE_URL` are still not set, so live charges and real model answers remain unverified.
- 2026-11-19: AI capabilities module merged into apps/web (15 /ops/ai screens, 49 module test files pass, all 375 web tests pass); database on PostgreSQL 18; platform moved to kind + Helm (infra/, Makefile); first kind bring-up in progress (core profile). Open: OQ-01 MySQL vs PostgreSQL.
- 2026-11-19: UI content pass on the AI capability screens (UI specification section 12 item 3): System shows open conversations instead of rooms; channel binding offers only embedded deployments; the handoff-queue field is hidden when no project exists; Tahseel hosts, names and the `awp-app` model-engine endpoint in the seed replaced. Typecheck, lint and 375 web tests pass; the re-seed and a browser check were not run.
- 2026-11-19: Browser pass over all 15 /ops/ai screens after a re-seed: every screen returns 200 with no console errors. Remaining Tahseel and TAWP seed values replaced (connector hosts and descriptions, the cards connector, deployment names, people's emails, the bilingual-writing skill and its Arabic terminology table); the model stub's models are now `hiwar-local-*`. Node-only start-up work moved to `instrumentation-node.ts` so the Edge instrumentation bundle stops tracing `node:crypto` and `node:fs`. Typecheck, lint, 375 web tests, 21 model stub tests and the agent service's skill package tests pass. Open: the bundled skills `guided-platform-creation`, `work-item-execution`, `request-triage`, `task-planning` and `platform-operations` name TAWP tools (requests, projects, work items) that Hiwar's platform MCP does not provide.
