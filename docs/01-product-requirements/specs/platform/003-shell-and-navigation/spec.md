# Feature Specification: Control panel shell and navigation

**Feature ID**: PLT-003
**Module**: PLATFORM — Cross-cutting rules, brand, shell, design system, personas, open items
**Status**: Draft
**Sources**: `/4.1`, `/4.2`
**Screens**: PanelNav, PanelTop, all C- screens
**Personas**: All staff roles

## User Scenarios & Testing

### User Story 1 - Navigate the control panel (Priority: P1)

A signed-in user moves between control panel screens with the sidebar and sees where they are in the top bar.

**Why this priority**: Every screen depends on the shell.
**Independent Test**: Visit every sidebar item and check the active item and breadcrumb.

**Acceptance Scenarios**:

1. **AC-PLT-003-01** — **Given** the sidebar, **When** shown, **Then** it has the groups Build (Agents, Knowledge, Deployments), Operate (Conversations, Analytics), Organization (Plan and usage, Team and roles, Audit log) and Help and support.
2. **AC-PLT-003-02** — **Given** the user is on a screen, **When** the shell is shown, **Then** that sidebar item is highlighted and the breadcrumb reads "Gulf Bites › {screen}".
3. **AC-PLT-003-03** — **Given** the user chooses عربي in the top bar, **When** chosen, **Then** a toast says the Arabic control panel is planned and that Arabic and RTL are shown in the widget.
4. **AC-PLT-003-04** — **Given** a narrow screen, **When** the user taps the mobile menu button, **Then** the sidebar opens.
5. **AC-PLT-003-05** — **Given** the user chip, **When** the user chooses Sign out, **Then** they return to the public Home.

## Requirements

### Functional Requirements

- **FR-001**: The control panel sitemap MUST be: Build (Agents C-Agents, Knowledge C-Knowledge, Deployments C-Deployments → Widget preview C-Widget); Operate (Conversations C-Inbox with count, Analytics C-Analytics); Organization (Plan and usage C-Billing, Team and roles C-Team, Audit log C-Audit); Help and support → Pricing (public). [/4.1]
- **FR-002**: The sidebar (PanelNav) MUST be 248 px wide. [/4.2]
- **FR-003**: The sidebar brand MUST show the logo, "Hiwar" and "حوار". [/4.2]
- **FR-004**: The sidebar MUST show the organization chip, for example "Gulf Bites Restaurants · Growth plan". [/4.2]
- **FR-005**: The sidebar MUST show the groups Build, Operate, Organization, Help and support, with the active item highlighted. [/4.2]
- **FR-006**: Conversations MUST show a plain count (3 in the sample). [/4.2]
- **FR-007**: The sidebar MUST show the user chip, for example "Noura Al Suwaidi · Owner"; Sign out MUST return to the public Home. [/4.2]
- **FR-008**: On narrow screens the sidebar MUST open from the mobile menu button. [/4.2]
- **FR-009**: The top bar (PanelTop) MUST be 60 px high. [/4.2]
- **FR-010**: The top bar MUST show the breadcrumb "Gulf Bites › {screen}". [/4.2]
- **FR-011**: The top bar MUST have a search field. [/4.2]
- **FR-012**: The top bar MUST have a language control EN / عربي; choosing Arabic MUST show a toast that the Arabic control panel is planned and Arabic and RTL are shown in the widget. [/4.2]
- **FR-013**: The top bar MUST have a notification bell with a count (2 in the sample). [/4.2]
- **FR-014**: Control panel screens MUST use the layout grid: sidebar + main, content scroll area, card surfaces, split and three-column split (inbox), rail, center, narrow and wide helpers; boards are 1440 px wide and fluid. [/4.2]
- **FR-015**: System MUST search conversations, agents and sources from the top bar ("Search conversations, agents…"). [UI:PanelTop]
- **FR-016**: System MUST open the sidebar on narrow screens with "Open menu" and close it with "Close menu" or by choosing outside it. [UI:PanelNav]

## Success Criteria

- **SC-001**: Every control panel screen shows the same sidebar and top bar.

## Assumptions and Open Items

- In the prototype the sidebar opens through a `hiwar-nav` event and the active item is set with an `active` prop; these are prototype mechanisms.
- Below 768 px the sidebar collapses behind the menu button; the inbox's single-column layout is in [INB-001](../../inb/001-inbox-list-and-thread/spec.md) FR-026.
- Search results and notification content are specified in [PLT-008](../008-errors-notifications-search/spec.md).
- Sidebar items a role cannot use are hidden ([ORG-002](../../org/002-roles-and-permissions/spec.md) FR-006).
