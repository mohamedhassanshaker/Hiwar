---
title: UI coverage of C-Knowledge
status: draft
owner: product owner
related: [KNO-001, KNO-002]
version: 0.1
last-updated: 2026-11-18
---

# UI coverage: C-Knowledge

Artboard: `design/boards/C-Knowledge.dc.html` in `00-input-requirements/Hiwar-claude-code-handoff.zip`

| UI function | Kind | Covered by |
| --- | --- | --- |
| Add a source | action | KNO-001 FR-006 |
| Sources | action | KNO-001 FR-002 |
| Unanswered questions | action | KNO-001 FR-002, KNO-002 FR-007 |
| Knowledge views | control | KNO-001 FR-002 |
| Knowledge (page title) | heading | n/a: layout |
| Stats: Sources ready, Chunks searchable, Storage used, Unanswered this week | state | KNO-001 FR-001, KNO-001 FR-009 |
| Sources table and status labels | state | KNO-001 FR-003, KNO-001 FR-004 |
| Source details under the name | state | KNO-001 FR-016 |
| Re-crawl, Retry, Replace, Disable, Enable | action | KNO-001 FR-005 |
| Delete source | action | KNO-001 FR-005, KNO-001 FR-014 |
| Removed {name} and its chunks | outcome | KNO-001 FR-014 |
| Failure reason | state | KNO-001 FR-015 |
| How a source is prepared | rule | KNO-001 FR-013 |
| Queued, Processing, Ready transitions | state | KNO-001 FR-007 |
| Source type | control | KNO-001 FR-006 |
| Drop files here or browse (PDF, DOCX, TXT, MD or CSV, up to 25 MB) | field | KNO-001 FR-010 |
| Website address | field | KNO-001 FR-006 |
| Crawl depth | field | KNO-001 FR-011 |
| Stay on these domains | field | KNO-001 FR-011 |
| Question | field | KNO-001 FR-006 |
| Answer | field | KNO-001 FR-006 |
| Add and prepare | action | KNO-001 FR-012 |
| Cancel | action | KNO-001 FR-012 |
| Close | control | KNO-001 FR-012 |
| Arabic, English and mixed documents; not shared | rule | KNO-001 FR-008 |
| Questions the agent could not answer well | heading | KNO-002 FR-004 |
| Write an answer | action | KNO-002 FR-002, KNO-002 FR-005 |
| Suggested answer | field | KNO-002 FR-005 |
| Add as FAQ | action | KNO-002 FR-005 |
| Added to your FAQ. The agent can use it now. | outcome | KNO-002 FR-005 |
| Dismiss (question, toast) | action | KNO-002 FR-003, PLT-004 FR-022 |
| Nothing waiting | state | KNO-002 FR-006 |
