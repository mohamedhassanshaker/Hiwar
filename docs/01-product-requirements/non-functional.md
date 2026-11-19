---
title: Non-functional requirements
status: draft
owner: product owner
version: 0.1
last-updated: 2026-11-19
related: [specs/README.md, ../06-security/security.md]
---

# Non-functional requirements

| Area | Requirement | Spec |
| --- | --- | --- |
| Live updates | A new visitor message or state change reaches every viewer within 2 seconds | INB-001 SC-002, PLT-008 SC-001 |
| Concurrency | Under 50 simultaneous claims of one conversation exactly one succeeds | INB-002 SC-002 |
| Widget weight | The loader script is under 60 KB and never blocks the host page | DEP-003 SC-002 |
| Accessibility | WCAG 2.2 AA contrast; every status has a text label; dialogs trap focus and close with Escape; touch targets at least 36 px | PLT-005 |
| Languages | The widget works in English and Arabic with right-to-left; the control panel is English in P1 | PLT-005 |
| Security | See [security](../06-security/security.md) | ORG-002, OPS-003 |
