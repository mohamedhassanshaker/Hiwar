# Feature Specification: Inbox list, thread and details

**Feature ID**: INB-001
**Module**: INB — Conversations inbox, takeover and handback
**Status**: Draft
**Sources**: `/6.1`
**Screens**: C-Inbox
**Personas**: Owner, Admin, Support Agent

## User Scenarios & Testing

### User Story 1 - Watch every conversation live (Priority: P1)

A staff member opens Conversations and sees every conversation in a list, filters it by tab, deployment, period and text, and opens one to read the thread.

**Why this priority**: Watching conversations live is the purpose of the signature screen and the precondition for every takeover.
**Independent Test**: Load the seed conversations, switch tabs and selects, search, open each conversation and check the list item and thread header.

**Acceptance Scenarios**:

1. **AC-INB-001-01** — **Given** the seed conversations c1, c2 and c3, **When** the user opens C-Inbox, **Then** the list rail shows the tabs All 3, Needs a person 1, With the AI 1 and With the team 1, each count as a plain number.
2. **AC-INB-001-02** — **Given** the list rail, **When** the user chooses Needs a person, **Then** only HANDOVER_PENDING conversations are listed (c2); With the AI lists only c1; With the team lists only c3; All lists open and closed conversations.
3. **AC-INB-001-03** — **Given** the deployment select is set to Catering page, **When** the list renders, **Then** only conversations of that deployment are listed (c3); setting the period select to Today hides conversations whose last message is before today.
4. **AC-INB-001-04** — **Given** the search field, **When** the user types "Sharjah", **Then** only conversations with a message containing "Sharjah" or a visitor name matching it are listed (c1).
5. **AC-INB-001-05** — **Given** a list item, **When** it renders, **Then** it shows the visitor name, last message snippet (events and internal notes excluded), time, a `.stt` dot with its text label, and the site name as muted text.
6. **AC-INB-001-06** — **Given** a selected conversation, **When** the thread renders, **Then** the header shows the visitor name, the site and language ("Order site · Abu Dhabi · Arabic (Gulf)"), the `.stt` dot with label, and the version in monospace as `v{n}`.
7. **AC-INB-001-07** — **Given** c2 is HANDOVER_PENDING and has waited 1 min 40 s, **When** it is selected, **Then** the header shows "Waiting 1 min 40 s" and a **Claim** button.
8. **AC-INB-001-08** — **Given** c3 is owned by Khalid and the viewer is Noura, **When** it is selected, **Then** the header shows "Khalid is replying".
9. **AC-INB-001-09** — **Given** the filters match no conversation, **When** the list renders, **Then** it shows "No conversations match these filters." and a clear-filters link; choosing the link resets tab, selects and search and lists every conversation.

### User Story 2 - Read the thread and see what the AI used (Priority: P1)

A staff member reads every message with its sender, sees events and citations, and checks the details panel before acting.

**Why this priority**: Staff decide whether to take over from what the thread and details show.
**Independent Test**: Open c1, c2 and c3 and check messages, events and the three details sections.

**Acceptance Scenarios**:

1. **AC-INB-001-10** — **Given** c1, **When** the thread renders, **Then** visitor messages are labelled with the visitor name, AI messages "Layla (AI assistant)" with the cited source "Delivery policy · FAQ", and the typing indicator "Layla is writing a reply…" shows while the AI generates.
2. **AC-INB-001-11** — **Given** c2, **When** the thread renders, **Then** the event "Visitor asked for a person. Reason code: visitor_request. Staff notified." is shown inline between messages.
3. **AC-INB-001-12** — **Given** a selected conversation, **When** the details panel renders, **Then** the Visitor section shows name, language, page, deployment, started, device and country, and earlier chats.
4. **AC-INB-001-13** — **Given** c2, **When** the details panel renders, **Then** Ownership history lists "AI took the conversation · 10:35 · first visitor message · v1" and "Handover requested · 10:38 · visitor_request · v2".
5. **AC-INB-001-14** — **Given** c2, **When** the details panel renders, **Then** "What the AI used" lists `lookup_order` as "Read tool · order 4821 found · ok" and `issue_refund` as "Write tool · needs human approval · not run", and the visitor's widget shows none of this.
6. **AC-INB-001-15** — **Given** the visitor filled the pre-chat form or left contact details, **When** the Visitor section renders, **Then** it shows the name, email and phone given.

### User Story 3 - Use the inbox on a phone (Priority: P2)

A staff member on a phone moves from the list to a thread and to the details.

**Why this priority**: Staff take over from phones outside the office; the three-column layout does not fit.
**Independent Test**: Load C-Inbox at 390 px wide.

**Acceptance Scenarios**:

1. **AC-INB-001-16** — **Given** a viewport below 768 px, **When** the user opens C-Inbox, **Then** only the list shows; choosing a conversation shows only the thread with a back control; a details control shows the details panel; back returns to the previous view.

### Edge Cases

- HANDOVER_PENDING conversation: the thread header shows "Waiting {time}" and a **Claim** button (claim rules in [INB-002](../002-conversation-ownership/spec.md)).
- Conversation owned by another person: the thread header shows "{name} is replying".
- A conversation whose state changes while it is listed moves between tabs at once and the counts update.
- Closed conversations appear only under All.

## Requirements

