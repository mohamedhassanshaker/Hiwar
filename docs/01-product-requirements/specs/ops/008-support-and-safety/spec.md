# Feature Specification: Support tickets, usage disputes, AI problems, safety and internal roles

**Feature ID**: OPS-008
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Support
**Personas**: Platform admin, Support operator, Safety team, Usage reviewer

## User Scenarios & Testing

### User Story 1 - Answer a ticket with consented access (Priority: P1)

Customers ask for help from the control panel.

**Why this priority**: Customers ask for help from the control panel.
**Independent Test**: Request short-term access on a ticket and send an update.

**Acceptance Scenarios**:

- **AC-OPS-008-01** — **Given** a ticket, **When** the operator requests short-term access with a length and a scope, **Then** the request waits for the Owner or an Admin, and once granted every page viewed is logged in the customer's audit log.
- **AC-OPS-008-02** — **Given** a ticket, **When** the operator saves an internal note or sends an update, **Then** notes are visible only to Hiwar staff and updates reach the customer.

### User Story 2 - Decide a usage dispute (Priority: P1)

Owners can dispute AI conversations counted on an invoice.

**Why this priority**: Owners can dispute AI conversations counted on an invoice.
**Independent Test**: Credit 138 conversations on UD-2207, then show the appeal.

**Acceptance Scenarios**:

- **AC-OPS-008-03** — **Given** a dispute, **When** a Usage reviewer keeps the count or credits conversations with a comment, **Then** the Owner gets the decision and can appeal once to a different reviewer whose decision is final.

### User Story 3 - Handle safety flags and abuse (Priority: P2)

Visitor messages can show a risk of harm, and widgets attract bots.

**Why this priority**: Visitor messages can show a risk of harm, and widgets attract bots.
**Independent Test**: Alert an Owner from a flag, block a bot source.

**Acceptance Scenarios**:

- **AC-OPS-008-04** — **Given** a safety flag, **When** the Safety team alerts the Owner, **Then** the Owner gets only what they need to act; the extract is not shared.
- **AC-OPS-008-05** — **Given** a bot burst on a widget, **When** rate limiting triggers, **Then** conversations from the source are blocked and not counted until unblocked.

## Requirements

### Functional Requirements

- **FR-001**: Tickets MUST show the customer, plan, first-response target and a queue by priority; response targets come from the plan.
- **FR-002**: Short-term access MUST be granted by the customer's Owner or Admin, time-limited and read-only ([OPS-003](../003-support-access/spec.md)).
- **FR-003**: Usage disputes MUST be raised within 30 days of the invoice with a reason and decided within 5 working days; one appeal to a second reviewer MUST be final.
- **FR-004**: AI problems MUST group reports across organizations with the prompt version, model route and source, and MUST allow pausing an agent template platform-wide.
- **FR-005**: Safety flags MUST show only the flagged message and the 2 messages around it; every view MUST be logged; closing MUST need a logged reason.
- **FR-006**: Abuse detection MUST block bursts of widget conversations from one source without counting them, and MUST allow unblocking.
- **FR-007**: Messages flagged in several organizations MUST be blockable into a shared filter or allowed.
- **FR-008**: Internal roles MUST follow least access: Platform admin, Support operator, Usage reviewer, Finance, Safety team, AI operations, Read-only analyst; Finance MUST NOT open customer data.

### Key Entities

- **Ticket**: number, organization, requester, priority, due time, notes, updates.
- **Usage dispute**: invoice, conversations, reason, decision, reviewer, appeal.
- **Safety flag**: organization, extract, state, actions taken.

## Success Criteria

- **SC-001**: P1 tickets get a first response within 1 working hour.

## Assumptions and Open Items

- The screen functions run on sample data until a backend exists for them; the module README names which ones.
