/**
 * A connector tool's two names (D223).
 *
 * The platform names it `<connector>/<tool>`: in grants, tiers, approvals and the audit.
 * Model providers accept only letters, digits, `_` and `-` in a function name, so the
 * platform MCP server lists it as `<connector>__<tool>` and reads that name back on a call.
 * A connector code has no `_`, so the first `__` is always the separator. An MCP tool name may
 * also hold `.` (`claims.read`), which the provider refuses, so in the tool part `-` is written
 * `--` and `.` is written `-_`, and the name reads back exactly (D363). The agent service's
 * `model_tool_name` writes the same.
 */

const MODEL_NAME = /^([a-z0-9][a-z0-9-]*)__(.+)$/;

/** `erp/claims.read` → `erp__claims-_read`. */
export function modelToolName(name: string): string {
  const slash = name.indexOf("/");
  if (slash <= 0) return name;
  const tool = name.slice(slash + 1).replaceAll("-", "--").replaceAll(".", "-_");
  return `${name.slice(0, slash)}__${tool}`;
}

/** `erp__claims-_read` → `erp/claims.read`; any other name unchanged. */
export function platformToolName(name: string): string {
  const match = MODEL_NAME.exec(name);
  if (!match) return name;
  const tool = match[2].replace(/-([-_])/g, (_escape, kind: string) => (kind === "-" ? "-" : "."));
  return `${match[1]}/${tool}`;
}
