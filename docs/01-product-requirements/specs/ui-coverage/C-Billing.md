---
title: UI coverage of C-Billing
status: draft
owner: product owner
related: [BIL-001]
version: 0.1
last-updated: 2026-11-18
---

# UI coverage: C-Billing

Artboard: `design/boards/C-Billing.dc.html` in `00-input-requirements/Hiwar-claude-code-handoff.zip`

| UI function | Kind | Covered by |
| --- | --- | --- |
| Plan and usage (page title) | heading | n/a: layout |
| Monthly | action | BIL-001 FR-001 |
| Yearly | action | BIL-001 FR-001 |
| Billing period | control | BIL-001 FR-001 |
| Usage banner with See plans | state | BIL-001 FR-004, BIL-001 FR-011 |
| See plans | action | BIL-001 FR-011 |
| Usage this period | heading | BIL-001 FR-002, BIL-001 FR-015 |
| Meter colours at 80% and 100% | state | BIL-001 FR-003 |
| Metering records cannot be edited | rule | BIL-001 FR-016 |
| See cost per conversation | action | BIL-001 FR-016 |
| When a limit is reached | heading | BIL-001 FR-005 |
| Message limit behavior | field | BIL-001 FR-013 |
| People can always keep replying | rule | BIL-001 FR-014 |
| First alert at | field | BIL-001 FR-012 |
| Second alert at | field | BIL-001 FR-012 |
| Invoices table | state | BIL-001 FR-006 |
| PDF | action | BIL-001 FR-022 |
| Invoice {n} is downloading. | outcome | BIL-001 FR-022 |
| Choose a plan | heading | BIL-001 FR-007, BIL-001 FR-008, BIL-001 FR-023 |
| Plan limits | rule | BIL-001 FR-017 |
| Current plan, Upgrade, Switch, Talk to us | action | BIL-001 FR-018 |
| Pick a plan on the right. Changes apply from the next billing period. | outcome | BIL-001 FR-019 |
| You are now on {plan} | outcome | BIL-001 FR-019 |
| Our team will contact you about limits, regional hosting and an SLA. | outcome | BIL-001 FR-018 |
| Payment | heading | BIL-001 FR-010 |
| Update card | action | BIL-001 FR-020 |
| Card details go to the payment provider. Hiwar never stores a full card number. | outcome | BIL-001 FR-020 |
| Failed payment grace period | rule | BIL-001 FR-021 |
| Dismiss | control | PLT-004 FR-022 |