### Functional Requirements

- **FR-001**: System MUST show C-Inbox in three columns: list rail, thread, details panel. [/6.1]
- **FR-002**: The list rail MUST offer tabs All / Needs a person / With the AI / With the team, each with a plain count; All includes closed conversations. [/6.1]
- **FR-003**: The list rail MUST offer two native selects: deployment (All sites and each deployment) and period (FR-016); there is no status select because the tabs filter by status. [/6.1]
- **FR-004**: Each list item MUST show visitor name, last message snippet, time, `.stt` dot + label, and the site name as muted text. [/6.1]
- **FR-005**: The thread header MUST show the visitor name, the `.stt` dot + label, and the ownership version in monospace as `v{n}`. [/6.1]
- **FR-006**: When the conversation is HANDOVER_PENDING, the thread header MUST show "Waiting {time}" text and a **Claim** button. [/6.1]
- **FR-007**: When another person owns the conversation, the thread header MUST show "{name} is replying". [/6.1]
- **FR-008**: Each message MUST carry a sender label: Visitor, AI, the person's name, or internal note. [/6.1]
- **FR-009**: The thread MUST show an AI typing indicator while the AI is generating a reply. [/6.1]
- **FR-010**: The thread MUST end with the composer described in [INB-002](../002-conversation-ownership/spec.md). [/6.1]
- **FR-011**: The details panel MUST show visitor info: name, language, page, deployment, started. [/6.1]
- **FR-012**: The details panel MUST show the ownership history. [/6.1]
- **FR-013**: The details panel MUST show "What the AI used": the sources and tool calls for each AI answer. [/6.1]
- **FR-014**: When no conversation matches the filters, the list MUST show "No conversations match these filters." with a clear-filters link that resets tab, selects and search. [/6.1]
- **FR-015**: Users MUST be able to search all messages and visitor names from the list rail ("Search all messages"). [UI:C-Inbox]
- **FR-016**: System MUST offer a period select with Today, 7 days and 30 days, filtering by the time of the last message. [UI:C-Inbox]
- **FR-017**: System MUST show the site and the visitor's language under the visitor name in the thread header. [UI:C-Inbox]
- **FR-018**: System MUST show the cited source under an AI message (for example "Delivery policy · FAQ"). [UI:C-Inbox]
- **FR-019**: System MUST show ownership and handover events inline in the thread, including the reason code (for example "Visitor asked for a person. Reason code: visitor_request. Staff notified."). [UI:C-Inbox]
- **FR-020**: System MUST also show device and country and the number of earlier chats in the Visitor panel. [UI:C-Inbox]
- **FR-021**: System MUST record every ownership change in the ownership history with who, when, why and the version (for example "10:38 · visitor_request · v2"). [UI:C-Inbox]
- **FR-022**: System MUST show "What the AI used" to staff only, never to the visitor; each entry shows the source and chunk with confidence, or the tool with its Read or Write type, duration and result (for example "Write tool · needs human approval · not run"). [UI:C-Inbox]
- **FR-023**: System MUST label conversation states in the list and header with the vocabulary of [PLT-004](../../platform/004-design-system/spec.md) FR-014: "With the AI", "Waiting for a person", "With {name}", "Closed". [UI:C-Inbox]
- **FR-024**: Handover events and history entries MUST use these reason codes: `visitor_request`, `agent_request`, `low_confidence`, `negative_sentiment`, `sensitive_topic`, `tool_failure`, `tool_approval`, `other`, plus `support_takeover`, `supervisor_takeover`, `visitor_cancelled` and `released`.
- **FR-025**: The Visitor panel MUST show the name, email and phone from the pre-chat form or the follow-up contact form when given.
- **FR-026**: Below 768 px wide, C-Inbox MUST show one column at a time (list, thread, details) with a back control.
- **FR-027**: The list, counts and thread MUST update live, without reload, when a conversation is created, receives a message or changes state. [/6.1]

### Key Entities

- **Conversation**: visitor, deployment (site), state (AI_ACTIVE, HANDOVER_PENDING, HUMAN_ACTIVE, CLOSED), owner, ownership version, messages, ownership history, handover reason code, waiting since, contact details.
- **Message**: sender (Visitor, AI, person, internal note, event), text, time; for AI messages the sources and tool calls used.
- **Ownership history entry**: event, person or AI, time, reason code, version.

## Success Criteria

- **SC-001**: Every conversation state in the list and thread is shown as a dot plus a text label, never colour alone.
- **SC-002**: A new visitor message or state change appears in the inbox of every viewer within 2 seconds.

## Assumptions and Open Items

- Seed conversations used in the prototype:
  - c1 Omar Hassan: AI_ACTIVE, AI typing, v1.
  - c2 Fatima Al Ketbi: HANDOVER_PENDING, reason "visitor request", Arabic, v2, waited 1 min 40 s.
  - c3 Rashid Al Mazrouei: HUMAN_ACTIVE, owner Khalid, v3.
- Prototype bar buttons (prototype only, not product UI): "Visitor sends a message", "A colleague claims first" (simulates the race on c2), "Reset".
- Status labels and dot colours come from [PLT-004](../../platform/004-design-system/spec.md).
- SC-002 (2 seconds) is set by this review as the meaning of "live" in UI spec 6.1.
