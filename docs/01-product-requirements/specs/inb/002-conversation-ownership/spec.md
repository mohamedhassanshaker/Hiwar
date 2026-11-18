# Feature Specification: Conversation ownership, takeover and handback

**Feature ID**: INB-002
**Module**: INB — Conversations inbox, takeover and handback
**Status**: Draft
**Sources**: `/6.1`, `/1.2`
**Screens**: C-Inbox
**Personas**: Owner, Admin, Support Agent

## User Scenarios & Testing

### User Story 1 - Take over from the AI (Priority: P1)

A staff member watching an AI conversation takes it over and replies to the visitor.

**Why this priority**: Staff control of the conversation is the product's core promise.
**Independent Test**: On c1 (AI_ACTIVE, AI typing, v1) choose Take over and check state, owner, version, composer and AI output.

**Acceptance Scenarios**:

1. **AC-INB-002-01** — **Given** c1 is AI_ACTIVE at v1 with the AI typing, **When** the user chooses Take over, **Then** the AI generation in progress is cancelled, the unsent AI draft is discarded and never reaches the visitor, the owner becomes the user, the state becomes HUMAN_ACTIVE, the version becomes v2, and the visitor sees "A team member has joined".
2. **AC-INB-002-02** — **Given** the AI owns a conversation, **When** the user looks at the composer in Reply mode, **Then** the text field is disabled, its placeholder is "Only the owner can reply" and the hint is "Take over to reply".
3. **AC-INB-002-03** — **Given** the user owns the conversation, **When** they type a reply and choose Send, **Then** the message is delivered to the visitor labelled with the user's name; Send is disabled while the field is empty.
4. **AC-INB-002-04** — **Given** the user loaded c1 at v1 and a colleague took it over (v2), **When** the user sends a reply carrying v1, **Then** the reply is rejected, nothing reaches the visitor and the thread refreshes to v2.

### User Story 2 - Claim a conversation waiting for a person (Priority: P1)

A staff member claims a conversation in HANDOVER_PENDING; if a colleague claims first, the second claimer is told.

**Why this priority**: Visitors waiting for a person must be served by exactly one person.
**Independent Test**: On c2 use "A colleague claims first", then claim.

**Acceptance Scenarios**:

1. **AC-INB-002-05** — **Given** c2 is HANDOVER_PENDING at v2, **When** the user chooses Claim, **Then** the owner becomes the user, the state becomes HUMAN_ACTIVE, the version becomes v3, history records "first valid claim" and the visitor sees "A team member has joined".
2. **AC-INB-002-06** — **Given** Khalid and Noura claim c2 at the same moment, **When** both claims arrive, **Then** exactly one succeeds; the other sees "Khalid claimed this conversation a moment earlier. Only one claim succeeds." and the conversation stays owned by the winner.
3. **AC-INB-002-07** — **Given** c2 is HANDOVER_PENDING, **When** the visitor sends a message, **Then** it is queued, no AI reply is produced, and the claimer sees it in the thread after claiming.

### User Story 3 - Hand back, release or close (Priority: P1)

The owner of a human conversation hands it back to the AI with a staff-only note, releases it to the queue, or closes it.

**Why this priority**: Staff must be able to end their ownership in one click.
**Independent Test**: On c3 as its owner, hand back with and without a note; release; close.

**Acceptance Scenarios**:

1. **AC-INB-002-08** — **Given** the user owns c3, **When** they choose Hand back to the AI, enter "Refund approved. Customer wants confirmation by email." and choose Hand back, **Then** the note is stored staff-only, the AI continues with the transcript and note, the state becomes AI_ACTIVE, the version increases by 1, and with the checkbox "Tell the visitor that the assistant is back" checked the visitor sees that the assistant is back.
2. **AC-INB-002-09** — **Given** the hand-back dialog note is blank, **When** the user chooses Hand back, **Then** Hiwar writes a summary from the user's part of the conversation and stores it as the staff-only note.
3. **AC-INB-002-10** — **Given** the hand-back dialog is open, **When** the user chooses Cancel, Close or presses Escape, **Then** the dialog closes and owner, state and version are unchanged.
4. **AC-INB-002-11** — **Given** the user owns c3, **When** they choose Release to queue, **Then** the state becomes HANDOVER_PENDING with no owner, the version increases by 1, the reason is "Released by {name}" and the waiting time restarts.
5. **AC-INB-002-12** — **Given** any open conversation, **When** the user chooses Close conversation, **Then** the state becomes CLOSED, the version increases by 1, a staff-only summary is stored, the visitor is asked "Was this helpful?" and the composer is disabled for replies and notes.
6. **AC-INB-002-13** — **Given** a conversation closed 3 hours ago, **When** the visitor sends a message, **Then** it reopens as AI_ACTIVE, the version increases by 1, the event "Reopened by the visitor" is recorded and the AI replies; **Given** it closed 25 hours ago, **Then** a new conversation starts.
7. **AC-INB-002-14** — **Given** an AI_ACTIVE conversation with no visitor message for 30 minutes, **When** the time passes, **Then** the system closes it as in AC-INB-002-12.

