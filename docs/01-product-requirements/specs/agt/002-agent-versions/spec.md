# Feature Specification: Agent versions, publish and roll back

**Feature ID**: AGT-002
**Module**: AGT — Agents: configuration, testing, versions
**Status**: Draft
**Sources**: `/6.2`
**Screens**: C-Agents
**Personas**: Owner, Admin, Builder

## User Scenarios & Testing

### User Story 1 - Publish a new version (Priority: P1)

A builder publishes the draft as the next live version.

**Why this priority**: Visitors only meet live versions.
**Independent Test**: Edit Layla (v7 live) and publish.

**Acceptance Scenarios**:

1. **AC-AGT-002-01** — **Given** Layla is live at v7 with draft edits, **When** the user chooses Publish v8, **Then** v8 becomes live, the toast "Version 8 of Layla is live. Deployments that follow the latest version now use it." shows, the header shows "Up to date", and the audit log records "Published version 8".
2. **AC-AGT-002-02** — **Given** Order site follows the latest version and Catering page is pinned to v3, **When** a new version is published, **Then** new conversations on Order site use the new version and Catering page keeps v3.
3. **AC-AGT-002-03** — **Given** a conversation is in progress when a new version is published, **When** the visitor sends the next message, **Then** the AI answers with the version that started the conversation.
4. **AC-AGT-002-04** — **Given** Rana has never been published, **When** the Versions tab renders, **Then** it lists only the Draft and Publish reads Publish v1.

### User Story 2 - Roll back to an earlier version (Priority: P2)

A builder makes an earlier version live again after confirming.

**Why this priority**: Recovers from a bad publish.
**Independent Test**: Open Versions on Layla and roll back to v6.

**Acceptance Scenarios**:

1. **AC-AGT-002-05** — **Given** the Versions tab lists Draft, Live (v7, "Published 12 Nov by Noura Al Suwaidi") and earlier versions with "Roll back to this", **When** the user chooses Roll back to this on v6, **Then** a confirmation dialog names v6 and the deployments that follow the latest version.
2. **AC-AGT-002-06** — **Given** the roll-back dialog, **When** the user confirms, **Then** v6 becomes live, the toast "Rolled back. Version 6 is live again for deployments that follow the latest version." shows, and the audit log records the roll back.
3. **AC-AGT-002-07** — **Given** the roll-back dialog, **When** the user cancels, **Then** the live version does not change.

### Edge Cases

- A deployment pinned to a version keeps that version after a publish or roll back (for example Catering page pinned to v3, see [DEP-002](../../dep/002-appearance-behaviour-quotas/spec.md)).
- Roll back does not discard the draft.

## Requirements

### Functional Requirements

- **FR-001**: The Versions tab MUST list the Draft, the Live version and earlier versions, each earlier version with Roll back. [/6.2]
- **FR-002**: Publish MUST be labelled Publish v{next} and MUST create a new live version. [/6.2]
- **FR-003**: Roll back MUST ask for confirmation in a dialog naming the version and MUST make the earlier version the new live version. [/6.2]
- **FR-004**: System MUST make a published version live for every deployment that follows the latest version, keep pinned deployments on their version, and confirm "Version {n} of {name} is live. Deployments that follow the latest version now use it." [UI:C-Agents]
- **FR-005**: System MUST label roll back "Roll back to this" and, after confirmation, confirm "Rolled back. Version {n} is live again for deployments that follow the latest version." [UI:C-Agents]
- **FR-006**: System MUST show who published each version and when (for example "Published 12 Nov by Noura Al Suwaidi"). [UI:C-Agents]
- **FR-007**: A conversation MUST keep the agent version it started with until it closes. [/6.2]
- **FR-008**: Published versions MUST NOT be editable; editing always changes the draft. [/6.2]

### Key Entities

- **Agent version**: number (`v7`, shown in monospace), state (Draft, Live, earlier), configuration snapshot, published by, published at.

## Success Criteria

- **SC-001**: After publish or roll back, exactly one version of the agent is live.

## Assumptions and Open Items

- Publishing is recorded in the audit log, for example "Noura published Layla v7" ([ORG-003](../../org/003-audit-log/spec.md)).
- FR-007 and FR-008 are set by this review so that a publish never changes a conversation mid-way.
