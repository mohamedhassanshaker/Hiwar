# Feature Specification: Organization setup, plan overrides and grace periods

**Feature ID**: OPS-005
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Tenants
**Personas**: Platform admin, Finance

## User Scenarios & Testing

### User Story 1 - Create an organization for a customer (Priority: P1)

Sales-led and Enterprise customers are set up by Hiwar staff, not by self sign-up.

**Why this priority**: Sales-led and Enterprise customers are set up by Hiwar staff, not by self sign-up.
**Independent Test**: Run the wizard for Bright Smile Dental and check the summary and the Owner invitation.

**Acceptance Scenarios**:

- **AC-OPS-005-01** — **Given** the Organizations screen, **When** a Platform admin chooses Create organization, **Then** a 4-step wizard opens: Details, Plan and features, Starter agent, Review.
- **AC-OPS-005-02** — **Given** step Details, **When** the workspace address is already used or is not 3 to 40 lowercase letters, numbers and dashes, **Then** Next is disabled and the hint names the problem and suggests another address.
- **AC-OPS-005-03** — **Given** step Review, **When** the admin chooses Create organization, **Then** the organization is created on the chosen plan, the Owner invitation is sent and a toast names the address and plan.

### User Story 2 - Change one organization's plan and features (Priority: P1)

Contracts often differ from the published plan.

**Why this priority**: Contracts often differ from the published plan.
**Independent Test**: Open Plan and features for Gulf Bites, turn off a feature, save.

**Acceptance Scenarios**:

- **AC-OPS-005-04** — **Given** an organization row, **When** the admin opens Plan and features, **Then** every feature shows what the plan gives, this organization's value and current use, with the count of features on and changed from plan.
- **AC-OPS-005-05** — **Given** the feature table, **When** the admin picks another plan, **Then** the values reset to that plan and the change applies at once with the next invoice adjusted.
- **AC-OPS-005-06** — **Given** an override, **When** the admin adds a temporary change with an end date and a reason, **Then** the extra applies until the end date and the plan's limit returns afterwards.

### User Story 3 - Extend a grace period (Priority: P2)

Unpaid customers with a purchase order in progress must not lose service.

**Why this priority**: Unpaid customers with a purchase order in progress must not lose service.
**Independent Test**: Extend Marina Realty's grace to 30 Nov with a reason.

**Acceptance Scenarios**:

- **AC-OPS-005-07** — **Given** an Overdue or Read-only organization, **When** the admin extends the grace with a date and a reason, **Then** full use returns until the new date and the reason is logged.

## Requirements

### Functional Requirements

- **FR-001**: The wizard MUST collect name, Owner email, industry, workspace address, region (UAE, KSA) and data separation (shared, own schema, own database).
- **FR-002**: Workspace addresses MUST be unique and use 3 to 40 lowercase letters, numbers and dashes.
- **FR-003**: The wizard MUST offer the agent templates (OPS-005 FR-011) or no starter agent; a template becomes a draft agent.
- **FR-004**: The Review step MUST list every choice with an Edit link to its step and the steps run automatically on creation.
- **FR-005**: Plan and features MUST show, per feature, the plan value, the organization's value (switch, limit or both) and the current use.
- **FR-006**: Features turned off MUST disappear for members at once while their data is kept; lower limits MUST stop new use only; the Owner MUST be emailed.
- **FR-007**: Human handover and the Arabic widget MUST NOT be switched off for any organization.
- **FR-008**: A temporary change MUST have a feature, an amount, an end date and a logged reason.
- **FR-009**: Unpaid organizations MUST keep full use for 30 days, then become read-only automatically (sign-in and export work, widgets show the offline message, no AI conversations are spent).
- **FR-010**: Extending a grace period MUST need a new date and a logged reason; if still unpaid at that date the organization MUST become read-only again.
- **FR-011**: Hiwar MUST publish versioned agent templates; publishing a draft version MUST email organizations that copied it, which keep their own changes.
- **FR-012**: Global defaults (base safety rules, built-in tools, default widget texts) MUST act as floors organizations can only make stricter.
- **FR-013**: Tax by market MUST hold the VAT rate, platform tax number and e-invoicing state per market (UAE 5%, KSA 15%) and scheduled rate changes that apply from a start date without changing earlier invoices.

### Key Entities

- **Feature override**: organization, feature, value, end date (optional), reason, operator.
- **Agent template**: name, kind (Support, Sales, Bookings, FAQ), live version, draft version, change list.
- **Market**: country, currency, VAT rate, tax number, e-invoicing state, scheduled rate changes.

## Success Criteria

- **SC-001**: An operator sets up a new organization in under 5 minutes.

## Assumptions and Open Items

- The screen functions run on sample data until a backend exists for them; the module README names which ones.
- Builds on [OPS-001](../001-organizations/spec.md), which owns the real organization list and actions.
