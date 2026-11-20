---
title: Open questions
status: draft
owner: product owner
related: [specs/README.md]
version: 1.3
last-updated: 2026-11-19
---

# Open questions

| ID | Question | Blocks | Cited by |
| --- | --- | --- | --- |
| OQ-01 | The owner's tech stack names MySQL as the application database, but it also lists PostgreSQL-only components (Apache AGE, `psycopg`, `pg`, `node-pg-migrate`), and the AI capabilities module and Hiwar both run on PostgreSQL 18. Is PostgreSQL the database? | Moving any schema to MySQL (both Drizzle schemas, pgvector, `LISTEN/NOTIFY`) | [Tech stack](../02-architecture/tech-stack.md) |
| OQ-02 | PLT-001 AC-PLT-001-02 and FR-012 show P2 items (copilot mode, webhooks and API, SSO, scheduled reports, regional hosting, white label) "on Pricing only", but BIL-001 FR-023 requires copilot mode, webhooks, SSO and regional hosting with the Planned badge in the plan descriptions of Choose a plan on Plan and usage, which the product shows. Which rule holds? | The end-to-end test of AC-PLT-001-02 | [PLT-001](specs/platform/001-scope-and-principles/spec.md), [BIL-001](specs/bil/001-plan-and-usage/spec.md) |
| OQ-03 | PLT-001 AC-PLT-001-03 and FR-013 say release P3 items are not shown, but neither PLT-001 nor the UI specification (section 11) lists which items are P3. What are the P3 items? | The end-to-end test of AC-PLT-001-03 | [PLT-001](specs/platform/001-scope-and-principles/spec.md) |

When a question needs the product owner, add it here with its ID (`OQ-nn`), the question, what it blocks and the specs that cite it. Once it is decided, write the decision into the specs and remove the question.
