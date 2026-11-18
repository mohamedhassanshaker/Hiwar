---
name: xyz-spec-backlog
description: Initialize and maintain a spec backlog and a completed-specs list for a project's feature specs (specs-pending.md, specs-completed.md in the project-management folder). Use when asked to create or reset the spec backlog, to mark a feature spec complete or reopen it, to add newly written feature specs to the backlog, or to report which specs are pending or done.
---

# Spec backlog

Two files in the project-management folder (`pm_dir` in `.claude/xyz.json`, default `docs/10-project-management`) track the feature specs under `specs_dir` (written with `xyz-feature-specs`):

| File | Holds |
| --- | --- |
| `specs-pending.md` | Pending specs: ID, feature, module, screens, FR count, implementation hint |
| `specs-completed.md` | Completed specs: ID, feature, module, completion date, evidence |

A spec is in exactly one of them. An optional `task-backlog.md` (implementation tasks per screen, in a table `| spec section | \`Screen\` | route | status | ... |`), `blockers.md` and `progress-log.md` in the same folder are separate and are not edited by this skill.

A spec is complete only when every functional requirement and acceptance scenario in it is implemented and its tests pass. The hint column copies the status of the spec's screens from `task-backlog.md` when it exists; it never completes a spec.

## Commands

`python3 .claude/skills/xyz-spec-backlog/scripts/specs_board.py <command>`

| Command | Effect |
| --- | --- |
| `init [--force]` | Creates both files from the feature specs, every spec pending. Refuses to overwrite without `--force` (which discards completions). |
| `sync` | Adds specs that are in neither file to the backlog, refreshes the descriptive columns of pending rows, reports rows whose spec no longer exists. Run after writing or removing feature specs. |
| `complete ID [ID...] --evidence "<tests, deployment>"` | Moves rows from `specs-pending.md` to `specs-completed.md` with today's date and the evidence. |
| `reopen ID [ID...]` | Moves rows back to the backlog (when a completed spec gains requirements that are not built). |
| `check` | Every spec is in exactly one file and every row has a spec. Must print `0 problems`. |

## Rules

1. Move a spec only through `complete` or `reopen`; never edit rows by hand. Rows between the `rows:start` and `rows:end` markers are regenerated.
2. Evidence names what proves the spec: test suites or specs by path and the acceptance scenarios they cover, or the deployment checked. Without evidence, do not complete a spec.
3. Complete a spec only after reading its `spec.md` against the implementation: all FRs and acceptance scenarios, and no unresolved `[NEEDS CLARIFICATION]` that changes behaviour.
4. When requirements are added to a completed spec, `reopen` it in the same change.
5. After `xyz-feature-specs` work, run `sync` then `check`.

## Initialize

1. Make sure the feature specs exist (`coverage.py lint` of `xyz-feature-specs` prints `0 problems`).
2. `specs_board.py init`, then `specs_board.py check`.
3. Report the counts. If the owner states which specs are already built, complete them with the evidence given; do not infer completion from the hint column.
