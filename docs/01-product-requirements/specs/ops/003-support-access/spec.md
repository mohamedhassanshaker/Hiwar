# Feature Specification: Time-limited support access

**Feature ID**: OPS-003
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Support (redesigned for Hiwar), C-Team
**Personas**: Support operator, Owner, Admin

## User Scenarios & Testing

### User Story 1 - Help a customer inside their control panel with consent (Priority: P1)

An Owner or Admin grants Hiwar support time-limited access; a Support operator opens the customer's control panel read-only to diagnose a problem.

**Why this priority**: Support needs to see the customer's set-up to answer quickly, and customers must control access to their conversations (organization isolation is promised on Home).
**Independent Test**: Grant 24-hour access from C-Team, open it as a Support operator, revoke it.

**Acceptance Scenarios**:

1. **AC-OPS-003-01** — **Given** C-Team, **When** the Owner chooses Grant support access, picks 24 hours and whether conversations are included, **Then** a grant is created, shown in C-Team with its expiry and a Revoke action, and recorded in the customer's audit log.
2. **AC-OPS-003-02** — **Given** an active grant, **When** a Support operator opens the organization in O-Support and chooses Open control panel, **Then** the customer's control panel opens read-only with a banner "Hiwar support · read-only · until {time}", and conversation content shows only if the grant includes it.
3. **AC-OPS-003-03** — **Given** support access, **When** the operator views any page, **Then** each page view is recorded in the customer's audit log under Users as "Hiwar support viewed {page}".
4. **AC-OPS-003-04** — **Given** the grant expires or is revoked, **When** the operator acts, **Then** access ends at once.
5. **AC-OPS-003-05** — **Given** no grant, **When** an operator tries to open the control panel, **Then** access is refused.

## Requirements

### Functional Requirements

- **FR-001**: Owners and Admins MUST be able to grant Hiwar support read-only access for 1, 24 or 72 hours, choosing whether conversation content is included, and revoke it at any time.
- **FR-002**: Without an active grant, operators MUST NOT open a customer's control panel or read its conversations.
- **FR-003**: Support access MUST be read-only and MUST show the banner "Hiwar support · read-only · until {time}".
- **FR-004**: Every grant, revoke and page viewed under support access MUST be recorded in the customer's audit log and the operator audit log.
- **FR-005**: O-Support MUST list organizations with active grants and their expiry. [/1.1]

### Key Entities

- **Support grant**: organization, granted by, duration, includes conversations, expires at, revoked at.

## Success Criteria

- **SC-001**: No operator reads customer data without an active grant.

## Assumptions and Open Items

- The earlier O-Convos and O-Runs cross-tenant inspection screens are replaced in P1 by this consented access.
- C-Team gains the Grant support access section ([ORG-001](../../org/001-team-and-security/spec.md)).
