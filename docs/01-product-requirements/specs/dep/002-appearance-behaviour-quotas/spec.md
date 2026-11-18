# Feature Specification: Deployment appearance, behaviour and quotas

**Feature ID**: DEP-002
**Module**: DEP — Deployments and the visitor widget
**Status**: Draft
**Sources**: `/6.4`
**Screens**: C-Deployments
**Personas**: Owner, Admin, Builder

## User Scenarios & Testing

### User Story 1 - Style the widget (Priority: P1)

A builder sets the widget's colour, welcome message, position and display options and sees them in a live preview.

**Why this priority**: The widget must match the customer's site.
**Independent Test**: Change each Appearance setting and check the preview.

**Acceptance Scenarios**:

1. **AC-DEP-002-01** — **Given** the Appearance tab, **When** the user changes brand colour, welcome message, position (bottom right / bottom left) or a toggle (show AI label, suggested questions, right-to-left), **Then** the live preview at right shows the change at once and the live widget shows it after saving.
2. **AC-DEP-002-02** — **Given** a brand colour whose text contrast is below WCAG AA, **When** the user saves, **Then** the widget uses a text colour that meets AA on that colour.

### User Story 2 - Control behaviour and quotas per site (Priority: P1)

A builder pins the agent version, overrides language, limits tools, and sets message and concurrency limits and what happens at the limit.

**Why this priority**: Each site needs its own limits and agent version.
**Independent Test**: Pin Catering page to v3, set quotas and the behaviour at limit.

**Acceptance Scenarios**:

1. **AC-DEP-002-03** — **Given** Behavior and quotas, **When** the user chooses Pin to version v3, **Then** the deployment keeps serving v3 after a new version is published; Latest live follows each publish.
2. **AC-DEP-002-04** — **Given** the language override is Arabic, **When** a visitor writes in English, **Then** the agent replies in Arabic.
3. **AC-DEP-002-05** — **Given** the tool subset excludes "Issue a refund", **When** a visitor on this site asks for a refund, **Then** the agent cannot call that tool.
4. **AC-DEP-002-06** — **Given** AI conversations per month is 2,000 and the behaviour at limit is "Stop the AI, show the fallback message and route to a person", **When** the 2,001st AI conversation starts, **Then** the AI does not reply, the widget shows the fallback message and the conversation moves to Needs a person; staff can still reply.
5. **AC-DEP-002-07** — **Given** concurrent conversations is 200 and 200 are open, **When** a new visitor starts a chat, **Then** the behaviour at limit applies to the new conversation.
6. **AC-DEP-002-08** — **Given** the pre-chat form is on, **When** a visitor opens the widget, **Then** they enter name and email (required) and phone (optional) before the first message, and the values show in the inbox Visitor panel.

### Edge Cases

- Latest live is the default when no version is pinned.
- "Allow overage" is disabled while the organization has overage off.
- Pinning to a version that is later rolled back from does not change the pin.

## Requirements

### Functional Requirements

- **FR-001**: The Appearance tab MUST have brand colour, welcome message and position (bottom right / bottom left). [/6.4]
- **FR-002**: The Appearance tab MUST have toggles: show AI label, suggested questions, right-to-left. [/6.4]
- **FR-003**: The Appearance tab MUST show a live preview at right. [/6.4]
- **FR-004**: Behavior and quotas MUST have version pinning (Latest live / Pin to version). [/6.4]
- **FR-005**: Behavior and quotas MUST have a language override. [/6.4]
- **FR-006**: Behavior and quotas MUST have a tool subset: which of the agent's tools this site may use. [/6.4]
- **FR-007**: Behavior and quotas MUST have a monthly quota and concurrent conversations (200). The UI spec quota "messages per month (20,000)" is counted in AI conversations; its default is the organization's plan allowance, and it can be set lower to share the allowance between sites. [/6.4]
- **FR-008**: Behavior and quotas MUST have behaviour at limit: "Stop the AI, show the fallback message and route to a person" (default), "Show offline message", and "Allow overage" (available only when the organization has overage on, [BIL-001](../../bil/001-plan-and-usage/spec.md) FR-025); this replaces the UI spec labels Show offline message / Stop AI / Allow overage. [/6.4]
- **FR-009**: Behavior and quotas MUST have a pre-chat form toggle; the form asks for name (required), email (required) and phone (optional). [/6.4]
- **FR-010**: The behaviour at limit MUST apply to new conversations when concurrent conversations reach the limit, and to new AI conversations when the monthly quota is reached.
- **FR-011**: Staff MUST always be able to reply, whatever limit is reached.
- **FR-012**: The widget MUST keep text on the brand colour at WCAG AA contrast. [/6.4]

### Key Entities

- **Deployment settings**: brand colour, welcome message, position, show AI label, suggested questions, right-to-left, version pin, language override, tool subset, monthly AI conversation quota (default: plan allowance), concurrent conversations (default 200), behaviour at limit, pre-chat form.

## Success Criteria

- **SC-001**: A pinned deployment serves the pinned version regardless of later publishes.

## Assumptions and Open Items

- The design shows 20,000 messages and 200 concurrent conversations as defaults; the quota is now in AI conversations.