### User Story 4 - Visitor messages reach exactly one owner (Priority: P1)

A visitor message is answered only by the current owner, so the visitor never gets two replies.

**Why this priority**: Double replies break the single-owner rule.
**Independent Test**: Use "Visitor sends a message" in each state and check who replies.

**Acceptance Scenarios**:

1. **AC-INB-002-15** — **Given** the AI owns the conversation, **When** the visitor sends a message, **Then** the AI replies.
2. **AC-INB-002-16** — **Given** a person owns the conversation, **When** the visitor sends a message, **Then** it is delivered only to that person and the AI does not reply ("Delivered to {name} only. The AI did not reply.").

### User Story 5 - Notes and supervisor takeover (Priority: P2)

Colleagues advise the owner with internal notes; an Owner or Admin takes over a stuck conversation from a colleague.

**Why this priority**: Supports teamwork without breaking the one-owner rule.
**Independent Test**: As Noura (Owner) write a note on c3, then take over c3 from Khalid; repeat as a Support Agent.

**Acceptance Scenarios**:

1. **AC-INB-002-17** — **Given** Noura does not own c3, **When** she switches to Internal note, writes a note and sends it, **Then** the note appears as "Internal note · Noura" with "only staff see this" and is never delivered to the visitor; the hint reads "Only staff see notes".
2. **AC-INB-002-18** — **Given** Khalid owns c3 and the viewer is Noura (Owner), **When** she chooses Take over, **Then** she becomes the owner, the version increases by 1, history records `supervisor_takeover`, and Khalid sees "Noura took over this conversation" and loses the composer.
3. **AC-INB-002-19** — **Given** Khalid owns c3 and the viewer is another Support Agent, **When** the thread renders, **Then** Take over is not shown.

### Edge Cases

- Two staff claim the same HANDOVER_PENDING conversation: the first valid claim wins (AC-INB-002-06).
- A non-owner viewing a HUMAN_ACTIVE conversation: Reply disabled, Internal note enabled; Hand back and Release are not shown.
- CLOSED conversation: composer disabled in both modes; Close is not shown.
- A visitor cancels while waiting ([DEP-003](../../dep/003-visitor-widget/spec.md)): the conversation returns to AI_ACTIVE (FR-032).

## Requirements

### Functional Requirements

