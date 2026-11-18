# Feature Specification: Visitor chat widget

**Feature ID**: DEP-003
**Module**: DEP — Deployments and the visitor widget
**Status**: Draft
**Sources**: `/6.5`, `/1.2`
**Screens**: C-Widget
**Personas**: Visitor

## User Scenarios & Testing

### User Story 1 - Chat with the AI (Priority: P1)

A visitor opens the chat bubble on the customer's site and chats with the agent, clearly labelled as AI.

**Why this priority**: This is the visitor's whole experience.
**Independent Test**: Open the widget on the mock Gulf Bites site and send a message.

**Acceptance Scenarios**:

1. **AC-DEP-003-01** — **Given** the site shows the chat bubble ("Open chat"), **When** the visitor opens it, **Then** a panel shows the header (agent name "Layla" and "AI assistant"), the welcome message, suggested questions, the input "Write a message", **Talk to a person**, and "AI assistant · answers may be imperfect".
2. **AC-DEP-003-02** — **Given** the panel, **When** the visitor types and presses Enter or Send, **Then** the message is sent and the typing line "Layla is typing…" shows until the reply; Send is disabled while the input is empty.
3. **AC-DEP-003-03** — **Given** the visitor has sent a first message, **When** the panel renders, **Then** the suggested questions are hidden.
4. **AC-DEP-003-04** — **Given** the panel is open, **When** the visitor chooses "Close chat", **Then** the panel closes to the bubble and the conversation is kept.

### User Story 2 - Reach a person (Priority: P1)

A visitor asks for a person, waits or cancels, is connected and later handed back to the assistant.

**Why this priority**: Human takeover must be visible to the visitor.
**Independent Test**: Step through each widget state.

**Acceptance Scenarios**:

1. **AC-DEP-003-05** — **Given** the visitor chose Talk to a person, **When** waiting, **Then** the header shows "Waiting for our team" and "Usually under 2 minutes", the thread shows "You asked for a person. We are finding someone from the team." and "A person will join shortly", and a Cancel link.
2. **AC-DEP-003-06** — **Given** the visitor is waiting, **When** they choose Cancel, **Then** the AI continues the conversation.
3. **AC-DEP-003-07** — **Given** Khalid claims the conversation, **When** the panel updates, **Then** it shows "A team member has joined", the header shows "Khalid from support" with his avatar and "A real person · online", and the AI label is not shown.
4. **AC-DEP-003-08** — **Given** Khalid hands back with "Tell the visitor that the assistant is back" checked, **When** the panel updates, **Then** it shows "The team member left. Layla will continue with you." and the AI label returns; with the box unchecked no note is shown.
5. **AC-DEP-003-09** — **Given** no one claims within the claim wait and the agent's behaviour is "Collect contact details and promise follow-up", **When** the time passes, **Then** the widget asks for contact details and promises follow-up.
6. **AC-DEP-003-10** — **Given** the deployment is paused or the offline behaviour applies, **When** the visitor opens the widget, **Then** it shows "We are offline right now" and "Leave your email and we will reply tomorrow morning." with a field to leave an email and a message.

### User Story 3 - Use the widget in Arabic (Priority: P1)

An Arabic visitor uses the widget right to left with Arabic copy.

**Why this priority**: The widget is bilingual by principle.
**Independent Test**: Switch the language to Arabic.

**Acceptance Scenarios**:

1. **AC-DEP-003-11** — **Given** the widget, **When** Arabic is chosen, **Then** the layout and bubbles are mirrored, text is aligned right, `dir="rtl"` is set, and Arabic copy is used for the welcome message, suggested questions, labels and states (for example "تحدث مع شخص", "مساعد ذكي · قد تكون الإجابات غير دقيقة").

### User Story 4 - Confirm, rate and recover (Priority: P2)

The visitor confirms write actions, rates the conversation, and sees clear messages when the connection drops.

**Why this priority**: Completes the visitor-side rules of tool confirmation, feedback and errors.
**Independent Test**: Trigger a write tool with "Ask the visitor first", close the conversation, and cut the network.

**Acceptance Scenarios**:

