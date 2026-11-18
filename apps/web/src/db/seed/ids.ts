import { createHash } from "node:crypto";

/**
 * The seed needs the same row to get the same primary key every time it runs, so a
 * reference written in one module resolves in another and re-running the seed leaves the
 * same row counts. Every id is a UUIDv5 of `<kind>:<natural key>` under one namespace.
 *
 * Production rows get a UUIDv7 from PostgreSQL; only seeded rows are derived this way.
 */
const NAMESPACE = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";

function namespaceBytes(): Buffer {
  return Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
}

/** The UUIDv5 of `<kind>:<key>` under `NAMESPACE`. */
export function seedId(kind: string, key: string): string {
  const hash = createHash("sha1").update(namespaceBytes()).update(`${kind}:${key}`, "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // Set the version nibble to 5 and the variant bits to RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The identifiers the demo organisation is built around, named once. */
export const ids = {
  organisation: seedId("organisation", "tahseel"),
  workingCalendar: seedId("calendar", "uae-working-week"),
  holidayCalendar: seedId("calendar", "uae-holidays"),
  person: (code: string) => seedId("person", code),
  orgUnit: (code: string) => seedId("org-unit", code),
  role: (code: string) => seedId("role", code),
  permission: (code: string) => seedId("permission", code),
  roleAssignment: (key: string) => seedId("role-assignment", key),
  group: (code: string) => seedId("group", code),
  externalContact: (code: string) => seedId("external-contact", code),
  project: (key: string) => seedId("project", key),
  room: (key: string) => seedId("room", key),
  roomMessage: (key: string) => seedId("room-message", key),
  requestType: (code: string) => seedId("request-type", code),
  requestTypeVersion: (key: string) => seedId("request-type-version", key),
  attributeDefinition: (key: string) => seedId("attribute-definition", key),
  transitionStep: (key: string) => seedId("transition-step", key),
  stepAudience: (key: string) => seedId("step-audience", key),
  routingRule: (key: string) => seedId("routing-rule", key),
  request: (key: string) => seedId("request", key),
  requestEvent: (key: string) => seedId("request-event", key),
  workItem: (key: string) => seedId("work-item", key),
  workItemActivity: (key: string) => seedId("work-item-activity", key),
  schedule: (key: string) => seedId("schedule", key),
  artifact: (key: string) => seedId("artifact", key),
  artifactVersion: (key: string) => seedId("artifact-version", key),
  projectFile: (key: string) => seedId("project-file", key),
  attachment: (key: string) => seedId("attachment", key),
  agent: (code: string) => seedId("agent", code),
  agentVersion: (key: string) => seedId("agent-version", key),
  route: (alias: string) => seedId("route", alias),
  routeStep: (key: string) => seedId("route-step", key),
  modelProvider: (code: string) => seedId("model-provider", code),
  providerConnection: (code: string) => seedId("provider-connection", code),
  allowedModel: (key: string) => seedId("allowed-model", key),
  skill: (name: string) => seedId("skill", name),
  skillVersion: (key: string) => seedId("skill-version", key),
  connector: (code: string) => seedId("connector", code),
  connectorTool: (key: string) => seedId("connector-tool", key),
  catalogEntry: (code: string) => seedId("catalog-entry", code),
  memoryScope: (key: string) => seedId("memory-scope", key),
  memory: (key: string) => seedId("memory", key),
  memoryVersion: (key: string) => seedId("memory-version", key),
  memoryEntry: (key: string) => seedId("memory-entry", key),
  collection: (code: string) => seedId("collection", code),
  knowledgeSource: (key: string) => seedId("knowledge-source", key),
  run: (key: string) => seedId("run", key),
  runStep: (key: string) => seedId("run-step", key),
  approval: (key: string) => seedId("approval", key),
  agentQuestion: (key: string) => seedId("agent-question", key),
  inboxItem: (key: string) => seedId("inbox-item", key),
  deployment: (code: string) => seedId("deployment", code),
  channel: (type: string) => seedId("channel", type),
  storyline: (code: string) => seedId("storyline", code),
  storylineVersion: (key: string) => seedId("storyline-version", key),
  storylineStep: (key: string) => seedId("storyline-step", key),
  budget: (code: string) => seedId("budget", code),
  budgetPeriod: (key: string) => seedId("budget-period", key),
  client: (code: string) => seedId("client", code),
  clientKey: (key: string) => seedId("client-key", key),
  featureFlag: (key: string) => seedId("feature-flag", key),
  docPage: (slug: string) => seedId("doc-page", slug),
  logEntry: (key: string) => seedId("log-entry", key),
  settingsVersion: (key: string) => seedId("settings-version", key),
  systemState: seedId("system-state", "singleton"),
  auditEntry: (key: string) => seedId("audit-entry", key),
};
