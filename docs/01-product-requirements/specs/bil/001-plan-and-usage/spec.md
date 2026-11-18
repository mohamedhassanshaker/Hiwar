# Feature Specification: Plan and usage

**Feature ID**: BIL-001
**Module**: BIL — Plan, usage and invoices
**Status**: Draft
**Sources**: `/6.7`
**Screens**: C-Billing
**Personas**: Owner, Billing

## User Scenarios & Testing

### User Story 1 - Watch usage against limits (Priority: P1)

The owner sees usage against each plan limit, is warned when nearing it, and sets what happens at the limit and when alerts fire.

**Why this priority**: Prevents surprise service stops and charges, and prompts the upgrade.
**Independent Test**: Set the AI conversations meter to 79%, 80% and 100% and check colours, banner and alerts.

**Acceptance Scenarios**:

1. **AC-BIL-001-01** — **Given** Usage this period ("1 to 30 November. Resets on 1 December."), **When** it renders, **Then** it shows AI conversations, Agents, Deployments, Seats and Knowledge storage, each as used of limit with a progress bar (for example "1,640 of 2,000" AI conversations on Growth).
2. **AC-BIL-001-02** — **Given** a meter below 80%, **When** shown, **Then** it uses the normal colour; at 80% or above the warning colour; at 100% the danger colour.
3. **AC-BIL-001-03** — **Given** the first alert threshold is 80% and AI conversations reach 82%, **When** the page renders, **Then** the banner "You have used 82% of this month's AI conversations" shows with See plans, and Owner and Billing members got an email and a bell notification once at 80%.
4. **AC-BIL-001-04** — **Given** the alert selects, **When** the user sets First alert at 70% and Second alert at 95%, **Then** alerts and the banner follow the new thresholds.
5. **AC-BIL-001-05** — **Given** the AI conversation limit is reached with the behaviour "Stop the AI, show the fallback message and route to a person", **When** a new visitor writes, **Then** the AI does not reply, the visitor sees the fallback message, the conversation moves to Needs a person and staff can still reply.
6. **AC-BIL-001-06** — **Given** a conversation in which only staff replied, **When** usage is counted, **Then** it is not an AI conversation; **Given** the AI replied once and the conversation reopened within 24 hours, **Then** it counts once.

### User Story 2 - Keep the AI running with capped overage (Priority: P1)

The owner lets the AI continue past the plan limit at a known rate, up to a cap.

**Why this priority**: Stopping the AI at the limit hurts the customer's visitors and loses revenue.
**Independent Test**: On Growth, choose overage with a cap of AED 80 and exceed the limit by 120 conversations.

**Acceptance Scenarios**:

1. **AC-BIL-001-07** — **Given** Growth with "Continue and bill the overage up to a monthly cap" and a cap of AED 80, **When** 100 AI conversations over the limit happen, **Then** the AI keeps replying, the meter shows "100 over · AED 80.00", and the next invoice has an overage line of 100 × AED 0.80.
2. **AC-BIL-001-08** — **Given** the cap is reached, **When** the 101st extra conversation starts, **Then** the default behaviour applies and Owner and Billing are notified.

### User Story 3 - Choose and change plan (Priority: P1)

The owner compares plans and changes plan after confirming the effective date.

**Why this priority**: Upgrading is the response to reaching limits.
**Independent Test**: Upgrade Growth to Business; then downgrade to Starter with 3 agents.

**Acceptance Scenarios**:

1. **AC-BIL-001-09** — **Given** Choose a plan, **When** Monthly is selected, **Then** it shows Starter AED 199, Growth AED 799, Business AED 2,999 a month and Enterprise "Custom", with "Prices exclude 5% VAT"; Yearly shows AED 1,990, AED 7,990 and AED 29,990 a year.
2. **AC-BIL-001-10** — **Given** the current plan is Growth (button "Current plan", disabled), **When** the user chooses Upgrade on Business, **Then** a confirm dialog shows Business, the price and the effective date today; on confirm, the toast "You are now on Business. Limits and alerts update immediately." shows and the limits change at once.
3. **AC-BIL-001-11** — **Given** Growth with 3 agents in use, **When** the user chooses Switch on Starter, **Then** the dialog says the change applies from the next billing period and is blocked until agents are reduced to 1, listing each limit exceeded.
4. **AC-BIL-001-12** — **Given** usage within Starter limits, **When** the user confirms Switch to Starter, **Then** the plan changes on the first day of the next billing period and the page shows the scheduled change.
5. **AC-BIL-001-13** — **Given** Enterprise, **When** the user chooses Talk to us, **Then** the toast "Our team will contact you about limits, regional hosting and an SLA." shows and the sales team receives the request.
6. **AC-BIL-001-14** — **Given** an organization in its trial with 9 days left and 40 of 100 AI conversations used, **When** C-Billing renders, **Then** it shows "Trial · 9 days left" and the meter "40 of 100", with Choose a plan.

