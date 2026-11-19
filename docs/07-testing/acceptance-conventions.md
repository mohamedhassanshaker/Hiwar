---
title: Acceptance test conventions
status: draft
owner: architect
related: [../01-product-requirements/specs/README.md]
version: 0.1
last-updated: 2026-11-19
---

# Acceptance test conventions

- A test that proves an acceptance scenario names its ID in the test title, for example `AC-INB-002-06: of two simultaneous claims exactly one succeeds`.
- Web tests (`apps/web/tests`, vitest) run against a fresh `hiwar_test` database created and migrated by `tests/global-setup.ts`; the compose database must be running. Test files run one after another.
- Agent service tests (`services/agent/tests`, pytest) cover rules that need no model or database.
- Model behaviour in tests comes from `services/modelstub`: it answers with the first knowledge passage, and directives such as `[[tool:NAME {json}]]` make it call a tool, so tool and approval paths are repeatable.
- Browser checks drive the real application with Playwright CLI against `npm run dev`; the demo page `/demo-site/<public key>` hosts the widget locally.
