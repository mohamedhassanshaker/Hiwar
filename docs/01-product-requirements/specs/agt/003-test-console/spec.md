# Feature Specification: Agent test console

**Feature ID**: AGT-003
**Module**: AGT — Agents: configuration, testing, versions
**Status**: Draft
**Sources**: `/6.2`
**Screens**: C-Agents
**Personas**: Owner, Admin, Builder

## User Scenarios & Testing

### User Story 1 - Chat with the draft (Priority: P1)

A builder chats with the draft agent in English or Arabic and inspects what each answer used and cost.

**Why this priority**: Builders must test a draft before publishing it.
**Independent Test**: Send an English and an Arabic message; check sources, tool calls and token cost per AI turn.

**Acceptance Scenarios**:

1. **AC-AGT-003-01** — **Given** the test console, **When** the user sends "Do you deliver to Sharjah?", **Then** the draft agent answers, and the AI turn shows the source (for example "Delivery policy · chunk 3"), the tool calls (for example "lookup_delivery_zone · read · 220 ms") and the cost (for example "905 input · 51 output tokens · about AED 0.004").
2. **AC-AGT-003-02** — **Given** the user writes "مرحبا", **When** the message is sent, **Then** it is detected as Arabic by its Arabic Unicode characters and the answer is in Arabic.
3. **AC-AGT-003-03** — **Given** the input is empty, **When** the console renders, **Then** Send is disabled; the input is labelled "Test message" with the placeholder "Try a visitor question".
4. **AC-AGT-003-04** — **Given** the suggestion chips "Where is my order?", "I want a refund" and "مرحبا", **When** the user chooses one, **Then** it is sent as a test message.
5. **AC-AGT-003-05** — **Given** a test conversation, **When** the user chooses "Reset conversation", **Then** the test conversation is cleared; selecting another agent also clears it.
6. **AC-AGT-003-06** — **Given** the draft calls a write tool, **When** the turn runs, **Then** the tool is shown as proposed and is not executed against the real endpoint.

## Requirements

### Functional Requirements

- **FR-001**: The test console MUST let the user chat with the draft version of the selected agent. [/6.2]
- **FR-002**: Each AI turn MUST show the sources used, the tool calls and the token cost. [/6.2]
- **FR-003**: The test console MUST offer suggestion chips in English and Arabic. [/6.2]
- **FR-004**: The test console MUST offer "Reset conversation". [/6.2]
- **FR-005**: System MUST detect the message language as Arabic when it contains characters in the Arabic Unicode range. [/6.2]
- **FR-006**: System MUST label the test input "Test message" with the placeholder "Try a visitor question" and disable sending while it is empty. [UI:C-Agents]
- **FR-007**: System MUST show token cost as input and output tokens with an approximate AED amount (for example "812 input · 64 output tokens · about AED 0.004"). [UI:C-Agents]
- **FR-008**: System MUST also clear the test chat when another agent is selected. [UI:C-Agents]
- **FR-009**: Write tools called in the test console MUST be shown as proposed and MUST NOT run. [/6.2]
- **FR-010**: Test conversations MUST NOT appear in the inbox, analytics or usage meters. [/6.2]

## Success Criteria

- **SC-001**: Every AI turn in the test console shows sources, tool calls and token cost.

## Assumptions and Open Items

- In the prototype the console returns canned answers in English and Arabic; canned answers are prototype-only.
- FR-009 and FR-010 are set by this review so that testing has no effect on customers or quotas.
