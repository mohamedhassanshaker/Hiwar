# Feature Specification: Product scope, principles and release scope

**Feature ID**: PLT-001
**Module**: PLATFORM — Cross-cutting rules, brand, shell, design system, personas, open items
**Status**: Draft
**Sources**: `/1.1`, `/1.2`
**Screens**: All
**Personas**: All

## User Scenarios & Testing

### User Story 1 - Build the P1 release scope (Priority: P1)

The team builds the P1 screens and keeps P2 items visible only as "Planned" on Pricing.

**Why this priority**: Defines what is built now.
**Independent Test**: Check the control panel and public site against the P1 list; check that P2 items appear only on Pricing.

**Acceptance Scenarios**:

1. **AC-PLT-001-01** — **Given** release P1, **When** the product is built, **Then** it includes the inbox with takeover, claim, hand back, release and close; Agents, Knowledge, Deployments, Widget, Analytics, Plan and usage, Team and roles, Audit log, Home and Pricing.
2. **AC-PLT-001-02** — **Given** a P2 item (copilot mode, webhooks and API, SSO, scheduled reports, regional hosting, white label), **When** the UI is shown, **Then** the item appears only on Pricing, with a "Planned" badge.
3. **AC-PLT-001-03** — **Given** a P3 item, **When** the UI is shown, **Then** it does not appear.

## Requirements

### Functional Requirements

- **FR-001**: The control panel (customer-facing) MUST provide 9 screens: C-Inbox, C-Agents, C-Knowledge, C-Deployments, C-Widget, C-Analytics, C-Billing, C-Team, C-Audit. [/1.1]
- **FR-002**: The public website MUST provide 2 screens: Home and Pricing. [/1.1]
- **FR-003**: The platform operator portal and AI capabilities pages MUST be treated as as-is shells with legacy wording until redesigned ([PLT-007](../007-operator-portal-and-open-decisions/spec.md)). [/1.1]
- **FR-004**: The brand sheet and prototype map (Foundations) MUST be the reference for brand assets ([PLT-002](../002-brand/spec.md)). [/1.1]
- **FR-005**: One owner per conversation: the AI or one person owns a conversation at any moment, and the UI never shows two parties replying ([INB-002](../../inb/002-conversation-ownership/spec.md)). [/1.2]
- **FR-006**: Status MUST be shown quietly: a coloured dot plus a label, plain text counts, inline actions; no alert banners or pill badges where a plain label works. [/1.2]
- **FR-007**: Warning banners MUST be used only for real limits (plan usage at 80%). [/1.2]
- **FR-008**: Staff stay in control: take over, claim, hand back and release MUST always be one click away in the inbox ([INB-002](../../inb/002-conversation-ownership/spec.md)). [/1.2]
- **FR-009**: Transparent AI: the widget MUST label the AI ([DEP-003](../../dep/003-visitor-widget/spec.md)), and staff MUST be able to see what the AI used (sources and tool calls) for each answer ([INB-001](../../inb/001-inbox-list-and-thread/spec.md)). [/1.2]
- **FR-010**: Bilingual: the visitor widget MUST support English and Arabic with RTL; the control panel MUST be English in this version. [/1.2]
- **FR-011**: Release P1 MUST include the inbox with takeover, claim, hand back, release, close; Agents, Knowledge, Deployments, Widget, Analytics, Plan and usage, Team and roles, Audit log, Home, Pricing. [UI spec 11]
- **FR-012**: Release P2 items (copilot mode, webhooks and API, SSO, scheduled reports, regional hosting, white label) MUST be shown as "Planned" on Pricing only. [UI spec 11]
- **FR-013**: Release P3 items MUST NOT be shown in the UI. [UI spec 11]
- **FR-014**: P1 MUST NOT include the Arabic control panel, copilot mode or the earlier shell components (Sidebar, Topbar, Profile, Payments, OrgProfile, TablePager, TableSearch).
- **FR-015**: P1 MUST include sign-up, sign-in, 2-step sign-in and invitations ([ORG-004](../../org/004-sign-up-and-sign-in/spec.md)) and write-tool approval ([INB-003](../../inb/003-write-tool-approval/spec.md)).
- **FR-016**: P1 MUST include the minimal operator portal OPS-001 to OPS-004, list prices with a 14-day trial, and capped overage.

## Success Criteria

- **SC-001**: All 9 control panel screens and 2 public screens are built for P1.

## Assumptions and Open Items

- Release scope comes from UI spec section 11 ("Release scope (from the product specification)"), which the coverage index does not list as its own section; it is claimed here under `/1.1`.
- The product specification ("Hiwar: Product Specification") is referenced by the UI spec but is not in the inputs.
