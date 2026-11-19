---
title: Blockers
status: draft
owner: product owner
version: 0.1
last-updated: 2026-11-19
related: [specs-pending.md]
---

# Blockers

- Charging real cards needs the owner's Stripe account keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`); the integration is built and tested against `stripe-mock`.
- The model provider for production is not chosen; locally the model stub answers.
