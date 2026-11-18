# Feature Specification: Public home page

**Feature ID**: WEB-001
**Module**: WEB — Public website
**Status**: Draft
**Sources**: `/7.1`, `/4.3`
**Screens**: W-Home
**Personas**: Prospective customer

## User Scenarios & Testing

### User Story 1 - Understand the product and start (Priority: P1)

A prospective customer reads the home page and starts free or signs in.

**Why this priority**: The home page is the entry to sign-up.
**Independent Test**: Open W-Home, check sections in order, follow every link.

**Acceptance Scenarios**:

1. **AC-WEB-001-01** — **Given** W-Home, **When** it renders, **Then** the sections appear in this order: hero, embed snippet, five steps, takeover section, six feature cards, "Safe by design" band, footer.
2. **AC-WEB-001-02** — **Given** the hero, **When** it renders, **Then** it shows "Built for Arabic and English", the headline "A capable AI assistant on your website in minutes. Your team one click away.", the subhead, Start free, "See the control panel" and the Arabic tagline "مساعد ذكي على موقعك خلال دقائق، وفريقك جاهز للتدخل في أي لحظة." right to left.
3. **AC-WEB-001-03** — **Given** the header or hero, **When** the visitor chooses Start free, **Then** the sign-up page opens ([ORG-004](../../org/004-sign-up-and-sign-in/spec.md)); Sign in opens the sign-in page; a signed-in member goes straight to Conversations (C-Inbox).
4. **AC-WEB-001-04** — **Given** the steps section, **When** it renders, **Then** it shows 1 Subscribe, 2 Configure an agent, 3 Create a deployment, 4 Embed, 5 Monitor and take over, each with its description.
5. **AC-WEB-001-05** — **Given** the takeover section, **When** it renders, **Then** it shows the four rules, the strip With the AI → Waiting for a person → With a person → Handed back, and "Try it in the inbox".
6. **AC-WEB-001-06** — **Given** the Safe by design band, **When** it renders, **Then** it lists organization isolation, guardrails, write tools that ask first, secrets that never reach the model, no training on customer data, the audit log and one owner per conversation, with See plans.
7. **AC-WEB-001-07** — **Given** a signed-in user, **When** they sign out from the panel, **Then** they return to Home.
8. **AC-WEB-001-08** — **Given** a 390 px wide screen, **When** Home renders, **Then** every section is readable without horizontal scrolling.

## Requirements

### Functional Requirements

- **FR-001**: The hero MUST have a headline, subhead, Start free and Sign in, and an Arabic tagline. [/7.1]
- **FR-002**: The embed snippet section MUST show the one-line install. [/7.1]
- **FR-003**: The five steps section MUST show the five steps of FR-011; they cover the UI spec steps create an agent, add knowledge, deploy, watch, take over. [/7.1]
- **FR-004**: The takeover section MUST show a state strip: With the AI → Waiting for a person → With a person → Handed back. [/7.1]
- **FR-005**: Home MUST show six feature cards (FR-013). [/7.1]
- **FR-006**: The "Safe by design" band MUST show guardrails, confirmation on risky tools, audit log, single owner per conversation, and the items of FR-014. [/7.1]
- **FR-007**: Home MUST end with a footer. [/7.1]
- **FR-008**: The public flow MUST be Home → Pricing → Sign in or Start free → Conversations (C-Inbox); Sign out from the panel MUST return to Home. [/4.3]
- **FR-009**: System MUST show the hero label "Built for Arabic and English", the Arabic tagline "مساعد ذكي على موقعك خلال دقائق، وفريقك جاهز للتدخل في أي لحظة." and a "See the control panel" link. [UI:W-Home]
- **FR-010**: System MUST show the install as one async script tag with the deployment key, under 60 KB, isolated from the page styles and not blocking the page. [UI:W-Home]
- **FR-011**: System MUST show the steps 1 Subscribe ("Pick a plan and get your control panel."), 2 Configure an agent ("Persona, instructions, knowledge, tools, guardrails and escalation rules."), 3 Create a deployment ("Choose the sites, allowed domains, look and quotas."), 4 Embed ("Paste one script tag. Check the install in a click."), 5 Monitor and take over ("Watch every conversation live. Step in and hand back at any moment."). [UI:W-Home]
- **FR-012**: System MUST show in the takeover section the rules "The AI never replies while a person owns the chat", "Messages that arrive during a handover reach exactly one party", "Staff see the AI reply in progress, the customer never does", "Handback notes stay private to your team" and a "Try it in the inbox" link; the strip uses labels, not state codes. [UI:W-Home]
- **FR-013**: System MUST show the six feature cards: Agents with versions, Your knowledge, cited, Deployments per site, Guardrails and safe tools, Arabic first, Analytics and cost. [UI:W-Home]
- **FR-014**: System MUST show the Safe by design band with organization isolation, guardrails, write tools that ask first, secrets that never reach the model, no training on customer data, the audit log and one owner per conversation, and a See plans link. [UI:W-Home]
- **FR-015**: System MUST show a header with Home, Pricing, Sign in and Start free, and a footer with Pricing, Control panel and Brand links. [UI:W-Home]
- **FR-016**: Home MUST be readable at 390 px wide without horizontal scrolling. [/7.1]

## Success Criteria

- **SC-001**: Start free and Sign in lead to the control panel from both Home and Pricing.

## Assumptions and Open Items

- The public header shows the Arabic wordmark beside the Latin one ([PLT-002](../../platform/002-brand/spec.md)).
- The hero, steps and feature card copy is the design copy.
