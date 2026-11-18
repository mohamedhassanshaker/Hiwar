---
title: UI coverage of C-Agents
status: draft
owner: product owner
related: [AGT-001, AGT-002, AGT-003]
version: 0.1
last-updated: 2026-11-18
---

# UI coverage: C-Agents

Artboard: `design/boards/C-Agents.dc.html` in `00-input-requirements/Hiwar-claude-code-handoff.zip`

| UI function | Kind | Covered by |
| --- | --- | --- |
| New agent | action | AGT-001 FR-013 |
| Duplicate | action | AGT-001 FR-013 |
| Duplicated as a draft. | outcome | AGT-001 FR-032 |
| Publish v{next} | action | AGT-002 FR-002 |
| Version {n} of {name} is live | outcome | AGT-002 FR-004 |
| Roll back to this | action | AGT-002 FR-005 |
| Rolled back. Version {n} is live again | outcome | AGT-002 FR-005 |
| Manage knowledge | action | AGT-001 FR-022 |
| Add an HTTP tool | action | AGT-001 FR-008 |
| The HTTP tool editor takes a name, a description for the model, an input schema, an endpoint, a method, headers and secrets. | outcome | AGT-001 FR-026 |
| Agents | control | AGT-001 FR-002 |
| Agents (page title) | heading | n/a: layout |
| Agent editor | control | AGT-001 FR-001 |
| Agent settings | control | AGT-001 FR-003 |
| Persona | option | AGT-001 FR-003 |
| Knowledge | option | AGT-001 FR-003 |
| Tools | option | AGT-001 FR-003 |
| Guardrails | option | AGT-001 FR-003 |
| Escalation | option | AGT-001 FR-003 |
| Versions | option | AGT-001 FR-003 |
| persona | option | n/a: duplicate of Persona |
| know | option | n/a: duplicate of Knowledge |
| tools | option | n/a: duplicate of Tools |
| guard | option | n/a: duplicate of Guardrails |
| esc | option | n/a: duplicate of Escalation |
| ver | option | n/a: duplicate of Versions |
| Name shown to visitors | field | AGT-001 FR-014 |
| Model | field | AGT-001 FR-015 |
| Reply language | field | AGT-001 FR-016 |
| Tone | field | AGT-001 FR-017 |
| Persona and instructions | field | AGT-001 FR-020 |
| Creativity | control | AGT-001 FR-019 |
| Reply length | field | AGT-001 FR-018 |
| Operating hours and outside hours | field | AGT-001 FR-021 |
| Knowledge source switches | control | AGT-001 FR-005 |
| Tool enable switches and Read or Write badge | control | AGT-001 FR-006, AGT-001 FR-023 |
| Write tool confirmation select | control | AGT-001 FR-007, AGT-001 FR-025 |
| Write tools never run on their own; secrets encrypted | rule | AGT-001 FR-024 |
| Allowed topics | field | AGT-001 FR-009 |
| Blocked topics | field | AGT-001 FR-009 |
| Refusal message | field | AGT-001 FR-009 |
| Guardrail toggles | control | AGT-001 FR-027 |
| Escalation toggles | control | AGT-001 FR-010, AGT-001 FR-028 |
| After this many low-confidence replies in a row | field | AGT-001 FR-011, AGT-001 FR-029 |
| When no one claims it within 2 minutes | field | AGT-001 FR-012, AGT-001 FR-030 |
| Unpublished changes / Up to date | state | AGT-001 FR-031 |
| Agent purpose and site in the list | state | AGT-001 FR-033 |
| Templates arrive in the next release | state | AGT-001 FR-034 |
| Version published by and date | state | AGT-002 FR-006 |
| Test console | heading | AGT-003 FR-001 |
| Test message | field | AGT-003 FR-006 |
| Try a visitor question | control | AGT-003 FR-006 |
| Sources, tool calls and token cost per turn | state | AGT-003 FR-002, AGT-003 FR-007 |
| Suggestion chips | action | AGT-003 FR-003 |
| Arabic detection | rule | AGT-003 FR-005 |
| Test chat clears on agent change | rule | AGT-003 FR-008 |
| Dismiss | control | PLT-004 FR-022 |
