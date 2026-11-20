---
title: Spec backlog
status: draft
owner: Project manager
related: [specs-pending.md, specs-completed.md]
version: 1.0
last-updated: 2026-11-20
---

# Spec backlog

Feature specs ([specs](../01-product-requirements/specs/README.md)) that are not yet built and accepted. A spec leaves this list only through `specs_board.py complete`, which moves its row to [completed specs](specs-completed.md). Implementation task status is in `task-backlog.md`, blockers in `blockers.md`.

The hint column shows the status of the spec's screens in the task backlog. It does not mean the spec is complete: a spec is complete only when every requirement and acceptance scenario in it is implemented and its tests pass.

<!-- rows:start -->

| ID | Feature | Module | Screens | FRs | Change requests | Implementation hint |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-004 | [AI cost, margin and service health](../01-product-requirements/specs/ops/004-cost-and-health/spec.md) | OPS | O-Business (redesigned for Hiwar) | 5 |  |  |
| ORG-003 | [Audit log](../01-product-requirements/specs/org/003-audit-log/spec.md) | ORG | C-Audit | 11 |  |  |

<!-- rows:end -->
