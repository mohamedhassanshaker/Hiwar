# Feature Specification: Errors, notifications and search

**Feature ID**: PLT-008
**Module**: PLATFORM — Cross-cutting rules, brand, shell, design system, personas, open items
**Status**: Draft
**Sources**: `/4.2`
**Screens**: PanelTop, all C- screens
**Personas**: All staff roles

## User Scenarios & Testing

### User Story 1 - Know what needs attention (Priority: P1)

A staff member sees in the notification bell what needs them: waiting conversations, approvals, usage alerts and failures.

**Why this priority**: Staff must notice a visitor waiting even when not on the inbox.
**Independent Test**: Create each event type and check the bell as each role.

**Acceptance Scenarios**:

1. **AC-PLT-008-01** — **Given** a conversation becomes HANDOVER_PENDING, **When** a Support Agent is signed in, **Then** the bell count increases by 1 and the list shows "{visitor} is waiting for a person" with the reason; choosing it opens the conversation in C-Inbox.
2. **AC-PLT-008-02** — **Given** the conversation is claimed, **When** the bell is opened, **Then** that notification shows as done and no longer counts.
3. **AC-PLT-008-03** — **Given** a usage alert threshold is reached, **When** an Owner or Billing member opens the bell, **Then** it shows the alert linking to Plan and usage; other roles do not get it.
4. **AC-PLT-008-04** — **Given** a knowledge source fails, **When** a Builder opens the bell, **Then** it shows the source name and reason linking to C-Knowledge.
5. **AC-PLT-008-05** — **Given** the bell, **When** the user chooses Mark all as read, **Then** the count returns to 0.

### User Story 2 - Search the control panel (Priority: P2)

A staff member finds a conversation, agent or source from the top bar.

**Why this priority**: Saves navigation time.
**Independent Test**: Search "Fatima", "Layla" and "Menu".

**Acceptance Scenarios**:

1. **AC-PLT-008-06** — **Given** the top-bar search, **When** the user types "Fatima", **Then** results group into Conversations, Agents and Sources and show the conversation with Fatima Al Ketbi; choosing it opens it.
2. **AC-PLT-008-07** — **Given** a Builder, **When** they search, **Then** no conversation results are shown, because the role cannot view conversations.

### User Story 3 - Recover from errors (Priority: P1)

A staff member who loses the connection or whose session expires gets a clear message and keeps their work.

**Why this priority**: UI spec gap 8; staff replying to visitors must not lose messages silently.
**Independent Test**: Cut the network while writing a reply; let a session expire.

**Acceptance Scenarios**:

1. **AC-PLT-008-08** — **Given** the network drops, **When** the panel detects it, **Then** a banner shows "You are offline. Changes are kept and sent when the connection is back." and an unsent reply stays in the composer.
2. **AC-PLT-008-09** — **Given** the connection returns, **When** the panel reconnects, **Then** the banner disappears and live updates resume.
3. **AC-PLT-008-10** — **Given** the session expired, **When** the user acts, **Then** the panel shows "Your session has expired. Sign in again to continue." and returns to the same page after sign-in.
4. **AC-PLT-008-11** — **Given** a server error on an action, **When** it fails, **Then** a toast says what failed and "Try again", and nothing is shown as done.

## Requirements

### Functional Requirements

- **FR-001**: The notification bell MUST list: conversations waiting for a person, write-tool approvals waiting, usage alerts, failed knowledge sources and accepted invitations, each linking to its screen. [/4.2]
- **FR-002**: Notifications MUST go only to roles that can act on them: waiting conversations and approvals to roles that can view and reply; usage alerts to Owner and Billing; failed sources to roles that manage knowledge; accepted invitations to roles that manage the team.
- **FR-003**: The bell count MUST be the number of unread notifications that still need action; a handled item (claimed, approved, fixed) MUST stop counting. [/4.2]
- **FR-004**: Users MUST be able to mark all notifications as read.
- **FR-005**: Top-bar search MUST cover conversations (visitor name and message text), agents (name) and knowledge sources (name), grouped by type, and show only what the user's role may see. [/4.2]
- **FR-006**: On network loss the panel MUST show "You are offline. Changes are kept and sent when the connection is back." and keep unsent input.
- **FR-007**: An expired session MUST show "Your session has expired. Sign in again to continue." and return to the same page after sign-in.
- **FR-008**: A failed action MUST show a toast that names what failed with "Try again", and MUST NOT show the action as done.
- **FR-009**: The offline banner is a blocking error and MAY use a banner ([PLT-004](../004-design-system/spec.md) FR-019).

## Success Criteria

- **SC-001**: A conversation waiting for a person appears in the bell of every signed-in Support Agent within 2 seconds.

## Assumptions and Open Items

- Email notifications in P1 are limited to usage alerts, invitations, sign-in notices and failed payments ([BIL-001](../../bil/001-plan-and-usage/spec.md), [ORG-004](../../org/004-sign-up-and-sign-in/spec.md)).
