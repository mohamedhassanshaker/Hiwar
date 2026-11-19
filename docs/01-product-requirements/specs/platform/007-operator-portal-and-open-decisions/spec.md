# Feature Specification: Operator portal (as-is) and open decisions

**Feature ID**: PLT-007
**Module**: PLATFORM — Cross-cutting rules, brand, shell, design system, personas, open items
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Tenants, O-Plans, O-CMS, O-Support, O-Business, O-Billing, O-Finance, O-Me, O-Agents, O-Skills, O-Connectors, O-Memory, O-Knowledge, O-Models, O-AI, O-Convos, O-Runs
**Personas**: Platform admin, Support operator

## User Scenarios & Testing

### User Story 1 - Operator screens are redesigned before build (Priority: P3)

The platform owner's internal tools are mapped to Hiwar concepts and rewritten before they are built.

**Why this priority**: Not in the P1 build; the content still follows the earlier product.
**Independent Test**: Not testable until the screens are redesigned.

**Acceptance Scenarios**:

The P1 operator portal and its acceptance criteria are in OPS-001 to OPS-004 ([ops](../../ops/README.md)). The other screens below are P2 and get acceptance criteria when they are redesigned.

## Requirements

### Functional Requirements

- **FR-001**: The full operator portal (page 8; the P1 subset is FR-005) MUST contain O-Tenants, O-Plans, O-CMS, O-Support, O-Business, O-Billing, O-Finance, O-Me. [UI spec 9]
- **FR-002**: The full AI capabilities page (page 8b; P2) MUST contain O-Agents, O-Skills, O-Connectors, O-Memory, O-Knowledge, O-Models, O-AI, O-Convos, O-Runs. [UI spec 9]
- **FR-003**: Each operator screen MUST carry this Hiwar meaning: [UI spec 9]

| Screen | Hiwar meaning |
|---|---|
| O-Tenants | Organizations (tenants) list and detail |
| O-Plans | Plan definitions and limits |
| O-CMS | Public site content, banners, coupons |
| O-Support | Support queues for customer organizations |
| O-Business | Model cost, service health, tenant isolation checks |
| O-Billing, O-Finance | Renewals, invoices, payments, ledger |
| O-Agents, O-Skills, O-Connectors | Platform-level agent templates and tools |
| O-Memory, O-Knowledge | Retrieval and knowledge infrastructure |
| O-Models, O-AI | Model routes, failovers, releases, evaluation sets |
| O-Convos, O-Runs | Cross-tenant conversation and run inspection (restricted, audited) |

- **FR-004**: Cross-tenant conversation and run inspection (O-Convos, O-Runs) MUST be restricted and audited. [UI spec 9]
- **FR-005**: P1 MUST build only O-Tenants, O-Plans, O-Support and O-Business, as specified in OPS-001 to OPS-004; O-CMS, O-Billing, O-Finance, O-Me, O-Agents, O-Skills, O-Connectors, O-Memory, O-Knowledge, O-Models, O-AI, O-Convos and O-Runs MUST NOT be built in P1.

## Success Criteria

- **SC-001**: No operator screen is built with learning-product wording.

## Assumptions and Open Items

- Sections 9 and 12 of the UI spec have no subsection, so the coverage index does not list them; they are claimed here under `/1.1`.
- Status of the open decisions of UI spec section 12 after the review:
  - 12.1 Prices and trial terms are placeholders ("AED [price]"): decided in [BIL-001](../../bil/001-plan-and-usage/spec.md).
  - 12.2 Arabic control panel is not designed: not in P1.
  - 12.3 Operator and AI capabilities screens still carry learning-product wording (courses, learners, credits) and need rewriting: P1 scope rewritten as OPS-001 to OPS-004; the rest is P2.
  - 12.4 Foundation components Sidebar, Topbar, Profile, Payments, OrgProfile, TablePager, TableSearch come from the earlier shell: not used in P1; Sidebar's operator menu is replaced by the OPS screens.
  - 12.5 Logo: one of options A, B, C must be chosen and exported as final assets: option A.
  - 12.6 Copilot mode (P2) has a defined status label but no screen: P2, not in P1.
  - 12.7 Mobile layout of the control panel is limited to the collapsible sidebar; Inbox on phones needs a single-column design: decided in [INB-001](../../inb/001-inbox-list-and-thread/spec.md) FR-026.
  - 12.8 Exact copy for error states (network loss, expired session) is not specified: decided in [PLT-008](../008-errors-notifications-search/spec.md).