### User Story 4 - Invoices and payment method (Priority: P2)

The owner downloads invoices and updates the payment method.

**Why this priority**: Needed for accounting, not for using the product.
**Independent Test**: Download an invoice; choose Update card.

**Acceptance Scenarios**:

1. **AC-BIL-001-15** — **Given** the invoices table, **When** the user chooses PDF on INV-2026-011, **Then** the PDF downloads, showing the plan, any overage line, 5% VAT and the total, and the toast "Invoice INV-2026-011 is downloading." shows.
2. **AC-BIL-001-16** — **Given** Payment shows "Visa ending 4242", **When** the user chooses Update card, **Then** card entry happens with the payment provider, and Hiwar stores no full card number.
3. **AC-BIL-001-17** — **Given** a payment fails, **When** the grace period ends unpaid, **Then** new chats pause, existing data is kept, and Owner and Billing are notified.

### Edge Cases

- Enterprise meters show "custom" instead of a limit.
- A Billing member opens Plan and usage; an Admin cannot ([ORG-002](../../org/002-roles-and-permissions/spec.md)).
- Overage is not offered during the trial.

## Requirements

### Functional Requirements

- **FR-001**: C-Billing MUST have a Monthly / Yearly segmented control. [/6.7]
- **FR-002**: Usage meters MUST cover AI conversations (defined in FR-027, in place of messages), agents, deployments, seats and knowledge storage, each showing used / limit and a progress bar. [/6.7]
- **FR-003**: A meter at 80% or above MUST use the warning colour; at 100% it MUST use the danger colour. [/6.7]
- **FR-004**: An 80%-usage banner with an Upgrade action MUST be shown for the nearing-limit state, from the first alert threshold (default 80%). [/6.7]
- **FR-005**: Limits and alerts MUST have behaviour at limit (select, FR-013) and alert thresholds (default 80% and 100%, set with the selects of FR-012). [/6.7]
- **FR-006**: The invoices table MUST show number, period, amount, status and Download. [/6.7]
- **FR-007**: Plans MUST be Starter, Growth, Business and Enterprise (custom, Contact sales), with the current plan marked. [/6.7]
- **FR-008**: Prices MUST be the list prices of FR-017, shown excluding 5% VAT with the note "Prices exclude 5% VAT"; they replace the UI spec placeholders "AED [price]". [/6.7]
- **FR-009**: Change plan MUST open a confirm dialog with the price and the effective date. [/6.7]
- **FR-010**: Payment method MUST show a card note with Update. [/6.7]
- **FR-011**: System MUST send usage alerts to the Owner and Billing roles by email and in the notification bell; the banner reads "You have used {n}% of this month's AI conversations" with See plans. [UI:C-Billing]
- **FR-012**: System MUST offer "First alert at" 70%, 80% (default) or 90% and "Second alert at" 95% or 100% (default); each alert fires once per period. [UI:C-Billing]
- **FR-013**: System MUST offer the limit behaviours "Stop the AI, show the fallback message and route to a person" (default; design label "Stop replying, show my fallback message and route to a person"), "Show offline message" and "Continue and bill the overage up to a monthly cap" (FR-025). [UI:C-Billing]
- **FR-014**: System MUST let people keep replying when the AI conversation limit is used up. [UI:C-Billing]
- **FR-015**: System MUST meter usage per calendar month and reset it on the 1st (for example "1 to 30 November. Resets on 1 December."). [UI:C-Billing]
- **FR-016**: System MUST NOT allow metering records to be edited, and they MUST match the payment provider's usage; a link "See cost per conversation" opens C-Analytics. [UI:C-Billing]
- **FR-017**: System MUST apply these plans (prices in AED excluding VAT; yearly = 10 × monthly): [UI:C-Billing]

