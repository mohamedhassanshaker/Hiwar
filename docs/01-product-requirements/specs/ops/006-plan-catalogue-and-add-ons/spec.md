# Feature Specification: Plan comparison, cost price list, packs and overage

**Feature ID**: OPS-006
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Plans
**Personas**: Platform admin, Finance

## User Scenarios & Testing

### User Story 1 - Compare and publish plan changes (Priority: P1)

Prices change without a release ([OPS-002](../002-plans-and-prices/spec.md)); the team must see what each plan includes and choose who gets a change.

**Why this priority**: Prices change without a release ([OPS-002](../002-plans-and-prices/spec.md)); the team must see what each plan includes and choose who gets a change.
**Independent Test**: Open the comparison, then publish with each audience option.

**Acceptance Scenarios**:

- **AC-OPS-006-01** — **Given** Plans and prices, **When** it renders, **Then** a feature comparison lists every feature for Starter, Growth, Business and Enterprise.
- **AC-OPS-006-02** — **Given** a plan change, **When** the admin publishes, **Then** they choose New customers only, New customers now and current customers at renewal (30 days' notice), or Everyone now (fixes and added features only).

### User Story 2 - Sell packs and overage per market (Priority: P1)

Revenue beyond the plan comes from packs and overage.

**Why this priority**: Revenue beyond the plan comes from packs and overage.
**Independent Test**: Switch to KSA, add a pack.

**Acceptance Scenarios**:

- **AC-OPS-006-03** — **Given** the market switch, **When** the admin picks KSA · SAR, **Then** prices show in SAR and are marked as a draft until published.
- **AC-OPS-006-04** — **Given** the packs table, **When** the admin adds a pack, **Then** it is added as a draft for that market.

## Requirements

### Functional Requirements

- **FR-001**: Plans and prices MUST show a comparison of every plan feature.
- **FR-002**: Publishing MUST offer three audiences and save every publish in the plan history shown on Pricing and in Plan and usage.
- **FR-003**: Changes made for one organization MUST stay in place when a plan is published.
- **FR-004**: A model cost price list MUST hold the cost per million input and output tokens per model tier, embeddings and crawled pages; customers MUST NOT see model cost.
- **FR-005**: AI conversation packs MUST have a size, a price per market before VAT, the plans they are sold to and a status; pack conversations MUST last 12 months and be used after included ones.
- **FR-006**: Overage MUST be off by default, turned on by the Owner with a monthly cap, priced per plan (Starter AED 1.00, Growth 0.80, Business 0.60, Enterprise by contract), billed on the month-end invoice, with notices at 50%, 80% and 100% of the cap.
- **FR-007**: Included AI conversations MUST refresh monthly without roll-over; spending order MUST be included, then packs, then overage.

### Key Entities

- **Conversation pack**: size, price per market, plans, status, validity 12 months.
- **Cost price**: item, unit, input cost, output cost.

## Success Criteria

- **SC-001**: A price change reaches the Pricing page within 1 minute of publishing.

## Assumptions and Open Items

- The screen functions run on sample data until a backend exists for them; the module README names which ones.
- KSA prices are proposed at 1.02 times AED until Finance publishes them [NEEDS CLARIFICATION: confirm the SAR conversion rule (OPS-006)].
