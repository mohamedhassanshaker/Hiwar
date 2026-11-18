# `packages/contracts`

The JSON Schemas (draft 2020-12) that describe what the two runtimes exchange. No runtime code loads
these files today: `services/agent/tests/mission/test_bundled_packages.py` checks that the three schemas
exist, compile, and accept and reject sample values, and the code that implements each contract
names its schema in a comment.

| Schema | What it describes | Implemented in |
| --- | --- | --- |
| `schemas/attribute-definition.schema.json` | A dynamic attribute of a request type version or a work item type. The definitions of a published version compile into the JSON Schema that validates `AttributesJson`. | `apps/web/src/features/requests/`, `apps/web/src/features/work-items/` (Ajv) |
| `schemas/agui-custom-events.schema.json` | The `CUSTOM` AG-UI events this platform adds on top of the protocol: tool confirmations, tool approvals, agent questions, context composition, budget warnings and the context handoff. | `apps/web/src/agents/middleware.ts` |
| `schemas/platform-mcp-tools.schema.json` | The shape of a tool in the catalogue the platform MCP server offers an agent, with the tier and the permission each tool is checked against. Its example uses the permission `work-items.read`; the code's format is `work_items:read`. | `apps/web/src/mcp/tools.ts` |

## Rules

- **A key, a tool name and an event name are permanent.** They appear in stored data, in run
  histories and in the console; renaming one is a migration, not an edit.
- **A tier may be raised, never lowered.** A project policy or an agent's trust level can make a
  T1 tool a T2 tool; nothing makes a T2 tool a T0 tool.
- **Every money value is an estimate**, written as `numeric(18,4)` and labelled as an estimate
  wherever it is shown.
- **No secret is ever a field in these schemas.** A connector secret, a channel token and a
  provider key are stored encrypted and are never returned by an API.
