# Feature Specification: Analytics dashboard

**Feature ID**: ANA-001
**Module**: ANA — Analytics
**Status**: Draft
**Sources**: `/6.6`
**Screens**: C-Analytics
**Personas**: Owner, Admin, Builder, Analyst, Support Agent (limited)

## User Scenarios & Testing

### User Story 1 - Review performance for a period (Priority: P1)

An analyst picks a range and reviews the KPIs, daily volume, breakdowns, handover reasons and top questions.

**Why this priority**: Shows whether the AI resolves conversations and where people are needed.
**Independent Test**: Switch between 7, 30 and 90 days and check every panel updates.

**Acceptance Scenarios**:

1. **AC-ANA-001-01** — **Given** C-Analytics, **When** the user chooses 7, 30 or 90 days in the Date range control, **Then** every KPI, chart, table and list shows that range, and each KPI shows its change against the previous period of the same length.
2. **AC-ANA-001-02** — **Given** C-Analytics, **When** the page renders, **Then** 6 KPIs are shown: Conversations, Resolved by the AI, Reached a person, First reply (AI and people together), Wait for a person (median over staffed hours), Double replies.
3. **AC-ANA-001-03** — **Given** 10 conversations in the range, of which 6 closed with no handover, no "No" feedback, no repeated question and no reopening within 24 hours, **When** the KPIs compute, **Then** Resolved by the AI shows 60%.
4. **AC-ANA-001-04** — **Given** a conversation the AI closed by auto-close and the visitor reopened 3 hours later, **When** the KPIs compute, **Then** it does not count as resolved by the AI.
5. **AC-ANA-001-05** — **Given** the Breakdown, **When** the user chooses Deployment, Agent or Language, **Then** rows group by that dimension with the columns Conversations, Resolved by AI, Reached a person and Cost per conversation in AED.
6. **AC-ANA-001-06** — **Given** "Why chats reached a person", **When** it renders, **Then** it shows one bar per reason code with its percentage, using the labels Visitor asked for a person, Agent asked for a person, Repeated low confidence, Negative sentiment, Sensitive topic, Repeated tool failure, Write tool needs approval, Other.
7. **AC-ANA-001-07** — **Given** Top questions, **When** the user chooses "See unanswered questions", **Then** C-Knowledge opens on Unanswered questions.

### User Story 2 - Export the data (Priority: P2)

An analyst exports the data as CSV.

**Why this priority**: Supports reporting outside the product.
**Independent Test**: Choose Export CSV as Analyst, then as Builder.

**Acceptance Scenarios**:

1. **AC-ANA-001-08** — **Given** an Owner, Admin or Analyst, **When** they choose Export CSV, **Then** a CSV of the range downloads, the toast "CSV export started. Only Owner, Admin and Analyst roles can export. The export is recorded in the audit log." shows and the audit log records the export.
2. **AC-ANA-001-09** — **Given** a Builder or Support Agent, **When** the page renders, **Then** Export CSV is not shown.

### User Story 3 - Limited view for Support Agents (Priority: P3)

A Support Agent sees how conversations go, without commercial figures.

**Why this priority**: Agents benefit from the numbers; cost stays with management.
**Independent Test**: Sign in as Khalid and open Analytics.

**Acceptance Scenarios**:

1. **AC-ANA-001-10** — **Given** a Support Agent, **When** C-Analytics renders, **Then** it shows the KPIs, Conversations per day, the reasons and Top questions, and hides the Breakdown cost column and Export CSV.

## Requirements

### Functional Requirements

- **FR-001**: C-Analytics MUST have a range segmented control with 7 / 30 / 90 days. [/6.6]
- **FR-002**: C-Analytics MUST offer Export CSV, confirmed by a toast, to the roles of FR-013. [/6.6]
- **FR-003**: C-Analytics MUST show 6 KPIs: Conversations, Resolved by the AI (67%), Reached a person (27%), First reply (1.4 s), Wait for a person (1 min 12 s), Double replies (0). [/6.6]
- **FR-004**: The Conversations per day panel MUST be a bar chart split into AI portion and person portion. [/6.6]
- **FR-005**: The breakdown table MUST offer a segmented choice by deployment, by agent, by language, with columns conversations, resolved by AI, reached a person, cost per conversation. [/6.6]
- **FR-006**: The Reasons for reaching a person panel MUST show horizontal bars per handover reason code (FR-011); the UI spec categories visitor request, low confidence, sensitive topic, tool failure and other are included. [/6.6]
- **FR-007**: C-Analytics MUST show a top questions list with counts. [/6.6]
- **FR-008**: C-Analytics MUST show a plain note defining "resolved by the AI" as in FR-009. [/6.6]
- **FR-009**: System MUST count a conversation as resolved by the AI only if it closed (by staff, by the visitor or by auto-close) with no handover, no "No" feedback and no repeated visitor question, and was not reopened within 24 hours; this extends the UI spec rule "ended without reaching a person and was not reopened within 24 hours". [/6.6]
- **FR-010**: System MUST show each KPI's change against the previous period; First reply covers AI and people, Wait for a person is the median over staffed hours, Double replies counts AI and person in one turn. [UI:C-Analytics]
- **FR-011**: System MUST show the handover reason codes with percentages: Visitor asked for a person, Agent asked for a person, Repeated low confidence, Negative sentiment, Sensitive topic, Repeated tool failure, Write tool needs approval, Other. [UI:C-Analytics]
- **FR-012**: The note MUST read: "Resolved by the AI" means the chat closed, on its own or after a quiet period, with no handover, no negative feedback and no repeated question, and was not reopened within 24 hours. [UI:C-Analytics]
- **FR-013**: System MUST allow Export CSV only to the Owner, Admin and Analyst roles, record the export in the audit log and confirm "CSV export started. Only Owner, Admin and Analyst roles can export. The export is recorded in the audit log." [UI:C-Analytics]
- **FR-014**: System MUST link "See unanswered questions" from Top questions to C-Knowledge. [UI:C-Analytics]
- **FR-015**: System MUST show cost per conversation in AED in the breakdown table. [UI:C-Analytics]
- **FR-016**: For the Support Agent role, C-Analytics MUST hide cost per conversation and Export CSV and show the other panels.
- **FR-017**: Test-console conversations MUST NOT count in analytics ([AGT-003](../../agt/003-test-console/spec.md)). [/6.6]

## Success Criteria

- **SC-001**: Double replies KPI = 0 (see [INB-002](../../inb/002-conversation-ownership/spec.md)).

## Assumptions and Open Items

- KPI values (67%, 27%, 1.4 s, 1 min 12 s) are design sample values.
- Support Agents see a limited view ([ORG-002](../../org/002-roles-and-permissions/spec.md)).
