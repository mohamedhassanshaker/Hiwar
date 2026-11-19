---
title: Tenancy and roles
status: draft
owner: architect
related: [security.md, ../01-product-requirements/specs/org/002-roles-and-permissions/spec.md]
version: 0.1
last-updated: 2026-11-19
---

# Tenancy and roles

An organization is the tenant. A user can belong to organizations through `members`, each membership with one role. The roles and their capabilities are the matrix of [ORG-002](../01-product-requirements/specs/org/002-roles-and-permissions/spec.md); the code copy is `apps/web/src/server/authz.ts`, and a test asserts it (`apps/web/tests/rules.test.ts`).

Platform roles (`users.platform_role`) are separate: `platform_admin` and `support_operator` reach only the operator portal at `/ops`, need 2-step sign-in, and are granted with `npm run ops:grant`. A platform role gives no access to a customer's control panel; that needs the customer's support grant ([OPS-003](../01-product-requirements/specs/ops/003-support-access/spec.md)).
