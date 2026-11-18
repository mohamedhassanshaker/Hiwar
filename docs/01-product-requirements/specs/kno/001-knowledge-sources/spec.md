# Feature Specification: Knowledge sources and ingestion

**Feature ID**: KNO-001
**Module**: KNO — Knowledge sources and unanswered questions
**Status**: Draft
**Sources**: `/6.3`
**Screens**: C-Knowledge
**Personas**: Owner, Admin, Builder

## User Scenarios & Testing

### User Story 1 - Add a source (Priority: P1)

A builder adds files, a website or an FAQ entry, and watches it move through ingestion until it is ready.

**Why this priority**: Agents answer from their knowledge sources.
**Independent Test**: Add one source of each mode and follow its status.

**Acceptance Scenarios**:

1. **AC-KNO-001-01** — **Given** the Add a source dialog in Upload files mode, **When** it renders, **Then** it offers drag and drop or browse with the hint "PDF, DOCX, TXT, MD or CSV. Up to 25 MB each."
2. **AC-KNO-001-02** — **Given** the user drops a 30 MB PDF or an .exe file, **When** the file is checked, **Then** it is refused with the reason and no row is created.
3. **AC-KNO-001-03** — **Given** Website mode, **When** it renders, **Then** it asks for Website address, Crawl depth (1 level, 2 levels default, 3 levels) and "Stay on these domains".
4. **AC-KNO-001-04** — **Given** FAQ entry mode, **When** the user enters a question and an answer and chooses "Add and prepare", **Then** a row of type FAQ appears.
5. **AC-KNO-001-05** — **Given** a valid submission, **When** the user chooses "Add and prepare", **Then** the dialog closes, a new row appears as Queued and moves to Processing and then Ready with its chunk count; Cancel or Close leaves without adding.
6. **AC-KNO-001-06** — **Given** "Old price list.pdf" is a scan, **When** preparation fails, **Then** its status is Failed with the reason "The PDF is a scan with no readable text. Upload a text version." and a Retry action.

### User Story 2 - Maintain sources (Priority: P2)

A builder re-crawls websites, retries failed sources, replaces files, disables, enables or deletes sources.

**Why this priority**: Knowledge must stay current and correct.
**Independent Test**: Apply each row action to a source of the matching type.

**Acceptance Scenarios**:

1. **AC-KNO-001-07** — **Given** the website source, **When** the user chooses Re-crawl, **Then** it moves to Processing and back to Ready, updating only changed pages.
2. **AC-KNO-001-08** — **Given** a ready source, **When** the user chooses Disable, **Then** its status is Disabled, agents stop retrieving from it, and its chunks leave the searchable count; Enable reverses this.
3. **AC-KNO-001-09** — **Given** any source, **When** the user chooses Delete, **Then** a confirmation dialog names the source; on confirm, the source and its chunks are removed, the toast "Removed {name} and its chunks. Past conversations keep their citations." shows, and past conversations keep their citations.
4. **AC-KNO-001-10** — **Given** the stats row, **When** sources change, **Then** Sources ready (of all sources), Chunks searchable, Storage used (of 5 GB on Growth) and Unanswered this week update.
5. **AC-KNO-001-11** — **Given** storage used would exceed the plan's knowledge storage, **When** the user adds a file, **Then** it is refused with the plan limit and an Upgrade link.

### Edge Cases

- Re-crawl is offered only for websites, Retry only for failed sources, Replace only for files.
- A crawl stays on the listed domains; pages that require sign-in fail with "Page requires sign-in".
- Delete cancelled in the dialog: nothing changes.

## Requirements

### Functional Requirements

- **FR-001**: The stats row MUST show sources ready, chunks, storage (shown as 0.4 of 5 GB) and unanswered questions. [/6.3]
- **FR-002**: C-Knowledge MUST have the tabs Sources and Unanswered questions. [/6.3]
- **FR-003**: The Sources table MUST show name, type (File, Website, FAQ), status, chunks and updated. [/6.3]
- **FR-004**: Source status MUST be one of Ready, Processing, Queued, Failed (with reason), Disabled. [/6.3]
- **FR-005**: Row actions MUST be Re-crawl (websites), Retry (failed), Replace (files), Disable/Enable and Delete (with confirmation). [/6.3]
- **FR-006**: The Add source dialog MUST have three modes: Files (drag and drop, type and size hints), Website (URL, crawl depth, allowed domains), FAQ entry (question, answer). [/6.3]
- **FR-007**: A submitted source MUST move Queued → Processing → Ready, or to Failed with a reason (such as "Page requires sign-in") and Retry. [/6.3]
- **FR-008**: System MUST accept Arabic, English and mixed-language documents and MUST NOT share sources with other organizations. [UI:C-Knowledge]
- **FR-009**: System MUST label the stats Sources ready (of all sources), Chunks searchable, Storage used (of the plan quota) and Unanswered this week (questions with low confidence). [UI:C-Knowledge]
- **FR-010**: System MUST accept files in PDF, DOCX, TXT, MD or CSV, up to 25 MB each, and refuse other files with the reason. [UI:C-Knowledge]
- **FR-011**: System MUST offer crawl depths of 1, 2 (default) and 3 levels and a "Stay on these domains" field for websites. [UI:C-Knowledge]
- **FR-012**: Users MUST be able to submit the Add a source dialog with "Add and prepare", or leave it with Cancel or Close. [UI:C-Knowledge]
- **FR-013**: System MUST prepare a source by extracting the text, splitting it into chunks, embedding and indexing it; changes to a page or file update only what changed. [UI:C-Knowledge]
- **FR-014**: After the delete confirmation, System MUST remove the source and its chunks, confirm "Removed {name} and its chunks. Past conversations keep their citations.", and past conversations MUST keep their citations. [UI:C-Knowledge]
- **FR-015**: System MUST show the failure reason under a failed source (for example "The PDF is a scan with no readable text. Upload a text version."). [UI:C-Knowledge]
- **FR-016**: System MUST show each source's details under its name (size and languages for files, crawl depth and re-crawl mode for websites, "Written by hand" for FAQs). [UI:C-Knowledge]
- **FR-017**: System MUST refuse a new file or crawl that would exceed the plan's knowledge storage, with the limit and an Upgrade link ([BIL-001](../../bil/001-plan-and-usage/spec.md)). [/6.3]
- **FR-018**: A disabled source MUST NOT be retrieved by any agent and its chunks MUST NOT count as searchable. [/6.3]

### Key Entities

- **Source**: name, type (File, Website, FAQ), status (Ready, Processing, Queued, Failed with reason, Disabled), chunks, updated, size, languages; Website adds URL, crawl depth, allowed domains, re-crawl mode; FAQ adds question and answer.

## Success Criteria

- **SC-001**: Every failed source shows its reason and a Retry action.

## Assumptions and Open Items

- Agents select sources per agent in [AGT-001](../../agt/001-agent-configuration/spec.md).
- Storage counts against the plan's knowledge storage meter ([BIL-001](../../bil/001-plan-and-usage/spec.md)).
- Failed sources appear in the notification bell ([PLT-008](../../platform/008-errors-notifications-search/spec.md)).
