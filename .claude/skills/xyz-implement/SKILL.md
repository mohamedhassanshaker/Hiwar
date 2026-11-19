---
name: xyz-implement
description: Implement the pending feature specs listed in specs-pending.md (10-project-management), one spec at a time, with unit and integration tests and the project's checks, then mark each spec complete with its evidence. Optional --e2e deploys the changed components after implementation and runs the xyz-e2e skill so that completion requires a passing end-to-end suite. Use when asked to implement, build or deliver pending specs, specific Feature IDs, or the specs a change request added, with or without end-to-end tests.
argument-hint: "[FEATURE-ID ...] [--e2e]"
---

# Implement pending specs

Builds the specs in `specs-pending.md` (the `xyz-docs` backlog) and moves each one to `specs-completed.md` only when every functional requirement (FR) and acceptance scenario in it is built and proved.

Arguments:

| Argument | Effect |
| --- | --- |
| `FEATURE-ID ...` | Implement these specs; each must be in `specs-pending.md` |
| none | Implement every spec in `specs-pending.md` |
| `--e2e` | After implementation: deploy the changed components and run `xyz-e2e` for the implemented specs; a spec completes only when its scenarios pass end to end |

Configuration: `implement` in `.claude/xyz.json`:

```json
"implement": {
  "verify": "make verify",
  "deploy": { "apps/web": "make deploy-web", "services/ai-agent": "make deploy-agent", "*": "make deploy" }
}
```

`verify` is the project's full check (what CI runs). `deploy` maps a path prefix of changed files to the command that rebuilds and rolls out that component; `*` covers the rest. When a key is missing, find the command in the project's Makefile, scripts and deployment docs, and add the key.

## 1. Scope and order

1. Read `specs-pending.md`. Take the given IDs, or every row.
2. For each spec read `spec.md` in full, the change requests in its change-requests column, and its links to other specs (`../NNN-slug/spec.md` in Assumptions). Order the work so a spec comes after the specs it depends on; cross-cutting specs first.
3. A spec with an open `[NEEDS CLARIFICATION]` or open question that changes behaviour is blocked. Record it in `blockers.md` (`pm_dir`) with the question, skip it, and continue with the others. Do not choose the answer.

## 2. Before writing code

Per spec, read:

- the project's `CLAUDE.md`, the rules it loads for the files you will touch, and the test conventions (for example `docs/07-testing/`);
- the architecture documents that cite the Feature ID (search `docs/02-*` to `docs/06-*`): module map, flows, interfaces, data model, security controls;
- the module's `README.md` in the specs folder (implementation notes) and the existing code of that module, its tests and the manifests;
- the official documentation of the frameworks and services involved, at the versions in use.

Write a checklist in the scratchpad, one row per FR and acceptance scenario: where it will be implemented and which test proves it. The checklist is the completion criterion; it is not committed.

When the spec needs a design choice the architecture does not make (a new table, route, queue, external call), make it as the architecture reference of `xyz-docs` requires: an ADR or an update of the governing document, in the same change as the code.

## 3. Implement

- Follow the architecture and the existing patterns of the module. Use the frameworks' native primitives; no bespoke replacements.
- Enforce rules where the architecture places them (database constraint, guarded update, server-side authorization), not only in the UI.
- Copy messages, limits and values exactly from the spec.
- Keep documents current in the same change: API, data dictionary, configuration and security documents for every interface, table, setting or control added or changed (`docs/rules.md` section on keeping documents current).
- Do not change a spec to match the code. If the spec is wrong or cannot be built as written, stop that spec, raise an open question with `xyz-docs`, and report it.

## 4. Test and check

1. Unit and integration tests in the project's frameworks for every checklist row that has logic, permissions, state changes or data rules. Test titles start with the acceptance scenario IDs they prove (`AC-INB-002-03: ...`); FR-only rules name the FR.
2. Run the `verify` command. Fix every failure; a failing check is never skipped or weakened.
3. Run the application locally and walk each screen the spec changes with the `playwright-cli` skill (console and network logs open): every scenario of the spec by hand, including errors and permissions.
4. Run the `xyz-docs` checks; they must print `0 problems`.

Follow the shared-workstation duties of `CLAUDE.md` for every server, container and test run: memory watch, resource caps, stop what you started.

## 5. Without --e2e: complete

For each spec whose checklist is complete, whose tests pass and whose browser walk-through showed every scenario:

```
python .claude/skills/xyz-docs/scripts/specs_board.py complete <ID> --evidence "<test files> (<n> scenarios), <verify command> passed, browser walk-through <date>"
```

A spec with any checklist row not done stays pending; list what is missing.

## 6. With --e2e: deploy and run xyz-e2e

1. List the files changed for the implemented specs (`git status`, `git diff --name-only`). Run the `deploy` command of each matching path prefix, once per command, against the environment the `e2e.run` command targets.
2. Confirm the new build is running: rollout status, the new image or revision on every changed workload, readiness probes green, and the logs of each changed service free of startup errors. A deploy that does not roll out the new build is a failure to fix before testing.
3. Invoke the `xyz-e2e` skill for the implemented Feature IDs. It writes the missing end-to-end tests, runs them and records the result: passing pending specs are completed with the e2e evidence; failures are fixed or left pending.
4. A product defect found by the e2e run is fixed here (sections 3 and 4), redeployed, and the e2e run repeated for the affected specs.

## 7. Report

- Specs completed, with their evidence.
- Specs left pending: the checklist rows or scenarios not done and why.
- Blocked specs and their questions.
- ADRs and documents changed.
- With `--e2e`: the components deployed, and the e2e result per spec.

Commit or push only when the owner asks.
