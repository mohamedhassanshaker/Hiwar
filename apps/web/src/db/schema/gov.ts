import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, pgSchema, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  arrayIndex,
  audited,
  bilingualName,
  bilingualTitle,
  enumCheck,
  id,
  jsonObjectCheck,
  money,
  rowCheck,
  searchKey,
  trigramIndex,
  ts,
} from "./_conventions";
import { person } from "./core";
import { agent, route } from "./ai";
import {
  BRANDING_ASSET_KINDS,
  BUDGET_ACTIONS_AT_100,
  BUDGET_EVENT_TYPES,
  BUDGET_PERIODS,
  CLIENT_KEY_STATUSES,
  CLIENT_PERMISSIONS,
  CLIENT_STATUSES,
  CONNECTOR_AUTH_TYPES,
  FEATURE_FLAG_GROUPS,
  LOG_LEVELS,
  MAIL_NOTIFICATION_KINDS,
  MAIL_NOTIFICATION_STATUSES,
  OUTBOX_STATUSES,
} from "./enums";

/** Data model sections 18 to 20 — budgets, integrations and platform governance (section 17, setup, went with D375). */
export const gov = pgSchema("gov");

const ciphertext = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/* -------------------------------------- section 18: budgets and estimated costs */

export const agentBudget = gov.table(
  "agent_budget",
  {
    id: id(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    limitAed: money("limit_aed").notNull(),
    period: text("period").notNull().default("Monthly"),
    effectiveFrom: ts("effective_from").notNull(),
    effectiveTo: ts("effective_to"),
    warnAtPct: integer("warn_at_pct").notNull().default(80),
    actionAt100: text("action_at_100").notNull().default("NotifyOnly"),
    cheaperRouteId: uuid("cheaper_route_id").references(() => route.id),
    ...audited,
  },
  (t) => [
    index("agent_budget_agent_idx").on(t.agentId, t.effectiveFrom),
    enumCheck("agent_budget_period_check", t.period, BUDGET_PERIODS),
    enumCheck("agent_budget_action_check", t.actionAt100, BUDGET_ACTIONS_AT_100),
    rowCheck("agent_budget_warn_check", `"warn_at_pct" between 1 and 100`),
    rowCheck("agent_budget_window_check", `"effective_to" is null or "effective_to" > "effective_from"`),
    rowCheck(
      "agent_budget_cheaper_route_check",
      `"action_at_100" <> 'SwitchToCheaperAlias' or "cheaper_route_id" is not null`,
    ),
    // Section 23 rule 10: budget windows for one agent may not overlap. `btree_gist` is not
    // in the extension list, so the exclusion is enforced by the trigger in 02-integrity.sql.
  ],
);

export const budgetPeriod = gov.table(
  "budget_period",
  {
    id: id(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => agentBudget.id, { onDelete: "cascade" }),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    estimatedSpendAed: money("estimated_spend_aed").notNull().default(0),
    runs: integer("runs").notNull().default(0),
    ...audited,
  },
  (t) => [
    uniqueIndex("budget_period_key").on(t.budgetId, t.periodStart),
    rowCheck("budget_period_window_check", `"period_end" > "period_start"`),
  ],
);

export const budgetEvent = gov.table(
  "budget_event",
  {
    id: id(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => agentBudget.id, { onDelete: "cascade" }),
    periodId: uuid("period_id").references(() => budgetPeriod.id),
    type: text("type").notNull(),
    at: ts("at").notNull().defaultNow(),
    detailEn: text("detail_en"),
    detailAr: text("detail_ar"),
    ...audited,
  },
  (t) => [index("budget_event_budget_idx").on(t.budgetId, t.at), enumCheck("budget_event_type_check", t.type, BUDGET_EVENT_TYPES)],
);

export const budgetChange = gov.table(
  "budget_change",
  {
    id: id(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => agentBudget.id, { onDelete: "cascade" }),
    at: ts("at").notNull().defaultNow(),
    changedBy: uuid("changed_by").references(() => person.id),
    descriptionEn: text("description_en").notNull(),
    descriptionAr: text("description_ar").notNull(),
    ...audited,
  },
  (t) => [index("budget_change_budget_idx").on(t.budgetId, t.at)],
);

/* ----------------------------------------------------------- section 19: integrations */

export const integrationClient = gov.table(
  "integration_client",
  {
    id: id(),
    clientId: text("client_id").notNull(),
    ...bilingualName,
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    status: text("status").notNull().default("Active"),
    allAgents: boolean("all_agents").notNull().default(false),
    searchKey: searchKey("search_key", "name_en", "name_ar", "client_id"),
    ...audited,
  },
  (t) => [
    uniqueIndex("integration_client_key").on(t.clientId),
    trigramIndex("integration_client_search_idx", t.searchKey),
    enumCheck("integration_client_status_check", t.status, CLIENT_STATUSES),
  ],
);

/** Section 23 rule 8: only the hash and the visible prefix are stored. */
export const clientKey = gov.table(
  "client_key",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => integrationClient.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: ciphertext("secret_hash").notNull(),
    expiresAt: ts("expires_at"),
    lastUsedAt: ts("last_used_at"),
    status: text("status").notNull().default("Active"),
    ...audited,
  },
  (t) => [
    uniqueIndex("client_key_prefix_key").on(t.prefix),
    index("client_key_client_idx").on(t.clientId),
    enumCheck("client_key_status_check", t.status, CLIENT_KEY_STATUSES),
  ],
);

