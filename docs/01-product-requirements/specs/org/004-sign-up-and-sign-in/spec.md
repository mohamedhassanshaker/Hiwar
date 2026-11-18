# Feature Specification: Sign-up, sign-in, 2-step sign-in and invitations

**Feature ID**: ORG-004
**Module**: ORG — Team, roles, security and audit log
**Status**: Draft
**Sources**: `/4.3`, `/6.8`
**Screens**: W-Home, W-Pricing, sign-up and sign-in pages (not designed)
**Personas**: Prospective customer, Owner, invited member

## User Scenarios & Testing

### User Story 1 - Start free (Priority: P1)

A prospective customer creates an organization and lands in the control panel as its Owner.

**Why this priority**: Start free is the entry to the product (UI spec 4.3) and had no requirements.
**Independent Test**: Choose Start free on Home, sign up, verify the email, reach Conversations.

**Acceptance Scenarios**:

1. **AC-ORG-004-01** — **Given** the visitor chooses Start free, **When** the sign-up page opens, **Then** it asks for name, work email, password and organization name.
2. **AC-ORG-004-02** — **Given** a password shorter than 12 characters or an email already registered, **When** the visitor submits, **Then** the form shows the reason next to the field and no account is created.
3. **AC-ORG-004-03** — **Given** a valid submission, **When** it is sent, **Then** a verification email is sent and the account cannot use the control panel until the link is opened.
4. **AC-ORG-004-04** — **Given** the verification link is opened within 24 hours, **When** it loads, **Then** the organization is created with the visitor as Owner on a 14-day trial of Growth features (100 AI conversations, 1 deployment, no card) and the control panel opens at Conversations (C-Inbox).

### User Story 2 - Sign in and sign out (Priority: P1)

A member signs in with email and password, and with a 2-step code when it is set up or required.

**Why this priority**: Every control panel screen needs a signed-in member.
**Independent Test**: Sign in with and without 2-step sign-in; let the session expire; sign out.

**Acceptance Scenarios**:

1. **AC-ORG-004-05** — **Given** a member with 2-step sign-in, **When** they enter the correct email and password, **Then** they are asked for a 6-digit code from their authenticator app and enter the control panel after a valid code.
2. **AC-ORG-004-06** — **Given** a wrong email or password, **When** the member submits, **Then** the page shows "Email or password is incorrect." without saying which one.
3. **AC-ORG-004-07** — **Given** 5 failed attempts in 15 minutes for one account, **When** a sixth attempt is made, **Then** sign-in for that account is blocked for 15 minutes and the account's email receives a notice.
4. **AC-ORG-004-08** — **Given** the organization requires 2-step sign-in and the member has none, **When** they sign in, **Then** they must set it up (scan a QR code and confirm a code) before reaching any screen.
5. **AC-ORG-004-09** — **Given** a session older than the organization's session length, **When** the member makes a request, **Then** they see "Your session has expired. Sign in again to continue." and return to the same page after signing in.
6. **AC-ORG-004-10** — **Given** a signed-in member, **When** they choose Sign out, **Then** the session ends and the public Home opens.

### User Story 3 - Accept an invitation (Priority: P1)

An invited member joins the organization with the role in the invitation.

**Why this priority**: Teams are built by invitation (ORG-001).
**Independent Test**: Invite a Support Agent, accept, sign in.

**Acceptance Scenarios**:

1. **AC-ORG-004-11** — **Given** an invitation sent less than 7 days ago, **When** the invitee opens the link, sets name and password, **Then** they join with the invited role and the audit log records "joined".
2. **AC-ORG-004-12** — **Given** an invitation older than 7 days or cancelled, **When** the link is opened, **Then** the page says the invitation is no longer valid and to ask for a new one.

### User Story 4 - Reset a forgotten password (Priority: P2)

A member who forgot the password sets a new one by email.

**Why this priority**: Members otherwise lose access.
**Independent Test**: Request a reset and use the link.

**Acceptance Scenarios**:

1. **AC-ORG-004-13** — **Given** the sign-in page, **When** the member chooses Forgot password and enters an email, **Then** the page says a link was sent if the account exists, and the link works once within 1 hour.
2. **AC-ORG-004-14** — **Given** the password is reset, **When** it is saved, **Then** all other sessions of that member end.

### User Story 5 - Trial end (Priority: P1)

A trial that ends without a plan stops the AI but keeps the customer's work.

**Why this priority**: Converting trials is the main revenue path.
**Independent Test**: Move a trial past its end date without a plan.

**Acceptance Scenarios**:

1. **AC-ORG-004-15** — **Given** a trial with 3 days left, **When** the day starts, **Then** the Owner gets an email and a bell notification with Choose a plan.
2. **AC-ORG-004-16** — **Given** the trial ended without a plan, **When** a visitor opens a widget, **Then** it shows the offline message and collects contact details; members can sign in and see a "Trial ended · choose a plan" page with their data intact.
3. **AC-ORG-004-17** — **Given** 90 days after the trial ended without a plan, **When** the day passes, **Then** the organization's data is deleted, after email notices 30 and 7 days before.

## Requirements

### Functional Requirements

- **FR-001**: Start free MUST create an organization from name, work email, password and organization name, with the creator as its Owner. [/4.3]
- **FR-002**: Passwords MUST have at least 12 characters.
- **FR-003**: A new account MUST verify its email through a link valid for 24 hours before using the control panel.
- **FR-004**: After sign-up or sign-in, System MUST open the control panel at Conversations (C-Inbox), or at the page that required sign-in. [/4.3]
- **FR-005**: Sign-in MUST use email and password and, when the member has 2-step sign-in, a 6-digit code from an authenticator app. [/6.8]
- **FR-006**: A failed sign-in MUST show "Email or password is incorrect." without saying which field is wrong.
- **FR-007**: After 5 failed attempts in 15 minutes System MUST block sign-in for that account for 15 minutes and email the account.
- **FR-008**: When the organization requires 2-step sign-in, a member without it MUST set it up before using any screen. [/6.8]
- **FR-009**: A session MUST end after the organization's session length (default 14 days) and show "Your session has expired. Sign in again to continue." [/6.8]
- **FR-010**: Sign out MUST end the session and open the public Home. [/4.3]
- **FR-011**: An invitation link MUST be valid for 7 days and once; accepting it MUST set name and password and give the invited role.
- **FR-012**: Forgot password MUST send a single-use link valid for 1 hour without revealing whether the account exists; a reset MUST end the member's other sessions.
- **FR-013**: A new organization MUST start a 14-day trial of Growth features with 100 AI conversations and 1 deployment, without a card; when it ends without a plan the AI MUST stop, the control panel MUST stay open to choose a plan, and data MUST be kept for 90 days with email notice at 30 and 7 days before deletion.

### Key Entities

- **Account**: name, email, email verified, password (stored only as a salted hash), 2-step secret, failed attempts.
- **Session**: member, created at, expires at.

## Success Criteria

- **SC-001**: A new customer goes from Start free to the control panel in under 3 minutes.

## Assumptions and Open Items

- Sign-up and sign-in pages are not in the design; they follow the public site's brand ([WEB-001](../../web/001-home/spec.md)) and the components of [PLT-004](../../platform/004-design-system/spec.md).
- Single sign-on is P2 and shown as Planned ([WEB-002](../../web/002-pricing/spec.md)).
- The trial terms are in FR-013 and [BIL-001](../../bil/001-plan-and-usage/spec.md) FR-026.
- The values in this spec (12 characters, 24 hours, 7 days, 5 attempts in 15 minutes, 1 hour) are set by this review.
