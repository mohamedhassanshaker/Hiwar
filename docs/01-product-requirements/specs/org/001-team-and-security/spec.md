# Feature Specification: Team members, invitations and security settings

**Feature ID**: ORG-001
**Module**: ORG — Team, roles, security and audit log
**Status**: Draft
**Sources**: `/6.8`
**Screens**: C-Team
**Personas**: Owner, Admin

## User Scenarios & Testing

### User Story 1 - Manage members (Priority: P1)

The owner invites members, changes their roles and removes them.

**Why this priority**: Staff need accounts and roles to use the inbox and builder.
**Independent Test**: Invite a Builder, change the role to Analyst, remove the member.

**Acceptance Scenarios**:

1. **AC-ORG-001-01** — **Given** the members table, **When** it renders, **Then** each row has name, email, role (select), 2-step sign-in status and last active.
2. **AC-ORG-001-02** — **Given** the user chooses Invite member, **When** they enter "huda@gulfbites.example", role Billing and an optional message and send, **Then** an invitation email is sent, the member appears as Invited, a seat is counted and the audit log records "Invited · role Billing".
3. **AC-ORG-001-03** — **Given** all seats of the plan are in use, **When** the user sends an invitation, **Then** it is refused with the seat limit and an Upgrade link.
4. **AC-ORG-001-04** — **Given** a Builder, **When** the Owner changes the role to Analyst, **Then** the change applies immediately: the member loses Agents access on the next request without signing in again, and the audit log records "Builder to Analyst".
5. **AC-ORG-001-05** — **Given** a member, **When** the user chooses Remove member and confirms, **Then** the member loses access at once, conversations they owned return to Needs a person with reason `released`, and the seat is freed.
6. **AC-ORG-001-06** — **Given** the Owner row, **When** shown, **Then** the role select is locked and Remove is not available.

### User Story 2 - Set security policy (Priority: P2)

The owner requires 2-step sign-in and sets the session length.

**Why this priority**: Protects access to conversations and settings.
**Independent Test**: Turn on Require 2-step sign-in; change the session length.

**Acceptance Scenarios**:

1. **AC-ORG-001-07** — **Given** the Security section, **When** it renders, **Then** it has a Require 2-step sign-in switch and a session length select (1, 7, 14 or 30 days) defaulting to 14 days.
2. **AC-ORG-001-08** — **Given** Require 2-step sign-in is turned on, **When** a member without 2-step sign-in next signs in, **Then** they must set it up before using the control panel ([ORG-004](../004-sign-up-and-sign-in/spec.md)).
3. **AC-ORG-001-09** — **Given** the session length is 7 days, **When** a member's session is older than 7 days, **Then** they are asked to sign in again.

### Edge Cases

- A role change applies immediately; a plain note on the screen says so.
- The Owner role cannot be assigned to another member (FR-008); transferring ownership is not in P1.
- An invitation can be resent or cancelled while it is pending.

## Requirements

### Functional Requirements

- **FR-001**: The members table MUST show name, email, role (select), 2-step sign-in status and last active. [/6.8]
- **FR-002**: The Owner's role MUST be locked. [/6.8]
- **FR-003**: Remove member MUST ask for confirmation. [/6.8]
- **FR-004**: The Invite member dialog MUST have email, role and an optional message. [/6.8]
- **FR-005**: Security MUST have a Require 2-step sign-in switch. [/6.8]
- **FR-006**: Security MUST have a session length, 14 days by default, with the options 1, 7, 14 and 30 days. [/6.8]
- **FR-007**: Role changes MUST apply immediately, and a plain note MUST describe this. [/6.8]
- **FR-008**: Each organization MUST have exactly one Owner; the Owner role MUST NOT be assignable in the role select or the invite dialog. [/6.8]
- **FR-009**: Invitations and active members MUST count against the plan's seats; an invitation beyond the limit MUST be refused with an Upgrade link. [/6.8]
- **FR-010**: Removing a member MUST end their access at once and MUST return conversations they owned to HANDOVER_PENDING with the reason `released`. [/6.8]
- **FR-011**: Users MUST be able to resend or cancel a pending invitation.
- **FR-012**: Invitations, role changes, removals and security changes MUST be recorded in the audit log.
- **FR-013**: Security MUST offer Grant support access with its active grant, expiry and Revoke ([OPS-003](../../ops/003-support-access/spec.md)).

### Key Entities

- **Member**: name, email, role (Owner, Admin, Builder, Support Agent, Analyst, Billing), status (Invited, Active), 2-step sign-in status, last active.
- **Invitation**: email, role, optional message, sent at, expires at.
- **Security settings**: require 2-step sign-in, session length.

## Success Criteria

- **SC-001**: A role change applies immediately.

## Assumptions and Open Items

- Roles and their capabilities: [ORG-002](../002-roles-and-permissions/spec.md). Sign-up, sign-in and invitation acceptance: [ORG-004](../004-sign-up-and-sign-in/spec.md).
- Seats count against the plan's seats meter ([BIL-001](../../bil/001-plan-and-usage/spec.md)).
- The C-Team board is listed in the design canvas but missing from the handoff zip; these requirements come from the UI spec and this review; the screen gets a design review once implemented.