export const clientPermission = gov.table(
  "client_permission",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => integrationClient.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.permission], name: "client_permission_pk" }),
    enumCheck("client_permission_check", t.permission, CLIENT_PERMISSIONS),
  ],
);

export const clientAgent = gov.table(
  "client_agent",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => integrationClient.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.clientId, t.agentId], name: "client_agent_pk" })],
);

export const clientMcpExposure = gov.table(
  "client_mcp_exposure",
  {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => integrationClient.id, { onDelete: "cascade" }),
    isEnabled: boolean("is_enabled").notNull().default(false),
    authType: text("auth_type").notNull().default("ApiKey"),
    exposedTools: text("exposed_tools").array().notNull().default(sql`'{}'::text[]`),
    lastTestAt: ts("last_test_at"),
    lastTestResult: text("last_test_result"),
    ...audited,
  },
  (t) => [
    arrayIndex("client_mcp_exposure_tools_idx", t.exposedTools),
    enumCheck("client_mcp_exposure_auth_check", t.authType, CONNECTOR_AUTH_TYPES),
  ],
);

export const clientAguiExposure = gov.table(
  "client_agui_exposure",
  {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => integrationClient.id, { onDelete: "cascade" }),
    isEnabled: boolean("is_enabled").notNull().default(false),
    allowedEvents: text("allowed_events").array().notNull().default(sql`'{}'::text[]`),
    allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
    ...audited,
  },
  (t) => [arrayIndex("client_agui_exposure_origins_idx", t.allowedOrigins)],
);

/* ---------------------------------- section 20: governance and platform settings */

export const settingsVersion = gov.table(
  "settings_version",
  {
    id: id(),
    versionNumber: integer("version_number").notNull(),
    settingsJson: jsonb("settings_json").notNull().$type<Record<string, unknown>>(),
    changedBy: uuid("changed_by").references(() => person.id),
    changedAt: ts("changed_at").notNull().defaultNow(),
    ...audited,
  },
  (t) => [uniqueIndex("settings_version_key").on(t.versionNumber), jsonObjectCheck("settings_version_json_check", t.settingsJson)],
);

export const brandingAsset = gov.table(
  "branding_asset",
  {
    id: id(),
    kind: text("kind").notNull(),
    contentRef: text("content_ref").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => person.id),
    ...audited,
  },
  (t) => [uniqueIndex("branding_asset_kind_key").on(t.kind), enumCheck("branding_asset_kind_check", t.kind, BRANDING_ASSET_KINDS)],
);

