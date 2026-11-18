---
title: Feature specs
status: draft
owner: product owner
related: [../../00-input-requirements/Hiwar-UI-Specification.md]
version: 0.1
last-updated: 2026-11-18
---

# Feature specs

One `spec.md` per feature, grouped by module. Source: [Hiwar UI Specification](../../00-input-requirements/Hiwar-UI-Specification.md). Section keys in each spec's `Sources` line come from `coverage.py index` (for example `/6.1` is UI spec section 6.1).

UI coverage ledgers, one per design artboard, are in [ui-coverage](ui-coverage/). They map every function of the P1 boards in the handoff zip to a requirement.

## Modules

- [inb](inb/README.md): Conversations inbox, takeover and handback
- [agt](agt/README.md): Agents: configuration, testing, versions
- [kno](kno/README.md): Knowledge sources and unanswered questions
- [dep](dep/README.md): Deployments and the visitor widget
- [ana](ana/README.md): Analytics
- [bil](bil/README.md): Plan, usage and invoices
- [org](org/README.md): Team, roles, security and audit log
- [web](web/README.md): Public website
- [ops](ops/README.md): Operator portal for the Hiwar team
- [platform](platform/README.md): Cross-cutting rules, brand, shell, design system, personas, open items

<!-- features:start -->

## Features by module

### [inb](inb/README.md) — Conversations inbox, takeover and handback

| ID | Feature |
| --- | --- |
| INB-001 | [Inbox list, thread and details](inb/001-inbox-list-and-thread/spec.md) |
| INB-002 | [Conversation ownership, takeover and handback](inb/002-conversation-ownership/spec.md) |
| INB-003 | [Write-tool approval in the inbox](inb/003-write-tool-approval/spec.md) |

### [agt](agt/README.md) — Agents: configuration, testing, versions

| ID | Feature |
| --- | --- |
| AGT-001 | [Agent configuration](agt/001-agent-configuration/spec.md) |
| AGT-002 | [Agent versions, publish and roll back](agt/002-agent-versions/spec.md) |
| AGT-003 | [Agent test console](agt/003-test-console/spec.md) |

### [kno](kno/README.md) — Knowledge sources and unanswered questions

| ID | Feature |
| --- | --- |
| KNO-001 | [Knowledge sources and ingestion](kno/001-knowledge-sources/spec.md) |
| KNO-002 | [Unanswered questions](kno/002-unanswered-questions/spec.md) |

### [dep](dep/README.md) — Deployments and the visitor widget

| ID | Feature |
| --- | --- |
| DEP-001 | [Deployment install, keys, origins and go-live](dep/001-install-and-origins/spec.md) |
| DEP-002 | [Deployment appearance, behaviour and quotas](dep/002-appearance-behaviour-quotas/spec.md) |
| DEP-003 | [Visitor chat widget](dep/003-visitor-widget/spec.md) |

### [ana](ana/README.md) — Analytics

| ID | Feature |
| --- | --- |
| ANA-001 | [Analytics dashboard](ana/001-analytics-dashboard/spec.md) |

### [bil](bil/README.md) — Plan, usage and invoices

| ID | Feature |
| --- | --- |
| BIL-001 | [Plan and usage](bil/001-plan-and-usage/spec.md) |

### [org](org/README.md) — Team, roles, security and audit log

| ID | Feature |
| --- | --- |
| ORG-001 | [Team members, invitations and security settings](org/001-team-and-security/spec.md) |
| ORG-002 | [Roles and permission matrix](org/002-roles-and-permissions/spec.md) |
| ORG-003 | [Audit log](org/003-audit-log/spec.md) |
| ORG-004 | [Sign-up, sign-in, 2-step sign-in and invitations](org/004-sign-up-and-sign-in/spec.md) |

### [web](web/README.md) — Public website

| ID | Feature |
| --- | --- |
| WEB-001 | [Public home page](web/001-home/spec.md) |
| WEB-002 | [Public pricing page](web/002-pricing/spec.md) |

### [ops](ops/README.md) — Operator portal for the Hiwar team

| ID | Feature |
| --- | --- |
| OPS-001 | [Operator organizations list and actions](ops/001-organizations/spec.md) |
| OPS-002 | [Operator plans and prices](ops/002-plans-and-prices/spec.md) |
| OPS-003 | [Time-limited support access](ops/003-support-access/spec.md) |
| OPS-004 | [AI cost, margin and service health](ops/004-cost-and-health/spec.md) |

### [platform](platform/README.md) — Cross-cutting rules, brand, shell, design system, personas, open items

| ID | Feature |
| --- | --- |
| PLT-001 | [Product scope, principles and release scope](platform/001-scope-and-principles/spec.md) |
| PLT-002 | [Brand and visual identity](platform/002-brand/spec.md) |
| PLT-003 | [Control panel shell and navigation](platform/003-shell-and-navigation/spec.md) |
| PLT-004 | [Design system components, status vocabulary and notices](platform/004-design-system/spec.md) |
| PLT-005 | [Accessibility and localisation](platform/005-accessibility-and-localisation/spec.md) |
| PLT-006 | [Personas, sample data and prototype behaviour](platform/006-sample-data-and-prototype/spec.md) |
| PLT-007 | [Operator portal (as-is) and open decisions](platform/007-operator-portal-and-open-decisions/spec.md) |
| PLT-008 | [Errors, notifications and search](platform/008-errors-notifications-search/spec.md) |

<!-- features:end -->
