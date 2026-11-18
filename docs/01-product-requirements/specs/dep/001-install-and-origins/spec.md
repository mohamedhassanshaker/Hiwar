# Feature Specification: Deployment install, keys, origins and go-live

**Feature ID**: DEP-001
**Module**: DEP — Deployments and the visitor widget
**Status**: Draft
**Sources**: `/6.4`
**Screens**: C-Deployments
**Personas**: Owner, Admin, Builder

## User Scenarios & Testing

### User Story 1 - Create a deployment and install the widget (Priority: P1)

A builder creates a deployment for an agent, copies the install snippet (or sends it to a developer), lists and verifies the allowed origins, and makes the deployment live.

**Why this priority**: Without a live deployment no visitor reaches the agent.
**Independent Test**: Create a deployment for Layla and take it through install, origin verification and Make live.

**Acceptance Scenarios**:

1. **AC-DEP-001-01** — **Given** C-Deployments, **When** the user chooses New deployment and enters a name and an agent, **Then** a deployment is created as Draft with a public key `pk_dep_…` and appears in the list with its status and agent.
2. **AC-DEP-001-02** — **Given** a deployment, **When** the user opens Install, **Then** the one-line snippet with the public key is shown with Copy, Send to developer, Verify domain and Rotate key; Copy puts the snippet on the clipboard and a toast confirms it.
3. **AC-DEP-001-03** — **Given** Install, **When** the user chooses Send to developer, enters an email address and sends, **Then** the snippet and install steps are emailed and a toast confirms it.
4. **AC-DEP-001-04** — **Given** the origin `https://gulfbites.ae` is listed and its page contains the snippet with this key, **When** the user chooses Verify domain, **Then** the origin shows as verified; **Given** the snippet is missing, **Then** it stays unverified with the reason "Snippet not found on the page".
5. **AC-DEP-001-05** — **Given** a draft deployment with no verified origin, **When** the user chooses Make live, **Then** it stays Draft and the screen says an origin must be verified first.
6. **AC-DEP-001-06** — **Given** a draft deployment with a verified origin, **When** the user chooses Make live, **Then** its status becomes Live and the widget loads on that origin.
7. **AC-DEP-001-07** — **Given** a live deployment, **When** the widget is requested from an origin that is not listed, **Then** it does not load.

### User Story 2 - Rotate the public key (Priority: P2)

A builder rotates the key; the old key keeps working for a grace period.

**Why this priority**: Key rotation must not break a live site.
**Independent Test**: Rotate the key on Order site · Dubai.

**Acceptance Scenarios**:

1. **AC-DEP-001-08** — **Given** a live deployment, **When** the user chooses Rotate key and confirms, **Then** a new key is issued, the snippet shows it, the old key keeps working for a 7-day grace period and then stops, and the audit log records "Rotated the key" with "old key valid for 7 days".

### User Story 3 - Pause a deployment (Priority: P2)

A builder pauses a deployment; the widget then shows the offline message.

**Why this priority**: Lets a business stop the AI on a site without removing the snippet.
**Independent Test**: Pause a live deployment and load the widget.

**Acceptance Scenarios**:

1. **AC-DEP-001-09** — **Given** a live deployment, **When** the user chooses Pause, **Then** the status becomes Paused and the widget shows the offline message; Make live returns it to Live.

### Edge Cases

- The widget loads only on listed origins; any other origin does not load it.
- Removing the last verified origin of a live deployment asks for confirmation and pauses the deployment.
- Conversations already open when a deployment is paused stay in the inbox and can still be handled by staff.

## Requirements

### Functional Requirements

- **FR-001**: C-Deployments MUST show the deployment list (with status and agent) at left and the tabs at right. [/6.4]
- **FR-002**: Deployment status MUST be one of Live, Paused, Draft. [/6.4]
- **FR-003**: The Install tab MUST show the snippet with the public key (`pk_dep_…`), Copy, Send to developer (mail dialog), Verify domain and Rotate key. [/6.4]
- **FR-004**: After Rotate key, the old key MUST keep working for a 7-day grace period. [/6.4]
- **FR-005**: The Allowed origins tab MUST list domains with their verified state and MUST let users add and remove domains. [/6.4]
- **FR-006**: The widget MUST load only on listed origins. [/6.4]
- **FR-007**: The header MUST offer Pause (the widget shows the offline message) and Make live. [/6.4]
- **FR-008**: A draft deployment MUST NOT go live until an origin is verified. [/6.4]
- **FR-009**: Users MUST be able to create a deployment with New deployment, giving a name and an agent; it starts as Draft with a new public key.
- **FR-010**: Verify domain MUST fetch the origin's page and mark the origin verified when it contains the snippet with this deployment's key; otherwise it MUST show the reason.
- **FR-011**: Rotate key MUST ask for confirmation and MUST be recorded in the audit log. [/6.4]
- **FR-012**: Removing the last verified origin of a live deployment MUST ask for confirmation and MUST pause the deployment. [/6.4]

### Key Entities

- **Deployment**: name, agent, status (Live, Paused, Draft), public key (`pk_dep_…`), previous key and its expiry, allowed origins (domain, verified, verified at, reason).

## Success Criteria

- **SC-001**: No deployment is Live without at least one verified origin.

## Assumptions and Open Items

- Sample deployments: Order site · Dubai (live), Catering page (live, pinned to v3), Arabic landing page (draft).
- Key rotation is recorded in the audit log, for example "Key rotated for Order site" ([ORG-003](../../org/003-audit-log/spec.md)).
- The C-Deployments board is listed in the design canvas but missing from the handoff zip; these requirements come from the UI spec and this review; the screen gets a design review once implemented.
