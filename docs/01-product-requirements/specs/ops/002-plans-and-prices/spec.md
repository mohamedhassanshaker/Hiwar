# Feature Specification: Operator plans and prices

**Feature ID**: OPS-002
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Plans (redesigned for Hiwar)
**Personas**: Platform admin

## User Scenarios & Testing

### User Story 1 - Change prices and limits without a release (Priority: P1)

A Platform admin changes a plan's price, allowance or limits; existing customers keep their terms until renewal.

**Why this priority**: The launch prices are reviewed after 90 days ([BIL-001](../../bil/001-plan-and-usage/spec.md)); changing prices must not need a code release or surprise existing customers.
**Independent Test**: Change Growth to AED 849 and 2,500 AI conversations; check new and existing customers.

**Acceptance Scenarios**:

1. **AC-OPS-002-01** — **Given** O-Plans, **When** it renders, **Then** it lists Starter, Growth, Business, Enterprise and Trial with monthly and yearly price in AED, AI conversation allowance, overage rate, agents, deployments, seats, knowledge storage, models, tools and trial length, as in [BIL-001](../../bil/001-plan-and-usage/spec.md) FR-017.
2. **AC-OPS-002-02** — **Given** the admin edits Growth and saves with a reason, **When** the change is saved, **Then** a new plan version is created, the Pricing page and Choose a plan show it at once, and new subscriptions use it.
3. **AC-OPS-002-03** — **Given** an existing Growth customer, **When** the plan version changes, **Then** their price and limits stay until their next renewal, when the new version applies after an email notice sent at least 30 days before.
4. **AC-OPS-002-04** — **Given** a limit increase, **When** saved with "Apply to existing customers now", **Then** existing customers get the higher limit at once without a price change.

## Requirements

### Functional Requirements

- **FR-001**: O-Plans MUST show every plan's monthly and yearly price, AI conversation allowance, overage rate, agents, deployments, seats, knowledge storage, models, tools, and the trial's length and allowance. [/1.1]
- **FR-002**: Saving a change MUST create a new plan version with a reason; plan versions MUST NOT be deleted.
- **FR-003**: New subscriptions MUST use the latest version; existing subscriptions MUST keep their version until renewal and MUST get an email notice at least 30 days before a price increase applies.
- **FR-004**: A limit increase MAY be applied to existing customers at once; a price increase or limit decrease MUST NOT.
- **FR-005**: The Pricing page, Choose a plan and the metering MUST read prices and limits from the plan versions, not from fixed values.

### Key Entities

- **Plan version**: plan, version, prices, allowance, overage rate, limits, models, tools, effective from, reason, changed by.

## Success Criteria

- **SC-001**: A price or allowance change reaches the Pricing page without a code release.

## Assumptions and Open Items

- Coupons and promotions shown on the earlier O-Plans and O-CMS boards are P2.
