# Feature Specification: AI capabilities from the reference module

**Feature ID**: PLT-010
**Module**: PLATFORM — Cross-cutting rules
**Status**: Draft
**Sources**: `/1.1`
**Screens**: O-Agents, O-Skills, O-Connectors, O-Memory, O-Knowledge, O-Models, O-AI, O-Convos, O-Runs (implemented from the module, not the boards)
**Personas**: Platform admin, Support operator

## User Scenarios & Testing

### User Story 1 - Configure the platform's agents and what they may use (Priority: P1)

A Platform admin designs agents, their versions, skills, tools, knowledge, memory and model routes, and publishes them, in the operator portal.

**Why this priority**: The AI capabilities are the platform's engine; the owner supplied a complete reference implementation (`docs/00-input-requirements/ai-capabilities-module.zip`).
**Independent Test**: Open every screen under AI capabilities in the operator portal and create an agent, a knowledge collection and a route.

**Acceptance Scenarios**:

- **AC-PLT-010-01** — **Given** a Platform admin signed in with 2-step sign-in, **When** they open Agents, Skills, Connectors, Memory, Knowledge, Models and routes, Channels, Embedded deployment, Conversations, Runs, Approvals, Budgets, Integrations or System, **Then** each screen shows the module's functions as its module document specifies, on Hiwar's design.
- **AC-PLT-010-02** — **Given** a Support operator, **When** they open the same screens, **Then** they can read and test retrieval but every change is refused and audited.
- **AC-PLT-010-03** — **Given** a customer account, **When** it opens `/ops/ai`, **Then** it is sent away from the operator portal.

### User Story 2 - Run agents safely (Priority: P1)

Agent runs act with the permissions of the person they run for, ask a person before a T2 or T3 action, and stop when the kill switch is on.

**Why this priority**: Runs change data and call outside systems.
**Independent Test**: Start a run on the cluster, approve a waiting tool call in Approvals, and pause all agents from System.

**Acceptance Scenarios**:

- **AC-PLT-010-04** — **Given** a run that reaches a T2 or T3 tool, **When** it pauses, **Then** the approval appears in Approvals for Platform admins other than the person the run acts for, and approving resumes the run.
- **AC-PLT-010-05** — **Given** System, **When** a Platform admin pauses all agents, **Then** no new run starts and every agent shows Paused until resumed.

## Requirements

### Functional Requirements

- **FR-001**: The AI capabilities MUST implement the screens, business rules and acceptance of the module documents for agents and runs, skills, connectors, memory, knowledge, models and routes, engage (channels, embedded deployment, conversations), budgets, integrations and the System screen, as given in the reference module.
- **FR-002**: The AI capabilities MUST be reachable only by Hiwar staff accounts with a platform role and 2-step sign-in, under `/ops/ai` in the operator portal.
- **FR-003**: A Platform admin MUST hold every AI permission; a Support operator MUST hold the read permissions and retrieval testing only.
- **FR-004**: An approval MUST be decided by a Platform admin other than the person the run acts for.
- **FR-005**: Agents MUST change platform data only through the platform MCP server, with the permission checks of the person the run acts for.
- **FR-006**: Model and tool egress MUST go through agentgateway; no application workload MUST hold a provider key.
- **FR-007**: The module's TAWP work-domain functions (projects, discussion rooms, requests, work items, files, schedules, org-unit administration) MUST NOT be offered; a conversation that needs a person MUST be handed over in Hiwar's inbox instead of a discussion room.

### Key Entities

- **Platform agent, version, run, approval, skill, connector, memory, knowledge collection, model provider, route, channel, embedded deployment, budget, integration client**: as defined in the module's data model (schemas `ai` and `gov`).

## Success Criteria

- **SC-001**: Every AI capabilities screen renders with no console error, and the module's screen and service tests pass in this repository.

## Assumptions and Open Items

- The module documents are in `ai-capabilities-module.zip` under `core/docs/02-product-requirements/modules/`; this spec does not restate them.
- The boards O-Agents to O-Runs in the design handoff describe an earlier product; the owner directed that the reference module replaces them.
- Handing a module conversation over to Hiwar's inbox is not built yet: the module's room hand-off is refused with a message ([architecture overview](../../../../02-architecture/overview.md)).
- [NEEDS CLARIFICATION: the owner's tech stack names MySQL; the module and Hiwar run on PostgreSQL 18 (OQ-01)]
