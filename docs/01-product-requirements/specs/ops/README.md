---
title: Operator portal for the Hiwar team
status: draft
owner: product owner
related: [../../../00-input-requirements/Hiwar-UI-Specification.md]
version: 0.1
last-updated: 2026-11-18
---

# ops: Operator portal for the Hiwar team

The minimal P1 operator portal: customer organizations, plans and prices, consented support access, and AI cost and service health. Only Hiwar staff with a platform role use it.



## Feature specs

- [OPS-001](001-organizations/spec.md): Operator organizations list and actions
- [OPS-002](002-plans-and-prices/spec.md): Operator plans and prices
- [OPS-003](003-support-access/spec.md): Time-limited support access
- [OPS-004](004-cost-and-health/spec.md): AI cost, margin and service health
- [OPS-005](005-organization-setup-and-overrides/spec.md): Organization setup, plan overrides and grace periods
- [OPS-006](006-plan-catalogue-and-add-ons/spec.md): Plan comparison, cost price list, packs and overage
- [OPS-007](007-website-content/spec.md): Public website content, featured items, offers and results
- [OPS-008](008-support-and-safety/spec.md): Support tickets, usage disputes, AI problems, safety and internal roles
- [OPS-009](009-cost-breakdown-incidents-isolation/spec.md): Cost breakdown, incidents and isolation tests
- [OPS-010](010-subscriptions-and-invoices/spec.md): Subscriptions, invoices, overage lines, credit notes and coupons
- [OPS-011](011-payments-and-ledger/spec.md): Append-only ledger, allowance entries, payment events and disputes

Code path: `apps/web/src/app/ops`. OPS-005 to OPS-011 extend the real screens with functions that run on sample data in the browser (`components/mock.tsx`, `mock/tenants.ts`) until they get a backend; each page says so.