1. **AC-DEP-003-12** — **Given** a write tool with the policy "Ask the visitor first", **When** the AI proposes it, **Then** the widget shows what will be done with Confirm and Cancel ([INB-003](../../inb/003-write-tool-approval/spec.md)).
2. **AC-DEP-003-13** — **Given** staff close the conversation, **When** the widget updates, **Then** it asks "Was this helpful?" with Yes and No, and the answer is stored.
3. **AC-DEP-003-14** — **Given** the network drops, **When** the visitor sends a message, **Then** the widget shows "Connection lost. We will send your message when you are back online." and sends it after reconnecting.

## Requirements

### Functional Requirements

- **FR-001**: The widget MUST open from a chat bubble into a panel with header (agent name, "AI assistant" label), message list, suggested questions, input and **Talk to a person**. [/6.5]
- **FR-002**: The widget MUST support English and Arabic with an EN / Arabic RTL toggle; Arabic MUST mirror the layout, align text right and use Arabic copy. [/6.5]
- **FR-003**: The widget MUST support the states AI replying, Waiting for a person, Person connected, Handed back and Offline. [/6.5]
- **FR-004**: Waiting for a person MUST show a short "A person will join shortly" line and a Cancel link. [/6.5]
- **FR-005**: Person connected MUST show the person's name and avatar. [/6.5]
- **FR-006**: Handed back MUST show a note that the assistant is back, when the staff member left "Tell the visitor that the assistant is back" checked. [/6.5]
- **FR-007**: Offline MUST let the visitor leave a message or contact details. [/6.5]
- **FR-008**: The AI label MUST be visible whenever the AI is replying. [/6.5]
- **FR-009**: When a person is connected, the header MUST show the person's name instead of the AI label. [/6.5]
- **FR-010**: The widget MUST label the AI so visitors know when they talk to it. [/1.2]
- **FR-011**: System MUST show "AI assistant · answers may be imperfect" under the widget input. [UI:C-Widget]
- **FR-012**: System MUST show "Waiting for our team" and "Usually under 2 minutes" in the header and "You asked for a person. We are finding someone from the team." in the thread while waiting, together with the Cancel link of FR-004. [UI:C-Widget]
- **FR-013**: System MUST show "A team member has joined" when a person connects, with the header "{name} from support" and "A real person · online". [UI:C-Widget]
- **FR-014**: System MUST show "The team member left. Layla will continue with you." when the conversation is handed back. [UI:C-Widget]
- **FR-015**: System MUST show "We are offline right now" and "Leave your email and we will reply tomorrow morning." when offline. [UI:C-Widget]
- **FR-016**: Users MUST be able to open and close the chat panel, send with Enter or the Send button (disabled while empty), in an input labelled "Write a message". [UI:C-Widget]
- **FR-017**: System MUST show suggested questions only before the visitor's first message. [UI:C-Widget]
- **FR-018**: Cancel while waiting MUST return the conversation to the AI ([INB-002](../../inb/002-conversation-ownership/spec.md) FR-032).
- **FR-019**: The widget MUST ask for contact details and promise follow-up when the no-person behaviour "Collect contact details and promise follow-up" applies.
- **FR-020**: After a conversation closes, the widget MUST ask "Was this helpful?" with Yes and No.
- **FR-021**: The widget MUST show "Connection lost. We will send your message when you are back online." when the network drops, and send queued messages after reconnecting.
- **FR-022**: The widget MUST show the pre-chat form before the first message when it is on ([DEP-002](../002-appearance-behaviour-quotas/spec.md) FR-009).
- **FR-023**: The widget MUST keep the conversation when the panel is closed and reopened on the same site. [/6.5]

## Success Criteria

- **SC-001**: In every widget state the visitor can tell whether the AI or a person is replying.
- **SC-002**: The widget script is under 60 KB and loads without blocking the page ([WEB-001](../../web/001-home/spec.md)).

## Assumptions and Open Items

- C-Widget shows the visitor experience on a mock Gulf Bites site; the state switcher above the preview is prototype-only.
- Appearance and the behaviour at limit are configured in [DEP-002](../002-appearance-behaviour-quotas/spec.md); Pause in [DEP-001](../001-install-and-origins/spec.md).
