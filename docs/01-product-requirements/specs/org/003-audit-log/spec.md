# Feature Specification: Audit log

**Feature ID**: ORG-003
**Module**: ORG — Team, roles, security and audit log
**Status**: Draft
**Sources**: `/6.9`
**Screens**: C-Audit
**Personas**: Owner, Admin

## User Scenarios & Testing

### User Story 1 - Review who did what (Priority: P1)

An admin filters and searches the audit log and exports it.

**Why this priority**: Accountability for publishing, takeovers, keys, tools and team changes.
**Independent Test**: Filter to Agents, search "Layla", export.

**Acceptance Scenarios**:

1. **AC-ORG-003-01** — **Given** C-Audit, **When** it renders, **Then** the table shows When, Who, Area, Action, Item and Change, newest first (for example "18 Nov 10:41 · Noura Al Suwaidi · Agents · Published version 7 · Layla · prompt edited · tone: warm and professional").
2. **AC-ORG-003-02** — **Given** the area select, **When** the user chooses Conversations, **Then** only conversation entries are shown (for example "Took over · Fatima Al Ketbi · owner AI to Khalid · v3").
3. **AC-ORG-003-03** — **Given** the search field "Search by person or item", **When** the user types "Layla", **Then** only entries whose person, item or action match are shown.
4. **AC-ORG-003-04** — **Given** no entry matches, **When** the table renders, **Then** it shows "No entries match" and "Try another filter."
5. **AC-ORG-003-05** — **Given** an Owner or Admin, **When** they choose Export, **Then** a CSV of the filtered entries downloads, the toast "Export started. This export is added to the log." shows, and a new Exports entry is recorded.
6. **AC-ORG-003-06** — **Given** any user including the Owner, **When** they try to edit or delete an entry through the UI or the API, **Then** no such action exists and the request is refused.
7. **AC-ORG-003-07** — **Given** a secret of a tool is changed, **When** the entry is recorded, **Then** the Change column reads "value rotated · not shown" and no secret value is stored in the log.

## Requirements

### Functional Requirements

- **FR-001**: C-Audit MUST filter by area with a native select: All, Agents, Knowledge, Tools, Deployments, Conversations, Users, Billing, Exports. [/6.9]
- **FR-002**: C-Audit MUST offer search and Export. [/6.9]
- **FR-003**: The table MUST show time, person, area, action and target, as the columns of FR-005. [/6.9]
- **FR-004**: Audit entries MUST be read-only and MUST NOT be deletable. [/6.9]
- **FR-005**: System MUST show the audit columns When, Who, Area, Action, Item and Change. [UI:C-Audit]
- **FR-006**: Users MUST be able to search the log by person or item. [UI:C-Audit]
- **FR-007**: System MUST show "No entries match" and "Try another filter." when no entry matches. [UI:C-Audit]
- **FR-008**: System MUST show the audit log only to the Owner and Admin roles and MUST record exports of the log in the log. [UI:C-Audit]
- **FR-009**: System MUST record conversation takeovers and secret changes without showing secret values (for example "value rotated · not shown"). [UI:C-Audit]
- **FR-010**: System MUST record at least these actions:

| Area | Actions |
|---|---|
| Agents | created, edited (summary of change), published, rolled back, duplicated |
| Knowledge | source added, re-crawled, replaced, disabled, enabled, deleted; FAQ added from unanswered questions |
| Tools | HTTP tool added or changed, secret changed, tool enabled or disabled, confirmation policy changed |
| Deployments | created, made live, paused, key rotated, origin added, removed or verified, appearance or quota changed |
| Conversations | taken over, supervisor take over, write tool approved, rejected or run automatically |
| Users | invited, invitation cancelled, joined, role changed, removed, 2-step sign-in or session length changed |
| Billing | plan changed or scheduled, alert thresholds changed, limit behaviour changed, payment method updated |
| Exports | analytics CSV, audit log export |

- **FR-011**: Export MUST produce a CSV of the entries matching the current filter and search.

### Key Entities

- **Audit entry**: time, person, area (Agents, Knowledge, Tools, Deployments, Conversations, Users, Billing, Exports), action, item, change.

## Success Criteria

- **SC-001**: No user, including the Owner, can change or delete an audit entry.

## Assumptions and Open Items

- The design has eight sample entries such as "Noura published Layla v7", "Khalid took over conversation", "Key rotated for Order site".
- The design shows the area filter as buttons; it is a native select per [PLT-004](../../platform/004-design-system/spec.md) FR-021.
