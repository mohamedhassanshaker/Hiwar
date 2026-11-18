# Feature Specification: Write-tool approval in the inbox

**Feature ID**: INB-003
**Module**: INB — Conversations inbox, takeover and handback
**Status**: Draft
**Sources**: `/6.2`, `/6.1`
**Screens**: C-Inbox, C-Widget
**Personas**: Owner, Admin, Support Agent, Visitor

## User Scenarios & Testing

### User Story 1 - Approve or reject a write-tool call (Priority: P1)

When the AI wants to run a write tool whose policy is "Require staff approval", the conversation waits for a person; the person who claims it sees the proposed call and approves or rejects it.

**Why this priority**: Write tools move money or send messages; the default policy requires approval, so P1 cannot run write tools without this flow.
**Independent Test**: In c2 the AI proposes `issue_refund` for AED 64; claim, approve; repeat and reject.

**Acceptance Scenarios**:

1. **AC-INB-003-01** — **Given** Layla's "Issue a refund" tool has the policy "Require staff approval", **When** the AI decides to call it, **Then** the tool does not run, the conversation becomes HANDOVER_PENDING with reason `tool_approval`, the version increases by 1, and "What the AI used" shows the call as "Write tool · needs human approval · not run" with its inputs.
2. **AC-INB-003-02** — **Given** the user claimed that conversation, **When** they choose Approve on the proposed call, **Then** the tool runs once with the shown inputs, the result is recorded in "What the AI used", the decision is recorded in the ownership history and audit log, and the user stays the owner.
3. **AC-INB-003-03** — **Given** the user owns the conversation, **When** they choose Reject and give a reason, **Then** the tool does not run, the call shows "rejected" with the reason, and the user continues the conversation.
4. **AC-INB-003-04** — **Given** the viewer does not own the conversation, **When** the proposed call renders, **Then** Approve and Reject are not available.
5. **AC-INB-003-05** — **Given** the approved call fails, **When** the result returns, **Then** "What the AI used" shows the failure and nothing is retried automatically.

### User Story 2 - Visitor confirms a write tool (Priority: P1)

When the policy is "Ask the visitor first", the widget asks the visitor to confirm before the tool runs.

**Why this priority**: The visitor must agree before an action is taken for them.
**Independent Test**: Set "Send transcript by email" to "Ask the visitor first" and trigger it.

**Acceptance Scenarios**:

1. **AC-INB-003-06** — **Given** the policy "Ask the visitor first", **When** the AI decides to call the tool, **Then** the widget shows what will be done with Confirm and Cancel, and the tool runs only after Confirm.
2. **AC-INB-003-07** — **Given** the visitor chooses Cancel or does not answer, **When** the AI continues, **Then** the tool does not run and the AI tells the visitor it was not done.

### Edge Cases

- Policy "Run automatically": the tool runs without approval; the call is still recorded in "What the AI used" and the audit log.
- A second write-tool call while one is waiting for approval is not proposed until the first is decided.
- A deployment's tool subset excludes the tool ([DEP-002](../../dep/002-appearance-behaviour-quotas/spec.md)): the AI cannot call it.

## Requirements

### Functional Requirements

- **FR-001**: System MUST NOT run a write tool with the policy "Require staff approval" until the conversation's owner approves it. [/6.2]
- **FR-002**: A write-tool call that needs approval MUST set the conversation to HANDOVER_PENDING with the reason `tool_approval` and increase the version by 1.
- **FR-003**: "What the AI used" MUST show a waiting call with the tool name, its inputs and Approve and Reject actions for the owner. [/6.1]
- **FR-004**: Approve MUST run the tool once with the shown inputs and record the result.
- **FR-005**: Reject MUST require a reason, MUST NOT run the tool and MUST record "rejected" with the reason.
- **FR-006**: Only the conversation's owner MUST be able to approve or reject, and only in roles allowed by [ORG-002](../../org/002-roles-and-permissions/spec.md).
- **FR-007**: Every approval, rejection and automatic write-tool run MUST be recorded in the ownership history and the audit log ([ORG-003](../../org/003-audit-log/spec.md)).
- **FR-008**: For the policy "Ask the visitor first", the widget MUST ask the visitor to confirm with Confirm and Cancel, and the tool MUST run only after Confirm. [/6.2]
- **FR-009**: A failed tool call MUST be shown with its failure and MUST NOT be retried automatically.
- **FR-010**: System MUST propose at most one write-tool call at a time per conversation.

### Key Entities

- **Tool call**: tool, type (Read or Write), inputs, policy, status (proposed, waiting for approval, waiting for visitor, approved, rejected, ran, failed), decided by, reason, duration, result.

## Success Criteria

- **SC-001**: No write tool with "Require staff approval" or "Ask the visitor first" runs without the matching approval or confirmation.

## Assumptions and Open Items

- Tool policies are set per tool in [AGT-001](../../agt/001-agent-configuration/spec.md).
- Two failed tool calls in a row escalate with `tool_failure` when that trigger is on ([AGT-001](../../agt/001-agent-configuration/spec.md)).
