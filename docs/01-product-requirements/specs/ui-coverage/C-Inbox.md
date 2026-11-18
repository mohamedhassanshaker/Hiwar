---
title: UI coverage of C-Inbox
status: draft
owner: product owner
related: [INB-001, INB-002]
version: 0.1
last-updated: 2026-11-18
---

# UI coverage: C-Inbox

Artboard: `design/boards/C-Inbox.dc.html` in `00-input-requirements/Hiwar-claude-code-handoff.zip`

| UI function | Kind | Covered by |
| --- | --- | --- |
| Visitor sends a message | action | n/a: prototype state |
| A colleague claims first | action | n/a: prototype state |
| Reset | action | n/a: prototype state |
| Open a conversation that needs a person, then try again. | outcome | n/a: prototype state |
| Claim | action | INB-002 FR-006 |
| Reply to visitor | action | INB-002 FR-013 |
| Internal note | action | INB-002 FR-013, INB-002 FR-028 |
| Send | action | INB-002 FR-030 |
| Take over | action | INB-002 FR-004, INB-002 FR-020 |
| Hand back to the AI | action | INB-002 FR-009 |
| Release to queue | action | INB-002 FR-011, INB-002 FR-026 |
| Close conversation | action | INB-002 FR-012, INB-002 FR-027 |
| Cancel | action | INB-002 FR-025 |
| Hand back | action | INB-002 FR-010 |
| Close | control | INB-002 FR-025 |
| Filter conversations | control | INB-001 FR-002 |
| Conversation list | control | INB-001 FR-001 |
| Search all messages | control | INB-001 FR-015 |
| Search messages | field | INB-001 FR-015 |
| Deployment | field | INB-001 FR-003 |
| Period | field | INB-001 FR-016 |
| Conversation | control | INB-001 FR-005 |
| Messages | control | INB-001 FR-008 |
| Composer mode | control | INB-002 FR-013 |
| Conversation details | control | INB-001 FR-011 |
| Message | field | INB-002 FR-029 |
| Handover note | field | INB-002 FR-009, INB-002 FR-023 |
| For example: Refund approved. Customer wants confirmation by email. | control | n/a: sample data |
| Tell the visitor that the assistant is back | field | INB-002 FR-024 |
| Dismiss | control | PLT-004 FR-022 |
| Conversations | heading | n/a: layout |
| Visitor | heading | INB-001 FR-011, INB-001 FR-020 |
| Ownership history | heading | INB-001 FR-012, INB-001 FR-021 |
| What the AI used | heading | INB-001 FR-013, INB-001 FR-022 |
| Hand back to the AI (dialog) | dialog | INB-002 FR-023 |
| Khalid claimed this conversation a moment earlier. Only one claim succeeds. | outcome | INB-002 FR-007, INB-002 FR-031 |
| Tab counts (All, Needs a person, With the AI, With the team) | state | INB-001 FR-002 |
| List and header status labels | state | INB-001 FR-023 |
| Waiting {time} with Claim | state | INB-001 FR-006 |
| {owner} is replying | state | INB-001 FR-007 |
| Ownership version v{n}: stale replies are rejected | rule | INB-002 FR-022 |
| Layla is writing a reply… | state | INB-001 FR-009 |
| Cited source under an AI message | state | INB-001 FR-018 |
| Inline ownership and handover events with reason code | state | INB-001 FR-019 |
| Visitor sees "A team member has joined" | outcome | INB-002 FR-021 |
| Composer hints and placeholders | state | INB-002 FR-029 |
| Composer disabled unless owner | rule | INB-002 FR-014, INB-002 FR-015 |
| Blank hand-back note replaced by a summary | rule | INB-002 FR-009 |
| Visitor message routing by owner | rule | INB-002 FR-017, INB-002 FR-018, INB-002 FR-019 |
| Take over cancels AI reply in progress and discards the unsent text | rule | INB-002 FR-004 |
