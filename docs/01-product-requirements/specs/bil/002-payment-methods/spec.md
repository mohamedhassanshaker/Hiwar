# Feature Specification: Payment methods and billing details

**Feature ID**: BIL-002
**Module**: BIL — Plan and usage
**Status**: Draft
**Sources**: `/1.1`
**Screens**: Payments
**Personas**: Owner

## User Scenarios & Testing

### User Story 1 - Keep a working payment method (Priority: P1)

Failed payments lead to read-only.

**Why this priority**: Failed payments lead to read-only.
**Independent Test**: Add a card, make it default, try to remove the default.

**Acceptance Scenarios**:

- **AC-BIL-002-01** — **Given** payment methods, **When** the Owner adds a card, **Then** it is added through the payment provider's form and can be made default.
- **AC-BIL-002-02** — **Given** the default method, **When** the Owner removes it, **Then** they are asked to choose another default first.
- **AC-BIL-002-03** — **Given** an expired default card, **When** the page opens, **Then** a warning asks to replace it before the next charge.

## Requirements

### Functional Requirements

- **FR-001**: An organization MUST be able to hold several payment methods with one default; bank transfer MUST be available for yearly plans.
- **FR-002**: Card details MUST go straight to the payment provider; Hiwar MUST NOT see or store full card numbers.
- **FR-003**: The default method MUST NOT be removed until another is the default.
- **FR-004**: Billing details (legal name, tax registration number, address, invoice email) MUST be printed on every VAT invoice and changes MUST apply to the next invoice; a UAE tax registration number MUST have 15 digits.

### Key Entities

- **Payment method**: kind (card, bank transfer), label, expiry, default.

## Success Criteria

- **SC-001**: No invoice fails because of an expired default card that was flagged 7 days earlier.

## Assumptions and Open Items

- The live single card stays on Plan and usage ([BIL-001](../001-plan-and-usage/spec.md)); this screen is sample until several methods are supported by the provider integration.
