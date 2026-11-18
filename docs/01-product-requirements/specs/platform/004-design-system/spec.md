# Feature Specification: Design system components, status vocabulary and notices

**Feature ID**: PLT-004
**Module**: PLATFORM — Cross-cutting rules, brand, shell, design system, personas, open items
**Status**: Draft
**Sources**: `/5.1`, `/5.2`, `/5.3`
**Screens**: All
**Personas**: All

## User Scenarios & Testing

### User Story 1 - One component set and one status vocabulary (Priority: P1)

Every screen uses the shared components and shows each status with the same dot and label.

**Why this priority**: Consistent status is a product principle.
**Independent Test**: Check each conversation, source, agent and deployment status on screen against the vocabulary.

**Acceptance Scenarios**:

1. **AC-PLT-004-01** — **Given** a conversation in HANDOVER_PENDING, **When** shown anywhere, **Then** it has an amber dot and the label "Waiting for a person".
2. **AC-PLT-004-02** — **Given** a conversation in HUMAN_ACTIVE owned by Khalid, **When** shown, **Then** it has a green dot and the label "With Khalid".
3. **AC-PLT-004-03** — **Given** a toast, **When** shown, **Then** it stays for 4.5 seconds, longer while hovered or focused, and Dismiss closes it at once.
4. **AC-PLT-004-04** — **Given** a disabled button, **When** shown, **Then** it is at 45% opacity.

## Requirements

### Functional Requirements

- **FR-001**: Button MUST have the variants primary (indigo), secondary, ghost, danger and small, and a disabled state at 45% opacity. [/5.1]
- **FR-002**: Status dot `.stt` MUST be an 8 px dot plus label, with variants `ai` (teal), `warn` (amber), `ok` (green), `mut` (grey), `bad` (red). [/5.1]
- **FR-003**: Plain note `.note-p` MUST be a muted paragraph with an optional inline action link and MUST replace alert banners. [/5.1]
- **FR-004**: Badge MUST be a small text tag used only for Read / Write on tools, Planned on pricing items, and plan names. [/5.1]
- **FR-005**: Tabs MUST be underlined with an optional plain count. [/5.1]
- **FR-006**: Segmented control MUST offer 2–3 exclusive options (EN/عربي, Monthly/Yearly, 7/30/90 days). [/5.1]
- **FR-007**: Switch MUST be used for on/off settings. [/5.1]
- **FR-008**: Table MUST have a sticky header, row hover and inline row actions. [/5.1]
- **FR-009**: Progress MUST be used for usage meters, with warning (≥ 80%) and danger (≥ 100%) colours. [/5.1]
- **FR-010**: Avatar MUST be an initials circle. [/5.1]
- **FR-011**: Dialog MUST be a modal for forms and confirmations (add source, invite, hand back). [/5.1]
- **FR-012**: Toast MUST be a transient confirmation at the bottom, shown for 4.5 seconds and kept while hovered or focused; this replaces the UI spec value of 3 seconds. [/5.1]
- **FR-013**: The prototype bar `.proto` (dashed bar with buttons that simulate events) MUST NOT be part of the product UI. [/5.1]
- **FR-014**: Conversation states MUST be shown with this dot and label: [/5.2]

| Conversation state | Dot | Label |
|---|---|---|
| AI_ACTIVE | teal | With the AI |
| HANDOVER_PENDING | amber | Waiting for a person |
| HUMAN_ACTIVE | green | With {name} |
| COPILOT (P2) | teal outline | AI suggesting |
| CLOSED | grey | Closed |

- **FR-015**: Source status MUST be one of Ready, Processing, Queued, Failed (with reason), Disabled. [/5.2]
- **FR-016**: Agent status MUST be one of Live, Draft. [/5.2]
- **FR-017**: Deployment status MUST be one of Live, Paused, Draft. [/5.2]
- **FR-018**: Screens MUST prefer inline text with a status dot over a coloured box. [/5.3]
- **FR-019**: A banner MUST be used only for plan limits and blocking errors. [/5.3]
- **FR-020**: Counts in tabs MUST be plain numbers, never pills. [/5.3]
- **FR-021**: List filters MUST use native selects, not pill filters. [/5.3]
- **FR-022**: Users MUST be able to dismiss a toast before it hides. [UI:C-Inbox]

## Success Criteria

- **SC-001**: No screen uses a pill badge or banner outside the allowed cases.

## Assumptions and Open Items

- COPILOT has a status label but no screen; copilot mode is P2 and not built in P1.
- The inbox uses the labels of FR-014 everywhere.
