# Feature Specification: Brand and visual identity

**Feature ID**: PLT-002
**Module**: PLATFORM — Cross-cutting rules, brand, shell, design system, personas, open items
**Status**: Draft
**Sources**: `/2.1`, `/2.2`, `/2.3`, `/2.4`
**Screens**: All
**Personas**: All

## User Scenarios & Testing

### User Story 1 - Consistent brand on every surface (Priority: P1)

Every screen uses the Hiwar name, logo, colour tokens and type faces as defined.

**Why this priority**: Brand consistency across panel, site and widget.
**Independent Test**: Inspect sidebar, public header and widget against the tokens.

**Acceptance Scenarios**:

1. **AC-PLT-002-01** — **Given** the sidebar and public header, **When** shown, **Then** the Latin "Hiwar" and the Arabic wordmark **حوار** appear together.
2. **AC-PLT-002-02** — **Given** any colour on a screen, **When** inspected, **Then** it comes from a token in the shared stylesheet.
3. **AC-PLT-002-03** — **Given** danger text, **When** measured, **Then** contrast is at least 5.6:1 (WCAG AA).

## Requirements

### Functional Requirements

- **FR-001**: The product name MUST be **Hiwar** with the Arabic wordmark **حوار**, shown together in the sidebar brand. [/2.1]
- **FR-002**: The logo MUST be option A "Two voices": two overlapping speech bubbles, one white and one teal; the sidebar MUST use it as inline SVG, and the favicon is the mark at 24 px. [/2.1]
- **FR-003**: The palette MUST be indigo with a teal accent, with these tokens from the Brand sheet and `hiwar.css`: [/2.2]

| Role | Value | Use |
|---|---|---|
| Indigo ink (brand deep) | #1B1F4B | Brand base, headings, dark surfaces, sidebar (15.6:1 on white) |
| Indigo (brand, primary) | #4338CA | Primary buttons, active nav, links, focus ring (7.9:1 on white) |
| Indigo soft | #EEF0FF | Selected rows, AI messages, soft badges (background only) |
| Teal (accent) | #14B8A6 | Logo accent, highlights, live indicators, charts; text on it uses indigo ink (6.3:1) |
| Teal ink | #0F766E | Teal when it must be text (5.5:1 on white) |
| Success | #0E7A4F | Person active, ready, verified, live (5.4:1) |
| Warning | #F8B102 fill, #8A5800 text | Waiting for a person, nearing limits |
| Danger | #C8261D | Failed, over limit, destructive actions (5.6:1 text contrast) |
| Muted | grey family from `hiwar.css` | Closed, disabled, secondary text |

- **FR-004**: All colours MUST be tokens in the shared stylesheet. [/2.2]
- **FR-005**: Danger text MUST meet WCAG AA contrast at 5.6:1. [/2.2]
- **FR-006**: The UI MUST use a sans-serif face for the Latin script (Inter 400, 500, 600, 700) and an Arabic-capable face for حوار and the Arabic widget (IBM Plex Sans Arabic). [/2.3]
- **FR-007**: Keys, version tags (`v7`), snippets and ownership versions MUST use a monospace face; sizes follow the Brand sheet. [/2.3]
- **FR-008**: The logo MUST NOT be recoloured outside the brand palette. [/2.4]
- **FR-009**: Clear space of half the mark's height MUST be kept around the mark (Brand sheet; replaces the UI spec rule of clear space equal to the bubble height); the mark MUST be at least 16 px alone and 80 px wide with the wordmark. [/2.4]
- **FR-010**: The Arabic wordmark MUST be used beside the Latin one on the sidebar and public header: to the right of Hiwar in left-to-right layouts and to the left in Arabic layouts. [/2.4]

## Success Criteria

- **SC-001**: No hard-coded colour outside the token set.

## Assumptions and Open Items

- Option A is final; options B and C are not used. The UI spec 2.2 values #12143a, #2a2f6b and #0d9488 are replaced by the Brand sheet tokens that the built boards use.
- Final assets: SVG mark, SVG mark with Latin and Arabic wordmark, 24 px and 16 px favicons, and the mark on indigo ink, on white and on indigo.
