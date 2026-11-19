# Feature Specification: Public website content, featured items, offers and results

**Feature ID**: OPS-007
**Module**: OPS — Operator portal for the Hiwar team
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-CMS
**Personas**: Platform admin

## User Scenarios & Testing

### User Story 1 - Edit and publish a page in English and Arabic (Priority: P1)

The public site sells the product in both languages.

**Why this priority**: The public site sells the product in both languages.
**Independent Test**: Edit the Home hero in Arabic, reorder a section, publish.

**Acceptance Scenarios**:

- **AC-OPS-007-01** — **Given** the Pages list, **When** an operator opens a page, **Then** sections are listed with a visibility switch and can be reordered; the selected section's headline, text, two buttons with targets, content source and audience are editable per language.
- **AC-OPS-007-02** — **Given** a section without Arabic text, **When** the page is opened, **Then** a warning says Arabic visitors won't see the section and offers Draft Arabic with AI.
- **AC-OPS-007-03** — **Given** the editor, **When** the operator publishes, schedules or rolls back from History, **Then** the change applies, is scheduled for the chosen time, or restores an earlier version as a draft.

### User Story 2 - Feature items and place coupons (Priority: P1)

Marketing needs labelled featured items and campaign offers.

**Why this priority**: Marketing needs labelled featured items and campaign offers.
**Independent Test**: Add a featured item, place a coupon, end both.

**Acceptance Scenarios**:

- **AC-OPS-007-04** — **Given** Featured items, **When** an item is added, **Then** it is labelled Customer story or Editor's pick and has a place and dates.
- **AC-OPS-007-05** — **Given** Offers and coupons, **When** a coupon is placed on a page, **Then** it uses a coupon created in Subscriptions and billing; removing it from pages keeps the coupon.

## Requirements

### Functional Requirements

- **FR-001**: Every public page MUST have English and Arabic versions; missing Arabic MUST be flagged in the list and the editor.
- **FR-002**: Every publish MUST be saved in the page history and MUST be able to be rolled back.
- **FR-003**: Plans and prices on pages MUST come from live plan data.
- **FR-004**: Featured items MUST always be labelled; customer stories MUST have the customer's written consent; at most one featured item per row.
- **FR-005**: Coupons MUST be created only in Subscriptions and billing; one discount per order, never below a plan's minimum price.
- **FR-006**: A site banner MUST have text, a button target and dates.
- **FR-007**: Results MUST show visitors, sign-ups, trials started and paying customers per month, money from the website by stream and the pages that bring sign-ups.

### Key Entities

- **Page**: name, address, status, languages, sections, history.
- **Featured item**: item, place, label, dates, views, sign-ups.
- **Placed coupon**: code, pages, dates, usage, status.

## Success Criteria

- **SC-001**: Arabic coverage of published pages stays at 100%.

## Assumptions and Open Items

- The screen functions run on sample data until a backend exists for them; the module README names which ones.
