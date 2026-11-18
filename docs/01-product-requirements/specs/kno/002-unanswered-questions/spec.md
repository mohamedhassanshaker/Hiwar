# Feature Specification: Unanswered questions

**Feature ID**: KNO-002
**Module**: KNO — Knowledge sources and unanswered questions
**Status**: Draft
**Sources**: `/6.3`
**Screens**: C-Knowledge
**Personas**: Owner, Admin, Builder

## User Scenarios & Testing

### User Story 1 - Close knowledge gaps (Priority: P1)

A builder reviews questions the AI could not answer well and writes answers, adds them as FAQs or dismisses them.

**Why this priority**: Finding gaps is half the purpose of the Knowledge screen.
**Independent Test**: Open Unanswered questions and apply each action.

**Acceptance Scenarios**:

1. **AC-KNO-002-01** — **Given** the Unanswered questions tab with the count 3, **When** it renders, **Then** it lists under "Questions the agent could not answer well" each question with "Asked {n} times this week · {language}", for example "Asked 9 times this week · Arabic".
2. **AC-KNO-002-02** — **Given** a question, **When** the user chooses **Write an answer**, **Then** an inline "Suggested answer" editor opens prefilled with a suggested answer.
3. **AC-KNO-002-03** — **Given** the editor is open, **When** the user edits the answer and chooses **Add as FAQ**, **Then** the question and answer are saved as an FAQ source, the toast "Added to your FAQ. The agent can use it now." shows, the question leaves the list, and the agent answers it from the FAQ in the next conversation.
4. **AC-KNO-002-04** — **Given** a question, **When** the user chooses **Dismiss**, **Then** it leaves the list and the tab count decreases by 1.
5. **AC-KNO-002-05** — **Given** no question is waiting, **When** the tab renders, **Then** it shows "Nothing waiting" and "New unanswered questions show up here."
6. **AC-KNO-002-06** — **Given** the same question is asked again with low confidence after being dismissed, **When** it recurs, **Then** it returns to the list with a new count.

### Edge Cases

- Write an answer uses an inline editor in the list, not a dialog.
- An empty suggested answer cannot be added.

## Requirements

### Functional Requirements

- **FR-001**: The Unanswered questions tab MUST list visitor questions the AI could not answer, with count and last asked. [/6.3]
- **FR-002**: **Write an answer** MUST open an inline editor and MUST save the answer as an FAQ source. [/6.3]
- **FR-003**: Users MUST be able to **Add as FAQ** and **Dismiss** each question. [/6.3]
- **FR-004**: System MUST list questions with low retrieval confidence under "Questions the agent could not answer well", each with "Asked {n} times this week · {language}". [UI:C-Knowledge]
- **FR-005**: System MUST open Write an answer as a "Suggested answer" editor prefilled with a suggested answer; Add as FAQ saves it, confirms "Added to your FAQ. The agent can use it now." and the agent can use it at once. [UI:C-Knowledge]
- **FR-006**: System MUST show "Nothing waiting" and "New unanswered questions show up here." when no question is waiting. [UI:C-Knowledge]
- **FR-007**: System MUST show the number of waiting questions on the Unanswered questions tab. [UI:C-Knowledge]
- **FR-008**: System MUST group the same question asked in different words into one entry, and return a dismissed question to the list when it recurs with low confidence. [/6.3]
- **FR-009**: Add as FAQ MUST be disabled while the answer is empty. [/6.3]

## Success Criteria

- **SC-001**: The unanswered questions count in the stats row ([KNO-001](../001-knowledge-sources/spec.md)) matches the list.

## Assumptions and Open Items

- Top questions are also listed in [ANA-001](../../ana/001-analytics-dashboard/spec.md).
