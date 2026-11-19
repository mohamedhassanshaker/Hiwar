# Feature Specification: Append-only ledger, allowance entries, payment events and disputes

**Feature ID**: OPS-011
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Finance
**Personas**: Finance

## User Scenarios & Testing

### User Story 1 - Refund through the ledger (Priority: P1)

Corrections must be traceable.

**Why this priority**: Corrections must be traceable.
**Independent Test**: Refund an unused conversation pack.

**Acceptance Scenarios**:

- **AC-OPS-011-01** — **Given** a pack payment with none of its conversations used within 14 days, **When** Finance refunds in full, **Then** reversal entries post for the refund, income, VAT credit note and the pack conversations; nothing is edited.

### User Story 2 - Answer a card dispute (Priority: P1)

Chargebacks need evidence.

**Why this priority**: Chargebacks need evidence.
**Independent Test**: Submit evidence for CB-0017.

**Acceptance Scenarios**:

- **AC-OPS-011-02** — **Given** a dispute, **When** Finance submits evidence, **Then** the invoice, sign-in history and use go to the card issuer through the payment provider.

## Requirements

### Functional Requirements

- **FR-001**: The ledger MUST be append-only; corrections MUST be reversals and credit notes.
- **FR-002**: The AI conversation allowance MUST be the sum of its entries: monthly refresh, packs, goodwill grants and counted conversations.
- **FR-003**: Payment provider events MUST be verified, applied once and listed with their result.
- **FR-004**: Card disputes MUST record the amount, reserve cover and VAT effect, and accept evidence.
- **FR-005**: The finance report MUST show income by stream, refunds and VAT due per market, with SAR converted at the invoice date.

### Key Entities

- **Ledger entry**: id, description, account, amount, status.
- **Allowance entry**: id, date, description, source, conversations.

## Success Criteria

- **SC-001**: Ledger balances match invoices to the fils.

## Assumptions and Open Items

- The screen functions run on sample data until a backend exists for them; the module README names which ones.
