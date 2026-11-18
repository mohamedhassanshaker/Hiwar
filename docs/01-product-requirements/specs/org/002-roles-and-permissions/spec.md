# Feature Specification: Roles and permission matrix

**Feature ID**: ORG-002
**Module**: ORG — Team, roles, security and audit log
**Status**: Draft
**Sources**: `/6.8`
**Screens**: C-Team, all C- screens
**Personas**: Owner, Admin, Builder, Support Agent, Analyst, Billing

## User Scenarios & Testing

### User Story 1 - Each role can do only its capabilities (Priority: P1)

Each member can use exactly the capabilities their role grants in the permission matrix, in the UI and in the API behind it.

**Why this priority**: The matrix is the access control of the control panel.
**Independent Test**: Sign in as each role and try each capability, through the UI and directly through the API.

**Acceptance Scenarios**:

1. **AC-ORG-002-01** — **Given** a Builder, **When** they open Conversations, **Then** the item is hidden in the sidebar and a direct request to view or reply is refused.
2. **AC-ORG-002-02** — **Given** a Support Agent, **When** they open a conversation, **Then** they can view, reply, write notes, claim, take over from the AI, hand back, release and approve write tools on conversations they own.
3. **AC-ORG-002-03** — **Given** a Support Agent, **When** a colleague owns a conversation, **Then** Take over is not available; **Given** an Owner or Admin, **Then** it is.
4. **AC-ORG-002-04** — **Given** a Billing member, **When** they open Plan and usage, **Then** they can manage plan and invoices, and Analytics is hidden.
5. **AC-ORG-002-05** — **Given** an Admin, **When** they request Plan and usage, **Then** access is refused.
6. **AC-ORG-002-06** — **Given** a Support Agent, **When** they open Analytics, **Then** they get the limited view of [ANA-001](../../ana/001-analytics-dashboard/spec.md) FR-016.
7. **AC-ORG-002-07** — **Given** any role, **When** a capability is "No", **Then** its menu item and actions are hidden and any request for it is refused and not executed.

## Requirements

### Functional Requirements

- **FR-001**: System MUST enforce the permission matrix (spec 4.1.1) below; "Yes" grants the capability and "No" denies it. [/6.8]

| Capability | Owner | Admin | Builder | Support Agent | Analyst | Billing |
|---|---|---|---|---|---|---|
| Manage agents and knowledge | Yes | Yes | Yes | No | No | No |
| Manage deployments | Yes | Yes | Yes | No | No | No |
| View and reply to conversations | Yes | Yes | No | Yes | No | No |
| Take over and hand back | Yes | Yes | No | Yes | No | No |
| View analytics | Yes | Yes | Yes | Limited | Yes | No |
| Manage plan and invoices | Yes | No | No | No | No | Yes |
| Manage team and roles | Yes | Yes | No | No | No | No |
| View audit log | Yes | Yes | No | No | No | No |

- **FR-002**: C-Team MUST show the permission matrix. [/6.8]
- **FR-003**: System MUST also enforce these capabilities:

| Capability | Owner | Admin | Builder | Support Agent | Analyst | Billing |
|---|---|---|---|---|---|---|
| Take over from another person | Yes | Yes | No | No | No | No |
| Approve or reject write tools (as owner) | Yes | Yes | No | Yes | No | No |
| Export analytics CSV | Yes | Yes | No | No | Yes | No |
| Export audit log | Yes | Yes | No | No | No | No |

- **FR-004**: "Limited" analytics for Support Agent MUST mean the view of [ANA-001](../../ana/001-analytics-dashboard/spec.md) FR-016: no cost figures and no export. [/6.8]
- **FR-005**: System MUST check every capability on the server for each request, not only by hiding UI. [/6.8]
- **FR-006**: Screens and actions a role cannot use MUST be hidden from that role's navigation and pages. [/6.8]

## Success Criteria

- **SC-001**: Every "No" cell in the matrices is denied for that role, through the UI and the API.

## Assumptions and Open Items

- The matrix references the product specification section 4.1.1, which is not in the inputs; for P1 this matrix, extended in FR-003, is the requirement.
