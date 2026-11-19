/**
 * The permission matrix of ORG-002 (FR-001 and FR-003). Checked on the server for every
 * request; the UI hides what a role cannot use from the same table.
 */
export type Role = "owner" | "admin" | "builder" | "support_agent" | "analyst" | "billing";

export type Capability =
  | "manage_agents"
  | "manage_deployments"
  | "conversations"
  | "take_over"
  | "analytics"
  | "billing"
  | "team"
  | "audit"
  | "supervisor_takeover"
  | "approve_tools"
  | "export_analytics"
  | "export_audit";

const MATRIX: Record<Capability, Role[]> = {
  manage_agents: ["owner", "admin", "builder"],
  manage_deployments: ["owner", "admin", "builder"],
  conversations: ["owner", "admin", "support_agent"],
  take_over: ["owner", "admin", "support_agent"],
  analytics: ["owner", "admin", "builder", "support_agent", "analyst"],
  billing: ["owner", "billing"],
  team: ["owner", "admin"],
  audit: ["owner", "admin"],
  supervisor_takeover: ["owner", "admin"],
  approve_tools: ["owner", "admin", "support_agent"],
  export_analytics: ["owner", "admin", "analyst"],
  export_audit: ["owner", "admin"],
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}

/** Support Agents see analytics without cost figures or export (ANA-001 FR-016). */
export function analyticsLimited(role: Role): boolean {
  return role === "support_agent";
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  builder: "Builder",
  support_agent: "Support Agent",
  analyst: "Analyst",
  billing: "Billing",
};

/** Raised when the caller's role lacks a capability; route handlers answer 403. */
export class Forbidden extends Error {
  constructor(capability: string) {
    super(`Not allowed: ${capability}`);
    this.name = "Forbidden";
  }
}
