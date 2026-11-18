# Feature Specification: Accessibility and localisation

**Feature ID**: PLT-005
**Module**: PLATFORM — Cross-cutting rules, brand, shell, design system, personas, open items
**Status**: Draft
**Sources**: `/5.4`
**Screens**: All
**Personas**: All

## User Scenarios & Testing

### User Story 1 - Usable without colour and by keyboard (Priority: P1)

A user who cannot rely on colour or a pointer can read every status and operate every control.

**Why this priority**: Accessibility applies to every screen.
**Independent Test**: Tab through each screen; open and close a dialog with the keyboard; check every dot has a label.

**Acceptance Scenarios**:

1. **AC-PLT-005-01** — **Given** any status dot, **When** shown, **Then** it has a text label.
2. **AC-PLT-005-02** — **Given** an interactive element, **When** focused, **Then** a focus ring in accent light is shown.
3. **AC-PLT-005-03** — **Given** a dialog is open, **When** the user presses Tab, **Then** focus stays inside the dialog; **When** the user presses Escape, **Then** the dialog closes.
4. **AC-PLT-005-04** — **Given** the widget in Arabic, **When** shown, **Then** it sets `dir="rtl"` and mirrors layout and bubbles.

## Requirements

### Functional Requirements

- **FR-001**: Colour MUST NOT be the only signal; every dot MUST have a text label. [/5.4]
- **FR-002**: All interactive elements MUST show a focus ring in accent light. [/5.4]
- **FR-003**: Body text MUST meet minimum contrast AA. [/5.4]
- **FR-004**: Touch targets MUST be at least 36 px. [/5.4]
- **FR-005**: The widget MUST set `dir="rtl"` in Arabic and mirror layout and bubbles. [/5.4]
- **FR-006**: The visitor widget MUST support English and Arabic with full RTL mirroring and Arabic copy for suggested questions, welcome message and states. [UI spec 10]
- **FR-007**: The control panel MUST be English only; the عربي toggle MUST show a "planned" toast. [UI spec 10]
- **FR-008**: Keyboard order MUST follow visual order. [UI spec 10]
- **FR-009**: Dialogs MUST trap focus and close with Escape. [UI spec 10]
- **FR-010**: The control panel MUST show dates and times in the viewer's time zone in the format "18 Nov 10:41".
- **FR-011**: The widget MUST use the visitor's language for its own copy and keep the agent's replies in the language detected or set ([AGT-001](../../agt/001-agent-configuration/spec.md) FR-016). [UI spec 10]

## Success Criteria

- **SC-001**: Every status on every screen is readable without colour.

## Assumptions and Open Items

- Section 10 of the UI spec has no subsection, so the coverage index does not list it; its content is covered here.
- UI spec 10 says dates and numbers use the organization's locale setting, which is not designed; in P1 FR-010 applies and the locale setting is P2.
- The Arabic control panel is not designed and is not in P1 (UI spec 12, item 2).
