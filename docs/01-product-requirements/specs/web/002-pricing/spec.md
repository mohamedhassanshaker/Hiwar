# Feature Specification: Public pricing page

**Feature ID**: WEB-002
**Module**: WEB — Public website
**Status**: Draft
**Sources**: `/7.2`
**Screens**: W-Pricing
**Personas**: Prospective customer

## User Scenarios & Testing

### User Story 1 - Compare plans (Priority: P1)

A prospective customer compares the four plans monthly or yearly and starts free.

**Why this priority**: Pricing converts visitors into customers.
**Independent Test**: Toggle Pay monthly / Pay yearly, read the comparison table and FAQ, choose Start free.

**Acceptance Scenarios**:

1. **AC-WEB-002-01** — **Given** W-Pricing, **When** it renders, **Then** it shows one product with four plans, Starter, Growth ("Most chosen"), Business and Enterprise, and no audience tabs.
2. **AC-WEB-002-02** — **Given** the Pay yearly switch, **When** it is turned on, **Then** prices read AED 1,990, AED 7,990 and AED 29,990 "a year, billed once"; off, AED 199, AED 799 and AED 2,999 "a month"; Enterprise shows "Custom" and "yearly contract"; all with "Prices exclude 5% VAT".
3. **AC-WEB-002-03** — **Given** a P2 item (Copilot mode, Webhooks and public API, Single sign-on, Scheduled reports, Regional data hosting, White label), **When** it renders, **Then** it carries a "Planned" badge.
4. **AC-WEB-002-04** — **Given** Starter, Growth or Business, **When** the visitor chooses Start free, **Then** the sign-up page opens and starts a 14-day trial with no card ([ORG-004](../../org/004-sign-up-and-sign-in/spec.md)).
5. **AC-WEB-002-05** — **Given** Enterprise, **When** the visitor chooses Talk to us and sends the contact form, **Then** "Our team will email you within 1 working day to talk about limits, hosting and an SLA." shows.
6. **AC-WEB-002-06** — **Given** the FAQ, **When** the visitor opens a question, **Then** its answer expands and the previously open one collapses.

## Requirements

### Functional Requirements

- **FR-001**: Pricing MUST show one product with four plans: Starter, Growth, Business, Enterprise, with no audience tabs. [/7.2]
- **FR-002**: Prices MUST be the list prices of [BIL-001](../../bil/001-plan-and-usage/spec.md) FR-017, excluding 5% VAT; they replace the UI spec placeholders "AED [YOUR PRICE]". [/7.2]
- **FR-003**: Pricing MUST have a Monthly / Yearly switch. [/7.2]
- **FR-004**: Items from release P2 MUST carry a "Planned" badge: copilot mode, webhooks and API, SSO, scheduled reports, regional hosting, white label. [/7.2]
- **FR-005**: Pricing MUST have a comparison table and an FAQ. [/7.2]
- **FR-006**: Start free MUST go to the control panel through sign-up ([ORG-004](../../org/004-sign-up-and-sign-in/spec.md)). [/7.2]
- **FR-007**: System MUST state that every plan includes agents, a knowledge base, deployments with the embeddable widget, the live inbox with takeover and handback, core analytics and an audit log, and that limits and model access change. [UI:W-Pricing]
- **FR-008**: System MUST show each plan card with its tagline and features, and mark Growth "Most chosen". [UI:W-Pricing]
- **FR-009**: System MUST mark these items Planned: Growth copilot mode and webhooks and public API; Business single sign-on and scheduled reports; Enterprise regional data hosting and white label. [UI:W-Pricing]
- **FR-010**: System MUST show the comparison rows Agents, Deployments (sites), Seats, Messages a month, Model access, Takeover and handback, Tools and guardrails, Analytics, Audit log and exports, Support; the numbers agree with the plan limits of [BIL-001](../../bil/001-plan-and-usage/spec.md) FR-017. [UI:W-Pricing]
- **FR-011**: System MUST answer the FAQ questions "What counts as a message?", "What happens when I reach a limit?", "Is my data used to train models?", "Can I try it first?" and "Do you support Arabic?" with the design answers, except: "What counts as a message?" becomes "What counts as an AI conversation?" answered "A conversation in which the AI replied at least once. Replies from your team are free."; the limit answer says overage up to your cap is available; "Can I try it first?" is answered "Yes. 14 days with Growth features and 100 AI conversations, no card needed.". [UI:W-Pricing]
- **FR-012**: System MUST show "Talk to us" for Enterprise, collect name, work email, company and message, and confirm "Our team will email you within 1 working day to talk about limits, hosting and an SLA." [UI:W-Pricing]
- **FR-013**: System MUST label the switch "Pay monthly" / "Pay yearly" and show yearly prices as "a year, billed once" and Enterprise as "yearly contract". [UI:W-Pricing]

## Success Criteria

- **SC-001**: Every P2 item on the page carries the "Planned" badge.

## Assumptions and Open Items

- Help and support in the control panel links to Pricing ([PLT-003](../../platform/003-shell-and-navigation/spec.md)).
- Prices, trial and overage are set in [BIL-001](../../bil/001-plan-and-usage/spec.md); the comparison row "Messages a month" becomes "AI conversations a month" with 300, 2,000, 10,000 and Custom.
