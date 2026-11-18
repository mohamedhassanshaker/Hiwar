---
title: Spec backlog
status: draft
owner: Project manager
related: [specs-pending.md, specs-completed.md]
version: 1.0
last-updated: 2026-11-18
---

# Spec backlog

Feature specs ([specs](../01-product-requirements/specs/README.md)) that are not yet built and accepted. A spec leaves this list only through `specs_board.py complete`, which moves its row to [completed specs](specs-completed.md). Implementation task status is in `task-backlog.md`, blockers in `blockers.md`.

The hint column shows the status of the spec's screens in the task backlog. It does not mean the spec is complete: a spec is complete only when every requirement and acceptance scenario in it is implemented and its tests pass.

<!-- rows:start -->

| ID | Feature | Module | Screens | FRs | Implementation hint |
| --- | --- | --- | --- | --- | --- |
| AGT-001 | [Agent configuration](../01-product-requirements/specs/agt/001-agent-configuration/spec.md) | AGT | C-Agents | 34 |  |
| AGT-002 | [Agent versions, publish and roll back](../01-product-requirements/specs/agt/002-agent-versions/spec.md) | AGT | C-Agents | 8 |  |
| AGT-003 | [Agent test console](../01-product-requirements/specs/agt/003-test-console/spec.md) | AGT | C-Agents | 10 |  |
| ANA-001 | [Analytics dashboard](../01-product-requirements/specs/ana/001-analytics-dashboard/spec.md) | ANA | C-Analytics | 17 |  |
| BIL-001 | [Plan and usage](../01-product-requirements/specs/bil/001-plan-and-usage/spec.md) | BIL | C-Billing | 27 |  |
| DEP-001 | [Deployment install, keys, origins and go-live](../01-product-requirements/specs/dep/001-install-and-origins/spec.md) | DEP | C-Deployments | 12 |  |
| DEP-002 | [Deployment appearance, behaviour and quotas](../01-product-requirements/specs/dep/002-appearance-behaviour-quotas/spec.md) | DEP | C-Deployments | 12 |  |
| DEP-003 | [Visitor chat widget](../01-product-requirements/specs/dep/003-visitor-widget/spec.md) | DEP | C-Widget | 23 |  |
| INB-001 | [Inbox list, thread and details](../01-product-requirements/specs/inb/001-inbox-list-and-thread/spec.md) | INB | C-Inbox | 27 |  |
| INB-002 | [Conversation ownership, takeover and handback](../01-product-requirements/specs/inb/002-conversation-ownership/spec.md) | INB | C-Inbox | 34 |  |
| INB-003 | [Write-tool approval in the inbox](../01-product-requirements/specs/inb/003-write-tool-approval/spec.md) | INB | C-Inbox, C-Widget | 10 |  |
| KNO-001 | [Knowledge sources and ingestion](../01-product-requirements/specs/kno/001-knowledge-sources/spec.md) | KNO | C-Knowledge | 18 |  |
| KNO-002 | [Unanswered questions](../01-product-requirements/specs/kno/002-unanswered-questions/spec.md) | KNO | C-Knowledge | 9 |  |
| OPS-001 | [Operator organizations list and actions](../01-product-requirements/specs/ops/001-organizations/spec.md) | OPS | O-Tenants (redesigned for Hiwar) | 7 |  |
| OPS-002 | [Operator plans and prices](../01-product-requirements/specs/ops/002-plans-and-prices/spec.md) | OPS | O-Plans (redesigned for Hiwar) | 5 |  |
| OPS-003 | [Time-limited support access](../01-product-requirements/specs/ops/003-support-access/spec.md) | OPS | O-Support (redesigned for Hiwar), C-Team | 5 |  |
| OPS-004 | [AI cost, margin and service health](../01-product-requirements/specs/ops/004-cost-and-health/spec.md) | OPS | O-Business (redesigned for Hiwar) | 5 |  |
| ORG-001 | [Team members, invitations and security settings](../01-product-requirements/specs/org/001-team-and-security/spec.md) | ORG | C-Team | 13 |  |
| ORG-002 | [Roles and permission matrix](../01-product-requirements/specs/org/002-roles-and-permissions/spec.md) | ORG | C-Team, all C- screens | 6 |  |
| ORG-003 | [Audit log](../01-product-requirements/specs/org/003-audit-log/spec.md) | ORG | C-Audit | 11 |  |
| ORG-004 | [Sign-up, sign-in, 2-step sign-in and invitations](../01-product-requirements/specs/org/004-sign-up-and-sign-in/spec.md) | ORG | W-Home, W-Pricing, sign-up and sign-in pages (not designed) | 13 |  |
| PLT-001 | [Product scope, principles and release scope](../01-product-requirements/specs/platform/001-scope-and-principles/spec.md) | PLATFORM | All | 16 |  |
| PLT-002 | [Brand and visual identity](../01-product-requirements/specs/platform/002-brand/spec.md) | PLATFORM | All | 10 |  |
| PLT-003 | [Control panel shell and navigation](../01-product-requirements/specs/platform/003-shell-and-navigation/spec.md) | PLATFORM | PanelNav, PanelTop, all C- screens | 16 |  |
| PLT-004 | [Design system components, status vocabulary and notices](../01-product-requirements/specs/platform/004-design-system/spec.md) | PLATFORM | All | 22 |  |
| PLT-005 | [Accessibility and localisation](../01-product-requirements/specs/platform/005-accessibility-and-localisation/spec.md) | PLATFORM | All | 11 |  |
| PLT-006 | [Personas, sample data and prototype behaviour](../01-product-requirements/specs/platform/006-sample-data-and-prototype/spec.md) | PLATFORM | All | 4 |  |
| PLT-007 | [Operator portal (as-is) and open decisions](../01-product-requirements/specs/platform/007-operator-portal-and-open-decisions/spec.md) | PLATFORM | O-Tenants, O-Plans, O-CMS, O-Support, O-Business, O-Billing, O-Finance, O-Me, O-Agents, O-Skills, O-Connectors, O-Memory, O-Knowledge, O-Models, O-AI, O-Convos, O-Runs | 5 |  |
| PLT-008 | [Errors, notifications and search](../01-product-requirements/specs/platform/008-errors-notifications-search/spec.md) | PLATFORM | PanelTop, all C- screens | 9 |  |
| WEB-001 | [Public home page](../01-product-requirements/specs/web/001-home/spec.md) | WEB | W-Home | 16 |  |
| WEB-002 | [Public pricing page](../01-product-requirements/specs/web/002-pricing/spec.md) | WEB | W-Pricing | 13 |  |

<!-- rows:end -->
