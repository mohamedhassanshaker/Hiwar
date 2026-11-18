# Tahseel AWP — Agentic Work Platform

A single-tenant platform where people and AI agents work under the same permissions, approvals and
audit. The documentation starts at **[docs/README.md](docs/README.md)**, which indexes every
document and gives a reading path for developers, architects, analysts, stakeholders and operators.

## Where things are

| Path | Holds |
| --- | --- |
| `apps/web` | Next.js full stack: console, domain logic, CopilotKit runtime, platform MCP server, channel gateway |
| `services/agent` | Python agent service: AG-UI endpoints, the generic agent runtime, Temporal workers, knowledge ingestion |
| `services/connectors`, `services/sandbox`, `services/modelstub` | Connector runtime, sandbox manager, deterministic local model engine |
| `packages/contracts`, `packages/skills-bundled` | JSON Schemas shared by both runtimes; the bundled Agent Skills |
| `infra/` | kind cluster, platform charts, the AWP chart, gateway, network policies, PostgreSQL SQL |
| `docs/` | The documentation: [docs/README.md](docs/README.md) |

## Getting started

[docs/12-user-and-developer-guides/local-platform.md](docs/12-user-and-developer-guides/local-platform.md) takes a clean machine to a seeded, running console. In
short, with Docker, kind, kubectl, Helm, helmfile, Node.js and `uv` installed:

```bash
cp .env.example .env            # then fill in the secrets
make kind-up                    # cluster, operators, platform charts
make deploy                     # build images, install the AWP chart
make seed                       # the organisation a fresh install starts with
```

The console is then at `https://awp.localtest.me:8443`.

## Verification

```bash
make verify                     # lint, types, unit and database suites, build, agent gates; CI calls the same script
make test-e2e                   # Playwright against the kind deployment, English and Arabic
```

[docs/12-user-and-developer-guides/conventions.md](docs/12-user-and-developer-guides/conventions.md) describes the testing
strategy.

## Licences

[versions.lock.md](versions.lock.md) lists every image and major package with its version, digest and
licence, including the components that need sign-off before an installation outside a developer
machine.
