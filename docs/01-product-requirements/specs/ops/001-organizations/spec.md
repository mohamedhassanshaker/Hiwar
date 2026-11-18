# Feature Specification: Operator organizations list and actions

**Feature ID**: OPS-001
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Tenants (redesigned for Hiwar)
**Personas**: Platform admin, Support operator

## User Scenarios & Testing

### User Story 1 - Find and inspect a customer organization (Priority: P1)

A Hiwar operator finds an organization and sees its plan, status, usage and owner.

**Why this priority**: Support and billing questions start with "which customer, which plan, what usage".
**Independent Test**: Search "Gulf Bites" and open the organization.

**Acceptance Scenarios**:

1. **AC-OPS-001-01** — **Given** O-Tenants, **When** it renders, **Then** it lists organizations with name, owner email, plan (Trial, Starter, Growth, Business, Enterprise), status (Trial, Active, Past due, Suspended, Trial ended), AI conversations this month of the allowance, and created date, with search and native selects for plan and status.
2. **AC-OPS-001-02** — **Given** the list, **When** the operator opens Gulf Bites Restaurants, **Then** the detail shows plan and renewal date, usage meters, members count, deployments with status and origins, trial end or payment status, and the organization's audit entries from the operator portal.
3. **AC-OPS-001-03** — **Given** a Support operator, **When** they open the detail, **Then** they see it read-only, with no conversation content.

### User Story 2 - Act on an organization (Priority: P1)

A Platform admin extends a trial, suspends or reactivates an organization, or changes its plan.

**Why this priority**: Converting trials and stopping abuse or non-payment are revenue and risk controls.
**Independent Test**: Extend a trial by 7 days; suspend and reactivate an organization.

**Acceptance Scenarios**:

1. **AC-OPS-001-04** — **Given** an organization on trial, **When** a Platform admin chooses Extend trial, picks 7 days and gives a reason, **Then** the trial end moves 7 days later and the action is recorded with the reason.
2. **AC-OPS-001-05** — **Given** an active organization, **When** a Platform admin chooses Suspend and gives a reason, **Then** its widgets show the offline message, its members see "This organization is suspended. Contact support." on sign-in, its data is kept, and the Owner is emailed.
3. **AC-OPS-001-06** — **Given** a suspended organization, **When** a Platform admin chooses Reactivate, **Then** widgets and access return as before.
4. **AC-OPS-001-07** — **Given** an Enterprise deal, **When** a Platform admin sets the plan to Enterprise with custom limits, **Then** the organization's meters and limits use them at once.

### Edge Cases

- Every operator action needs a reason and is recorded in the operator audit log with operator, time, organization, action and reason.
- Operators cannot delete an organization from the portal in P1; deletion follows the trial data retention of [ORG-004](../../org/004-sign-up-and-sign-in/spec.md) FR-013.

## Requirements

### Functional Requirements

- **FR-001**: O-Tenants MUST list organizations with name, owner email, plan, status, AI conversations this month of the allowance, and created date, with search and plan and status selects. [/1.1]
- **FR-002**: The organization detail MUST show plan and renewal, usage meters, members count, deployments with status and origins, trial or payment status, and operator actions taken.
- **FR-003**: Platform admins MUST be able to extend a trial (1 to 30 days), suspend, reactivate and change the plan or set Enterprise custom limits, each with a required reason.
- **FR-004**: A suspended organization MUST show the offline message in its widgets, MUST block its members' sign-in with "This organization is suspended. Contact support.", MUST keep its data, and MUST email the Owner.
- **FR-005**: Support operators MUST have read-only access to the list and detail, without conversation content.
- **FR-006**: Every operator action MUST be recorded in the operator audit log with operator, time, organization, action and reason; the log MUST NOT be editable.
- **FR-007**: The operator portal MUST be reachable only by Hiwar staff accounts with a platform role and 2-step sign-in; customer accounts MUST NOT reach it.

### Key Entities

- **Organization**: name, owner, plan, status (Trial, Active, Past due, Suspended, Trial ended), trial end, renewal date, custom limits.
- **Operator action**: operator, time, organization, action, reason.
- **Platform role**: Platform admin, Support operator.

## Success Criteria

- **SC-001**: An operator finds any organization and its plan and usage in under 30 seconds.

## Assumptions and Open Items

- The O-Tenants board carries the earlier product's wording; the screen is rebuilt for these requirements with the components of `hiwar.css`.