| Plan | Monthly | Yearly | AI conversations a month | Agents | Deployments | Seats | Knowledge storage | Models | Tools |
|---|---|---|---|---|---|---|---|---|---|
| Starter | 199 | 1,990 | 300 | 1 | 1 | 2 seats | 1 GB | Fast | Built-in |
| Growth | 799 | 7,990 | 2,000 | 5 | 5 | 10 seats | 5 GB | Fast and standard | Built-in and HTTP |
| Business | 2,999 | 29,990 | 10,000 | 20 | 20 | 30 seats | 25 GB | All | Built-in and HTTP |
| Enterprise | Custom, from 10,000 | Yearly contract | Custom | Custom | Custom | Custom | Custom | All | Built-in and HTTP |

- **FR-018**: System MUST label plan actions Current plan (disabled), Upgrade, Switch and Talk to us; Talk to us confirms "Our team will contact you about limits, regional hosting and an SLA." [UI:C-Billing]
- **FR-019**: An upgrade MUST apply at once ("You are now on {plan}. Limits and alerts update immediately."); a downgrade MUST apply from the next billing period ("Changes apply from the next billing period.") and MUST be blocked while usage exceeds the new plan's limits, listing what to reduce. [UI:C-Billing]
- **FR-020**: System MUST send card details to the payment provider and MUST NOT store a full card number ("Card details go to the payment provider. Hiwar never stores a full card number."); the action is "Update card". [UI:C-Billing]
- **FR-021**: System MUST give a grace period after a failed payment, then pause new chats while keeping the organization's data. [UI:C-Billing]
- **FR-022**: System MUST download invoices as PDF, with plan, overage lines, 5% VAT and total, and show invoice status (for example Paid). [UI:C-Billing]
- **FR-023**: System MUST describe each plan: Starter "1 agent, 1 deployment, 2 seats, 300 AI conversations"; Growth "5 agents and deployments, 10 seats, HTTP tools, copilot mode, webhooks"; Business "Higher quotas, SSO, advanced analytics, priority support"; Enterprise "Custom limits, regional hosting, SLA, security review"; copilot mode, webhooks, SSO and regional hosting carry the Planned badge. [UI:C-Billing]
- **FR-024**: Only the Owner and Billing roles MUST be able to open C-Billing. [/6.7]
- **FR-025**: With overage on, each AI conversation over the plan MUST be charged AED 1.00 (Starter), AED 0.80 (Growth) or AED 0.60 (Business), up to the monthly cap the customer sets (default AED 500); at the cap the default behaviour MUST apply and Owner and Billing MUST be notified; the meter MUST show conversations over the limit and the overage amount.
- **FR-026**: During the trial C-Billing MUST show "Trial · {n} days left", the trial meter (100 AI conversations, 1 deployment) and Choose a plan; overage MUST NOT be offered.
- **FR-027**: System MUST count an AI conversation once when the AI sends its first reply in it; replies from people, internal notes and test-console chats MUST NOT count; a reopen within 24 hours MUST NOT count again.

### Key Entities

- **Usage meter**: resource (AI conversations, agents, deployments, seats, knowledge storage), used, limit, period, over-limit count, overage amount.
- **Alert settings**: first threshold, second threshold, alerts sent this period.
- **Limit settings**: behaviour at limit, overage cap.
- **Invoice**: number, period, plan amount, overage lines, VAT, total, status.
- **Plan**: Starter, Growth, Business, Enterprise, Trial; scheduled plan change with effective date.

## Success Criteria

- **SC-001**: Every meter at or above 80% is shown in the warning or danger colour.
- **SC-002**: Invoiced usage equals the metered AI conversations for every period.

## Assumptions and Open Items

- The sample organization is on the Growth plan. The design sample "16,400 of 20,000" messages becomes AI conversations (FR-027).
- The length of the payment grace period is set with the payment provider and is not fixed here.
- Prices are reviewed after 90 days of real usage.
