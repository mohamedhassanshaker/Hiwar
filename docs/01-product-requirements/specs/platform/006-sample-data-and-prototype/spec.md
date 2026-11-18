# Feature Specification: Personas, sample data and prototype behaviour

**Feature ID**: PLT-006
**Module**: PLATFORM — Cross-cutting rules, brand, shell, design system, personas, open items
**Status**: Draft
**Sources**: `/1.1`
**Screens**: All
**Personas**: All

## User Scenarios & Testing

### User Story 1 - Seed data matches the design (Priority: P2)

A tester loads the sample organization and sees the same people, agents, deployments and conversations as the design.

**Why this priority**: Shared fixtures let design, engineering and QA test the same cases.
**Independent Test**: Load the seed and compare with the lists below.

**Acceptance Scenarios**:

1. **AC-PLT-006-01** — **Given** the seed, **When** loaded, **Then** the organization is Gulf Bites Restaurants on the Growth plan, with agents Layla (v7, live), Salim (v3, live) and Rana (draft), and deployments Order site · Dubai (live), Catering page (live, pinned to v3) and Arabic landing page (draft).

## Requirements

### Functional Requirements

- **FR-001**: Personas and sample data MUST be: [UI spec 3]

| Persona | Role | Where used |
|---|---|---|
| Noura Al Suwaidi | Owner of Gulf Bites Restaurants | Signed-in user shown in the sidebar |
| Khalid | Support Agent | Owns the human conversation in the inbox |
| Omar Hassan | Visitor | Conversation c1, AI active |
| Fatima Al Ketbi | Visitor (Arabic) | Conversation c2, waiting for a person |
| Rashid Al Mazrouei | Visitor | Conversation c3, owned by Khalid |
| Builder, Analyst, Billing | Team members | Team and permission screens |

- **FR-002**: The sample organization MUST be **Gulf Bites Restaurants** on the **Growth plan**; agents **Layla** (v7, live), **Salim** (v3, live), **Rana** (draft); deployments **Order site · Dubai** (live), **Catering page** (live, pinned to v3), **Arabic landing page** (draft). [UI spec 3]
- **FR-003**: The prototype keeps this state per screen, and all of it resets on reload: [UI spec 8]

| Screen | State kept in the prototype |
|---|---|
| C-Inbox | Conversation list, active conversation, ownership and version, composer mode, simulated visitor messages |
| C-Agents | Selected agent, draft edits, versions, test conversation |
| C-Knowledge | Sources, processing timers, unanswered list |
| C-Deployments | Deployments, origins, appearance, quotas |
| C-Widget | Language, widget state, messages |
| C-Analytics | Range, breakdown selection |
| C-Billing | Interval, selected plan |
| C-Team | Members, roles, invite |
| C-Audit | Filter, search |

- **FR-004**: The dashed prototype bar and canned responses MUST NOT be built as product UI. [UI spec 8]

## Success Criteria

- **SC-001**: The seed reproduces every sample value above.

## Assumptions and Open Items

- Sections 3 and 8 of the UI spec have no subsection, so the coverage index does not list them; they are claimed here under `/1.1` (scope of the prototype).
- Seed conversations c1, c2 and c3 are detailed in [INB-001](../../inb/001-inbox-list-and-thread/spec.md).
