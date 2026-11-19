# Feature Specification: Cost breakdown, incidents and isolation tests

**Feature ID**: OPS-009
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Business
**Personas**: Platform admin, AI operations

## User Scenarios & Testing

### User Story 1 - See where AI cost goes (Priority: P1)

Margin depends on model tier and agent purpose.

**Why this priority**: Margin depends on model tier and agent purpose.
**Independent Test**: Group cost by model tier, agent purpose and who answered.

**Acceptance Scenarios**:

- **AC-OPS-009-01** — **Given** Cost and health, **When** the operator groups by model tier, agent purpose or who answered, **Then** each row shows income, model cost, margin, AI conversations and cost per conversation, with rows above target flagged.

### User Story 2 - Run an incident and block unsafe releases (Priority: P1)

Customers need status updates, and cross-organization leaks must stop releases.

**Why this priority**: Customers need status updates, and cross-organization leaks must stop releases.
**Independent Test**: Post an update, mark fixed, publish a summary; show a failed isolation run.

**Acceptance Scenarios**:

- **AC-OPS-009-02** — **Given** an incident, **When** the operator posts an update, marks it fixed and publishes a summary, **Then** affected Owners and Admins get each message and service health returns to operational.
- **AC-OPS-009-03** — **Given** the nightly isolation run, **When** any cross-organization read succeeds, **Then** releases are blocked until a re-run passes.

## Requirements

### Functional Requirements

- **FR-001**: Cost MUST be groupable by model tier, agent purpose and who answered (AI only, AI then person, test console).
- **FR-002**: The overage summary MUST show organizations with overage on, those at their cap, the amount billed and suspensions.
- **FR-003**: An incident MUST have a status update sent to affected organizations, a Mark fixed action, a published summary and release notes.
- **FR-004**: Service health MUST list control panel, widget and API, agent service, model provider, payments and email.
- **FR-005**: A nightly test MUST try to read each organization's data from another organization's session on every route; one success MUST block releases.

### Key Entities

- **Incident**: title, start, affected organizations, updates, state, summary.
- **Isolation run**: time, routes, attempts, blocked, leaked.

## Success Criteria

- **SC-001**: Zero cross-organization reads in every nightly run.

## Assumptions and Open Items

- The screen functions run on sample data until a backend exists for them; the module README names which ones.
- Builds on [OPS-004](../004-cost-and-health/spec.md).
