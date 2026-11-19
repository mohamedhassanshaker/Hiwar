# Feature Specification: My profile, account menu and organization switcher

**Feature ID**: PLT-009
**Module**: PLATFORM — Cross-cutting rules
**Status**: Draft
**Sources**: `/1.1`
**Screens**: Profile, Topbar, Sidebar, O-Me
**Personas**: Every member, operators

## User Scenarios & Testing

### User Story 1 - Manage my own account (Priority: P1)

People change their name, password and sessions without asking an admin.

**Why this priority**: People change their name, password and sessions without asking an admin.
**Independent Test**: Change the name and password; sign out of other sessions.

**Acceptance Scenarios**:

- **AC-PLT-009-01** — **Given** My profile, **When** the person saves a new name, **Then** the name changes everywhere it is shown.
- **AC-PLT-009-02** — **Given** Sign-in and security, **When** the person changes the password with the current one, **Then** the password changes and every other session is signed out.
- **AC-PLT-009-03** — **Given** Sign-in and security, **When** the person chooses Sign out of other sessions, **Then** all other sessions end and this one stays.

### User Story 2 - Switch organization (Priority: P1)

A person can belong to several organizations.

**Why this priority**: A person can belong to several organizations.
**Independent Test**: As a member of two organizations, switch from the top bar.

**Acceptance Scenarios**:

- **AC-PLT-009-04** — **Given** a member of more than one organization, **When** they pick another organization in the top bar, **Then** the session moves to it, the panel reloads in that organization and suspended organizations can't be picked.

## Requirements

### Functional Requirements

- **FR-001**: My profile MUST show personal details, sign-in and security, notifications, payment methods (Owner only) and privacy and data.
- **FR-002**: Changing the password MUST check the current password, need at least 12 characters and sign out other sessions.
- **FR-003**: The sessions list MUST show when each session started and ends, marking this session.
- **FR-004**: 2-step sign-in MUST show its state and link to set-up when off.
- **FR-005**: Security notifications MUST always be sent.
- **FR-006**: The account menu MUST offer My profile, Plan and usage (Owner), Help and support, and Sign out; the sidebar user chip MUST open My profile.
- **FR-007**: The organization switcher MUST list only organizations the person belongs to and MUST NOT be offered under support access.
- **FR-008**: Help and support MUST offer guides, contact and service status.
- **FR-009**: Operators MUST have the same profile at O-Me without payment methods.

### Key Entities

- **Session**: started, expires, current.

## Success Criteria

- **SC-001**: A person changes their password in under 1 minute.

## Assumptions and Open Items

- Name, password, 2-step state, sessions and the organization switch are live; photo, email change, linked sign-in providers, notification settings, export and deletion are sample until built.