- **FR-001**: System MUST let either the AI or exactly one person own a conversation at any moment, and the UI MUST NOT show two parties replying. [/1.2]
- **FR-002**: Take over, claim, hand back and release MUST each be one click away in the inbox. [/1.2]
- **FR-003**: Take over MUST be available when the state is AI_ACTIVE to every role allowed to take over ([ORG-002](../../org/002-roles-and-permissions/spec.md)). [/6.1]
- **FR-004**: Take over MUST cancel any AI generation in progress, discard the unsent AI draft, make the user the owner, set the state to HUMAN_ACTIVE and increase `ownership_version` by 1. [/6.1]
- **FR-005**: Claim MUST be available only when the state is HANDOVER_PENDING. [/6.1]
- **FR-006**: Claim MUST let the first valid claim win, make the claimer the owner, set the state to HUMAN_ACTIVE and increase the version by 1. [/6.1]
- **FR-007**: A second claimer MUST be told that the claim failed, with the message of FR-031. [/6.1]
- **FR-008**: Hand back to the AI MUST be available only when the state is HUMAN_ACTIVE and only to the owner. [/6.1]
- **FR-009**: Hand back MUST open a dialog with a staff-only note field; a blank note MUST make the system write a summary. [/6.1]
- **FR-010**: Hand back MUST make the AI continue, set the state to AI_ACTIVE and increase the version by 1. [/6.1]
- **FR-011**: Release to queue MUST be available only when the state is HUMAN_ACTIVE and only to the owner, and MUST set the state to HANDOVER_PENDING with no owner. [/6.1]
- **FR-012**: Close conversation MUST be available in any open state, MUST set the state to CLOSED and MUST disable the composer. [/6.1]
- **FR-013**: The composer MUST offer two modes: **Reply** (goes to the visitor) and **Internal note** (staff only, visually distinct, never delivered to the visitor). [/6.1]
- **FR-014**: The composer's Reply mode MUST be disabled unless the viewer owns the conversation; Internal note mode follows FR-028. [/6.1]
- **FR-015**: If the AI owns the conversation, the composer MUST show "Take over to reply". [/6.1]
- **FR-016**: Only the owner MUST be able to produce visitor-visible messages. [/6.1]
- **FR-017**: A visitor message while the AI owns the conversation MUST get an AI reply. [/6.1]
- **FR-018**: A visitor message while a person owns the conversation MUST be delivered only to that person, with no AI reply. [/6.1]
- **FR-019**: A visitor message while HANDOVER_PENDING MUST be queued and shown to whoever claims the conversation, with no AI reply. [/6.1]
- **FR-020**: Owner and Admin MUST be able to take over a HUMAN_ACTIVE conversation owned by another person; the version increases by 1, the reason is `supervisor_takeover`, and the previous owner sees "{name} took over this conversation". Other roles MUST NOT. [UI:C-Inbox]
- **FR-021**: System MUST show the visitor "A team member has joined" after a take over or claim. [UI:C-Inbox]
- **FR-022**: System MUST reject a reply sent with a stale ownership version. [UI:C-Inbox]
- **FR-023**: System MUST state in the hand-back dialog that the AI continues with the full transcript and the note, that the note is labelled as staff information and that the visitor never sees it; a blank note is replaced by a summary written from the staff member's part of the conversation. [UI:C-Inbox]
- **FR-024**: System MUST offer the checkbox "Tell the visitor that the assistant is back" in the hand-back dialog, checked by default. [UI:C-Inbox]
- **FR-025**: Users MUST be able to cancel or close the hand-back dialog without changing ownership. [UI:C-Inbox]
- **FR-026**: System MUST increase the version by 1 on Release to queue and record the reason "Released by {name}". [UI:C-Inbox]
- **FR-027**: System MUST increase the version by 1 on Close conversation, store a staff-only summary and ask the visitor "Was this helpful?" (Yes / No). [UI:C-Inbox]
- **FR-028**: Users who can view and reply to conversations MUST be able to write an internal note in any open conversation, owned or not; notes are shown as "Internal note · {name}" with "only staff see this". [UI:C-Inbox]
- **FR-029**: System MUST show the composer hint "You own this conversation" to the owner, "Take over to reply" to others and "Only staff see notes" in note mode, with the placeholders "Write to the visitor", "Only the owner can reply" and "Write a note for your team". [UI:C-Inbox]
- **FR-030**: System MUST disable Send while the message is empty. [UI:C-Inbox]
- **FR-031**: System MUST tell a second claimer "{name} claimed this conversation a moment earlier. Only one claim succeeds." [UI:C-Inbox]
- **FR-032**: When the visitor cancels a request for a person, System MUST set the state to AI_ACTIVE, increase the version by 1 and record the reason `visitor_cancelled`.
- **FR-033**: A visitor message within 24 hours of closing MUST reopen the conversation as AI_ACTIVE, increase the version by 1 and record "Reopened by the visitor"; a later message MUST start a new conversation.
- **FR-034**: System MUST close an AI_ACTIVE conversation after 30 minutes without a visitor message (default, configured per organization).

### Key Entities

- **Conversation state**: AI_ACTIVE, HANDOVER_PENDING, HUMAN_ACTIVE, CLOSED (COPILOT is P2, see [PLT-004](../../platform/004-design-system/spec.md)).
- **Ownership**: owner (AI, a person, or none in HANDOVER_PENDING and CLOSED) and `ownership_version`, increased by 1 on every ownership change: take over, claim, hand back, release, close, cancel and reopen.
- **Hand-back note**: staff-only text, or a system-written summary when blank.
- **Close summary and feedback**: staff-only summary; visitor answer Yes, No or none.

## Success Criteria

- **SC-001**: Double replies = 0 (the prototype shows this value; Analytics reports it, see [ANA-001](../../ana/001-analytics-dashboard/spec.md)).
- **SC-002**: Under 50 simultaneous claims of one conversation exactly one succeeds.

## Assumptions and Open Items

- Who may take over and hand back is set by the permission matrix in [ORG-002](../../org/002-roles-and-permissions/spec.md).
- Ownership changes are recorded in the audit log, for example "Khalid took over conversation" ([ORG-003](../../org/003-audit-log/spec.md)).
- Visitor-side states for these transitions are in [DEP-003](../../dep/003-visitor-widget/spec.md). Write-tool approvals are in [INB-003](../003-write-tool-approval/spec.md).
- UI spec 6.1 wording "{name} already claimed this" is replaced by FR-031.
