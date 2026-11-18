# Feature Specification: AI cost, margin and service health

**Feature ID**: OPS-004
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Business (redesigned for Hiwar)
**Personas**: Platform admin

## User Scenarios & Testing

### User Story 1 - Watch margin per plan and per organization (Priority: P1)

A Platform admin sees AI cost against revenue, to keep prices profitable and find customers who cost more than they pay.

**Why this priority**: The plan prices in [BIL-001](../../bil/001-plan-and-usage/spec.md) assume an AI cost of AED 0.11–0.19 per conversation; the business needs to see when that changes.
**Independent Test**: Open O-Business for the last 30 days.

**Acceptance Scenarios**:

1. **AC-OPS-004-01** — **Given** O-Business with range 30 days, **When** it renders, **Then** it shows revenue, AI cost (model tokens and tool calls), gross margin in AED and percent, and AI cost per conversation, in total and per plan.
2. **AC-OPS-004-02** — **Given** the organizations table, **When** sorted by margin, **Then** organizations with negative margin are listed first with their plan, AI conversations, cost and revenue.
3. **AC-OPS-004-03** — **Given** AI cost per conversation over AED 0.30 for 7 days in a row, **When** the threshold is crossed, **Then** Platform admins get an alert.

### User Story 2 - Watch service health (Priority: P1)

A Platform admin sees whether the AI and the widget are working.

**Why this priority**: An outage stops every customer's AI and hurts trust in the single-owner promise.
**Independent Test**: Simulate model errors above the threshold.

**Acceptance Scenarios**:

1. **AC-OPS-004-04** — **Given** O-Business, **When** it renders, **Then** it shows for the last 24 hours: AI first-reply time (median and 95th percentile), model error rate, widget load errors, ingestion failures and double replies (must be 0).
2. **AC-OPS-004-05** — **Given** the model error rate is above 2% for 5 minutes, **When** it is detected, **Then** Platform admins are alerted.
3. **AC-OPS-004-06** — **Given** any double reply is recorded, **When** it is detected, **Then** Platform admins are alerted with the organization and conversation ID.

## Requirements

### Functional Requirements

- **FR-001**: O-Business MUST show revenue, AI cost, gross margin (AED and %) and AI cost per conversation for 7, 30 and 90 days, in total and per plan. [/1.1]
- **FR-002**: O-Business MUST list organizations with plan, AI conversations, AI cost, revenue and margin, sortable by margin.
- **FR-003**: O-Business MUST show AI first-reply time (median and 95th percentile), model error rate, widget load errors, ingestion failures and double replies for the last 24 hours.
- **FR-004**: System MUST alert Platform admins when AI cost per conversation is over AED 0.30 for 7 days in a row, when the model error rate is over 2% for 5 minutes, and on any double reply.
- **FR-005**: O-Business MUST show organizations and figures only, never conversation content.

## Success Criteria

- **SC-001**: Gross margin per plan is visible within one day of the period it covers.

## Assumptions and Open Items

- Alert thresholds (AED 0.30 for 7 days, 2% for 5 minutes) are set by this review; Platform admins can change them.
- Model routes, failovers and evaluations (earlier O-Models, O-AI) are P2.
