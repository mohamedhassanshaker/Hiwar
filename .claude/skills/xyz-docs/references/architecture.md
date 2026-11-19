# Architecture documents (02 to 06)

Work as the project's senior architect. The architecture states how the system meets every feature spec and every technical source, which choices were made and why, and what remains open. A reader can find, for any feature, the components, interfaces, data and controls that realise it.

## Inputs

Read all of these before writing. When one is unavailable, say which and what the document leaves unverified.

| Input | Read for |
| --- | --- |
| Feature specs, `non-functional.md`, `open-questions.md` | What the system must do and the quality targets |
| `technical` sources (`coverage.py index --kind technical`) | Mandated stack, environments, platform, delivery and policy constraints |
| Reference code archives in `00-input-requirements` | Components, contracts and patterns to reuse or adapt |
| Source code, manifests, lock files, infrastructure, CI | What exists today: services, routes, schemas, migrations, charts, versions |
| Official documentation of each framework and service at the version in use | Native primitives to use instead of bespoke code; limits and failure modes |
| A running deployment and its logs, when available | Behaviour the code alone does not show |

The documents describe the intended design. Where the code differs, state the difference against the requirement or decision it breaks; do not describe the code's current shape as the design. A document that states facts about code carries `Last verified against code: <YYYY-MM-DD>`.

## Documents

| Area | Document | Contents |
| --- | --- | --- |
| 02 | `overview.md` | System context (users, external systems) and container view as Mermaid diagrams; responsibility of each container; data ownership per store; tenancy and identity in one paragraph each; environments |
| 02 | `tech-stack.md` | Each component of the technical sources: target, what is in place, version, and for every deviation the ADR or open question that covers it. Claims the technical sections in front matter |
| 02 | `solution-design.md` | Module map: each spec module and Feature ID to its components and code location. Sequence diagrams for the critical flows of P1 features. State machines from the specs with the component that enforces each transition. Cross-cutting design: concurrency and consistency, background work and scheduling, live updates, caching, error handling and retries, observability, health, configuration. Each quality target of `non-functional.md` with the mechanism that meets it |
| 03 | `NNNN-slug.md` (ADR) | One architecture choice: context, options considered, decision, consequences, status, the specs and technical sections it affects |
| 03 | `decision-log.md` | Product and owner decisions, dated, with the reason and the specs they change; append-only |
| 04 | `platform-api.md` | Every interface the system offers (routes, server actions, events, webhooks, MCP tools, internal service calls): caller, authentication, request and response contract, errors, idempotency, rate or quota limits, Feature IDs |
| 04 | `external-systems.md` | Every external system: purpose, protocol, authentication, data exchanged, failure handling and timeouts, local stand-in, configuration keys, Feature IDs |
| 05 | `data-model.md` | Entity relationship diagram per domain (in `erd/` when large); invariants and where each is enforced (constraint, trigger, guarded update, code); tenancy columns and isolation mechanism; retention and deletion |
| 05 | `data-dictionary.md` (and `data-dictionary/<domain>.md`) | Per table: columns, type, nullability, meaning, the FR or rule that requires it; JSON column shapes |
| 06 | `security.md` | Assets, trust boundaries (diagram), threats per boundary with the control, its code location and its test; secrets handling; personal data; known gaps with their open question or blocker |
| 06 | `tenancy-and-roles.md` | Identity model, tenant isolation mechanism, the role matrix by reference to its spec, platform and support roles, how authorization is enforced and tested |

A project may add documents (for example an AI runtime or agent design in 02). Each document has one topic and is linked from the area's other documents where they rely on it.

## Rules

1. **Trace.** Every Feature ID is cited in at least one document of `architecture_dirs`, normally the module map of `solution-design.md`, and again wherever a flow, interface, table or control serves it. `coverage.py trace` checks the first part.
2. **Technical coverage.** Every section of a `technical` source is claimed by the document that answers it: `sources: [tech:/environments, tech:/platform]` in the front matter. Every value, version and limit in that section appears in the claiming document. `coverage.py verify` checks claims and values.
3. **Decide with evidence.** Choose from the technical sources first, then the native primitives of the mandated frameworks and services, then reference code. A choice the sources do not dictate is an ADR with the options considered. A deviation from a technical source is an ADR when the architect can justify it, otherwise an open question for the owner; never a silent change.
4. **No invention.** Do not add services, stores, queues or controls that no feature, quality target or technical source needs. Name the requirement each component serves.
5. **One place per fact.** The role matrix lives in its spec, column definitions in the schema or dictionary, versions in the version lock. Architecture documents link to them.
6. **Diagrams as text.** Mermaid for context, containers, sequences, states and ERDs. Each diagram uses the component and entity names of the text.
7. **Failure modes.** Every flow and external call states what happens on timeout, duplicate delivery, concurrent change and partial failure, using the specs' rules where they define the outcome.
8. **Security by boundary.** Each trust boundary (browser, embedded widget, public API, service to service, model and tool egress, database, operator access) lists its authentication, authorization, input handling and audit.

## Procedure

1. `coverage.py index --kind technical` and read every technical section; list the Feature IDs (`specs/README.md`); read the code layout, manifests, infrastructure and CI.
2. Write or update `overview.md` and `tech-stack.md`; record each deviation as an ADR or an open question.
3. Write `solution-design.md`: the module map first (every Feature ID), then flows, state machines, cross-cutting design and the non-functional mechanisms.
4. Write 04, 05 and 06 from the module map and the code; cite Feature IDs on each interface, table group and control.
5. Run `coverage.py verify`, `coverage.py trace` and `docs_structure.py check` until each prints `0 problems`.
6. Report the ADRs written, the open questions raised and any input that was unavailable.
