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

When a question needs the product owner, add it here with its ID (`OQ-nn`), the question, what it blocks and the specs that cite it. Once it is decided, write the decision into the specs and remove the question.
