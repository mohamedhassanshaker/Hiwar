# Feature Specification: Subscriptions, invoices, overage lines, credit notes and coupons

**Feature ID**: OPS-010
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Billing
**Personas**: Finance, Platform admin

## User Scenarios & Testing

### User Story 1 - Manage a subscription (Priority: P1)

Finance changes plans, discounts and renewals on request.

**Why this priority**: Finance changes plans, discounts and renewals on request.
**Independent Test**: Open Gulf Bites, change plan, add a discount, turn off renewal.

**Acceptance Scenarios**:

- **AC-OPS-010-01** — **Given** a subscription, **When** Finance changes the plan, **Then** the change starts today and the difference for the days left is charged or credited on the next invoice.
- **AC-OPS-010-02** — **Given** a subscription, **When** Finance turns off Renew on its own or cancels, **Then** the plan ends on the next bill date with no refund unless a credit note is added.

### User Story 2 - Correct and collect invoices (Priority: P1)

Paid invoices are never edited.

**Why this priority**: Paid invoices are never edited.
**Independent Test**: Record a bank payment, void an invoice with a credit note.

**Acceptance Scenarios**:

- **AC-OPS-010-03** — **Given** an open or overdue invoice, **When** Finance records a bank payment with amount, date and reference, **Then** it is marked paid and a receipt is emailed.
- **AC-OPS-010-04** — **Given** a paid invoice, **When** Finance voids it, **Then** a credit note is issued, optionally refunded and emailed, and the invoice is not edited.

## Requirements

### Functional Requirements

- **FR-001**: Overview MUST show monthly recurring income, active subscriptions, past-due amount and cancellations, renewals in the next 30 days and income by stream.
- **FR-002**: Subscriptions MUST be filterable by billing cycle and status (Active, Trial, Past due, Read-only, Cancelling) with counts.
- **FR-003**: Invoices MUST show market VAT (UAE 5%, KSA 15%) and the platform tax number, be exportable as CSV and allow reminders when open or overdue.
- **FR-004**: Overage lines MUST be suspendable when unpaid after the grace period, restorable after payment, and corrected only by credit note.
- **FR-005**: Coupons MUST be created only here with code, discount, duration, plans, maximum uses and end date, and switched on or off.
- **FR-006**: Billing settings MUST hold card retry days, renewal and failure emails, overage suspension, invoice numbering, payment terms, part-period charging, bank transfer and e-invoicing.
- **FR-007**: Goodwill AI conversations MUST be granted with a logged reason.

### Key Entities

- **Subscription**: customer, plan, cycle, amount, next bill, status, payment method, discount, overage cap.
- **Credit note**: number, invoice, reason, amount, refund state.

## Success Criteria

- **SC-001**: Every invoice reconciles with the ledger ([OPS-011](../011-payments-and-ledger/spec.md)).

## Assumptions and Open Items

- The screen functions run on sample data until a backend exists for them; the module README names which ones.
- Builds on [BIL-001](../../bil/001-plan-and-usage/spec.md).