export const featureFlag = gov.table(
  "feature_flag",
  {
    id: id(),
    key: text("key").notNull(),
    ...bilingualName,
    group: text("group").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(false),
    ...audited,
  },
  (t) => [uniqueIndex("feature_flag_key_key").on(t.key), enumCheck("feature_flag_group_check", t.group, FEATURE_FLAG_GROUPS)],
);

export const systemState = gov.table(
  "system_state",
  {
    id: id(),
    agentsPaused: boolean("agents_paused").notNull().default(false),
    pausedBy: uuid("paused_by").references(() => person.id),
    pausedAt: ts("paused_at"),
    ...audited,
  },
  // One row: System → Pause all agents flips it.
  () => [uniqueIndex("system_state_singleton").on(sql`(true)`)],
);

export const docPage = gov.table(
  "doc_page",
  {
    id: id(),
    slug: text("slug").notNull(),
    ...bilingualTitle,
    bodyEn: text("body_en").notNull(),
    bodyAr: text("body_ar").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    searchKey: searchKey("search_key", "title_en", "title_ar", "slug"),
    ...audited,
  },
  (t) => [uniqueIndex("doc_page_slug_key").on(t.slug), trigramIndex("doc_page_search_idx", t.searchKey)],
);

/**
 * The Logs screen (S-74). Stack specification SD-4 allows a PostgreSQL table instead of a
 * log store for the smallest installs, and section 8.4 defines no log-store workload.
 */
export const logEntry = gov.table(
  "log_entry",
  {
    id: id(),
    at: ts("at").notNull().defaultNow(),
    level: text("level").notNull(),
    service: text("service").notNull(),
    message: text("message").notNull(),
    contextJson: jsonb("context_json").$type<Record<string, unknown>>(),
    correlationId: text("correlation_id"),
    ...audited,
  },
  (t) => [
    index("log_entry_at_idx").on(t.at),
    index("log_entry_service_idx").on(t.service, t.at),
    enumCheck("log_entry_level_check", t.level, LOG_LEVELS),
    jsonObjectCheck("log_entry_context_check", t.contextJson),
  ],
);

/**
 * The outbox of requirement 36: a domain event is written in the same transaction as the
 * row it describes, and the relay moves it to Temporal or Redis afterwards, so a workflow
 * start or a room fan-out is never lost when the request fails after the commit.
 */
export const outboxEvent = gov.table(
  "outbox_event",
  {
    id: id(),
    topic: text("topic").notNull(),
    payloadJson: jsonb("payload_json").notNull().$type<Record<string, unknown>>(),
    status: text("status").notNull().default("Pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    availableAt: ts("available_at").notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
    ...audited,
  },
  (t) => [
    index("outbox_event_pending_idx")
      .on(t.availableAt)
      .where(sql`${t.status} = 'Pending'`),
    enumCheck("outbox_event_status_check", t.status, OUTBOX_STATUSES),
    jsonObjectCheck("outbox_event_payload_check", t.payloadJson),
  ],
);

/**
 * D240: one system email to one person about one finished request or work item. The key
 * names the event and the person, so a retried event writes nothing twice; the row is the
 * durable record the Valkey stream only points at.
 */
export const mailNotification = gov.table(
  "mail_notification",
  {
    id: id(),
    notificationKey: text("notification_key").notNull(),
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    personId: uuid("person_id").references(() => person.id, { onDelete: "set null" }),
    recipient: text("recipient"),
    outcome: text("outcome").notNull(),
    status: text("status").notNull().default("Queued"),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
    /** An agent's email (D242): the message itself, and the run that wrote it. */
    mailSubject: text("mail_subject"),
    mailBody: text("mail_body"),
    runId: uuid("run_id"),
    ...audited,
  },
  (t) => [
    uniqueIndex("mail_notification_key").on(t.notificationKey),
    index("mail_notification_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('Queued', 'Sending')`),
    index("mail_notification_recent_idx").on(t.createdAt),
    enumCheck("mail_notification_kind_check", t.kind, MAIL_NOTIFICATION_KINDS),
    enumCheck("mail_notification_status_check", t.status, MAIL_NOTIFICATION_STATUSES),
  ],
)

