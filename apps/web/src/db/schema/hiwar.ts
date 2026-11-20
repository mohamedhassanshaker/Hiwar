/**
 * The Hiwar data model. Every domain table carries `org_id`; data access in `src/server`
 * always takes it from the caller's session or the widget's deployment, never from input.
 * Schema `kb` holds knowledge chunks written by the agent service.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

// ---------------------------------------------------------------- enums

export const planEnum = pgEnum("plan", ["trial", "starter", "growth", "business", "enterprise"]);
export const orgStatusEnum = pgEnum("org_status", ["trial", "active", "past_due", "suspended", "trial_ended"]);
export const roleEnum = pgEnum("role", ["owner", "admin", "builder", "support_agent", "analyst", "billing"]);
export const platformRoleEnum = pgEnum("platform_role", ["platform_admin", "support_operator"]);
export const limitBehaviourEnum = pgEnum("limit_behaviour", ["stop_route", "offline", "overage"]);
export const sourceTypeEnum = pgEnum("source_type", ["file", "website", "faq"]);
export const sourceStatusEnum = pgEnum("source_status", ["queued", "processing", "ready", "failed"]);
export const deploymentStatusEnum = pgEnum("deployment_status", ["draft", "live", "paused"]);
export const conversationStateEnum = pgEnum("conversation_state", [
  "AI_ACTIVE",
  "HANDOVER_PENDING",
  "HUMAN_ACTIVE",
  "CLOSED",
]);
export const messageKindEnum = pgEnum("message_kind", ["visitor", "ai", "staff", "note", "event"]);
export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "waiting_approval",
  "waiting_visitor",
  "approved",
  "rejected",
  "ran",
  "failed",
  "cancelled",
]);
export const tokenPurposeEnum = pgEnum("token_purpose", ["verify_email", "reset_password"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["open", "paid", "failed", "void"]);

// ---------------------------------------------------------------- tenancy and identity

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  plan: planEnum("plan").notNull().default("trial"),
  status: orgStatusEnum("status").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /** The plan version the current subscription is on (OPS-002). */
  planVersionId: uuid("plan_version_id"),
  customLimits: jsonb("custom_limits").$type<Partial<PlanLimits>>(),
  scheduledPlan: planEnum("scheduled_plan"),
  scheduledPlanAt: timestamp("scheduled_plan_at", { withTimezone: true }),
  billingInterval: text("billing_interval").$type<"month" | "year">().notNull().default("month"),
  renewsAt: timestamp("renews_at", { withTimezone: true }),
  require2fa: boolean("require_2fa").notNull().default(false),
  sessionDays: integer("session_days").notNull().default(14),
  autoCloseMinutes: integer("auto_close_minutes").notNull().default(30),
  alertFirst: integer("alert_first").notNull().default(80),
  alertSecond: integer("alert_second").notNull().default(100),
  limitBehaviour: limitBehaviourEnum("limit_behaviour").notNull().default("stop_route"),
  overageCapAed: numeric("overage_cap_aed", { precision: 10, scale: 2 }).notNull().default("500"),
  /** The organization's customer at the payment provider (Stripe), when one is configured. */
  paymentCustomerId: text("payment_customer_id"),
  paymentCard: jsonb("payment_card").$type<{ brand: string; last4: string } | null>(),
  paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** TOTP secret, sealed with SECRET_KEY. */
  totpSecret: text("totp_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  firstFailedAt: timestamp("first_failed_at", { withTimezone: true }),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  platformRole: platformRoleEnum("platform_role"),
  createdAt: createdAt(),
});

export const members = pgTable(
  "members",
  {
    orgId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const invitations = pgTable("invitations", {
  id: id(),
  orgId: orgId(),
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  message: text("message"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  /** SHA-256 of the cookie value. */
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  /** False until the 2-step code is given, for accounts that have 2-step sign-in. */
  mfaPassed: boolean("mfa_passed").notNull().default(false),
  /** Support access: the grant this session reads through (OPS-003). */
  supportGrantId: uuid("support_grant_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const oneTimeTokens = pgTable("one_time_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  purpose: tokenPurposeEnum("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- agents and tools

export type ToolPolicy = "ask_visitor" | "staff_approval" | "auto";
export type NoPersonBehaviour = "keep_ai" | "collect_contact" | "offline";

export interface AgentConfig {
  name: string;
  purpose: string;
  model: "fast" | "standard" | "advanced";
  replyLanguage: "auto" | "ar" | "en";
  tone: "warm" | "short" | "formal";
  instructions: string;
  creativity: number;
  replyLength: "short" | "balanced" | "detailed";
  operatingHours: { days: number[]; from: string; to: string }[];
  timezone: string;
  outsideHours: NoPersonBehaviour;
  /** Sources this agent must not read; every other ready, enabled source is available. */
  excludedSources: string[];
  tools: Record<string, { enabled: boolean; policy?: ToolPolicy }>;
  allowedTopics: string;
  blockedTopics: string;
  refusalMessage: string;
  guardrails: { discloseAi: boolean; citations: boolean; sayUnsure: boolean; redact: boolean };
  escalation: {
    talkToPerson: boolean;
    agentRequest: boolean;
    lowConfidence: boolean;
    negativeSentiment: boolean;
    sensitiveTopic: boolean;
    toolFailure: boolean;
    lowConfidenceCount: 2 | 3 | 4;
    claimWaitMinutes: number;
    noPerson: NoPersonBehaviour;
  };
  welcome: { en: string; ar: string };
}

export const agents = pgTable("agents", {
  id: id(),
  orgId: orgId(),
  draft: jsonb("draft").$type<AgentConfig>().notNull(),
  liveVersion: integer("live_version"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: id(),
    orgId: orgId(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    config: jsonb("config").$type<AgentConfig>().notNull(),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_versions_number").on(t.agentId, t.number)],
);

export interface HttpToolConfig {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  inputSchema: Record<string, unknown>;
}

export const httpTools = pgTable("http_tools", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  access: text("access").$type<"read" | "write">().notNull(),
  config: jsonb("config").$type<HttpToolConfig>().notNull(),
  /** Sealed JSON object of secret header values. Never returned to a client. */
  secrets: text("secrets"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- knowledge

export const sources = pgTable(
  "sources",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    type: sourceTypeEnum("type").notNull(),
    status: sourceStatusEnum("status").notNull().default("queued"),
    enabled: boolean("enabled").notNull().default(true),
    reason: text("reason"),
    chunks: integer("chunks").notNull().default(0),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    languages: text("languages"),
    details: jsonb("details")
      .$type<{
        url?: string;
        depth?: number;
        domains?: string[];
        question?: string;
        answer?: string;
        file?: string;
        mime?: string;
      }>()
      .notNull()
      .default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("sources_org").on(t.orgId)],
);

export const unansweredQuestions = pgTable(
  "unanswered_questions",
  {
    id: id(),
    orgId: orgId(),
    question: text("question").notNull(),
    /** Normalised text, the grouping key. */
    key: text("key").notNull(),
    language: text("language").notNull(),
    suggestedAnswer: text("suggested_answer"),
    asks: jsonb("asks").$type<string[]>().notNull().default([]),
    lastAskedAt: timestamp("last_asked_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("unanswered_key").on(t.orgId, t.key)],
);

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType: (config) => `vector(${config?.dimensions ?? 1024})`,
  toDriver: (value) => `[${value.join(",")}]`,
});

export const kb = pgSchema("kb");

export const chunks = kb.table(
  "chunks",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    /** Normalised text for keyword search (Arabic letter forms folded). */
    searchKey: text("search_key").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  },
  (t) => [index("chunks_org_source").on(t.orgId, t.sourceId)],
);

// ---------------------------------------------------------------- deployments

export interface DeploymentSettings {
  brandColour: string;
  welcome: { en: string; ar: string };
  position: "right" | "left";
  showAiLabel: boolean;
  suggestedQuestions: boolean;
  suggestions: { en: string[]; ar: string[] };
  rtl: boolean;
  pinnedVersion: number | null;
  languageOverride: "auto" | "ar" | "en";
  toolSubset: string[] | null;
  monthlyQuota: number | null;
  concurrentLimit: number;
  limitBehaviour: "stop_route" | "offline" | "overage";
  preChatForm: boolean;
  offlineMessage: { en: string; ar: string };
  fallbackMessage: { en: string; ar: string };
}

export const deployments = pgTable("deployments", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "restrict" }),
  status: deploymentStatusEnum("status").notNull().default("draft"),
  publicKey: text("public_key").notNull().unique(),
  previousKey: text("previous_key").unique(),
  previousKeyExpiresAt: timestamp("previous_key_expires_at", { withTimezone: true }),
  settings: jsonb("settings").$type<DeploymentSettings>().notNull(),
  createdAt: createdAt(),
});

export const origins = pgTable(
  "origins",
  {
    id: id(),
    orgId: orgId(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    /** The page Verify fetches: the address the user entered, or the origin's home page. */
    checkUrl: text("check_url"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("origins_unique").on(t.deploymentId, t.origin)],
);

// ---------------------------------------------------------------- conversations

export interface Visitor {
  name?: string;
  email?: string;
  phone?: string;
  language: "en" | "ar";
  page?: string;
  device?: string;
  country?: string;
  contactMessage?: string;
}

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    orgId: orgId(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    agentVersion: integer("agent_version").notNull(),
    /** Random token the widget keeps in local storage to resume the conversation. */
    visitorToken: text("visitor_token").notNull(),
    visitor: jsonb("visitor").$type<Visitor>().notNull(),
    state: conversationStateEnum("state").notNull().default("AI_ACTIVE"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    reasonCode: text("reason_code"),
    waitingSince: timestamp("waiting_since", { withTimezone: true }),
    followUpOffered: boolean("follow_up_offered").notNull().default(false),
    tellVisitorBack: boolean("tell_visitor_back").notNull().default(true),
    summary: text("summary"),
    feedback: text("feedback").$type<"yes" | "no">(),
    aiCounted: boolean("ai_counted").notNull().default(false),
    handedOver: boolean("handed_over").notNull().default(false),
    repeatedQuestion: boolean("repeated_question").notNull().default(false),
    lowConfidenceStreak: integer("low_confidence_streak").notNull().default(0),
    toolFailureStreak: integer("tool_failure_streak").notNull().default(0),
    priorChats: integer("prior_chats").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastVisitorAt: timestamp("last_visitor_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").$type<"staff" | "visitor" | "auto">(),
  },
  (t) => [index("conversations_org_state").on(t.orgId, t.state), index("conversations_visitor").on(t.visitorToken)],
);

export interface MessageMeta {
  citations?: { sourceId: string; name: string; chunk: number; confidence: "high" | "medium" | "low" }[];
  toolCalls?: string[];
  tokens?: { input: number; output: number; costAed: number };
  lowConfidence?: boolean;
  reasonCode?: string;
  /** Text the widget shows the visitor for this event, such as the fallback at a usage limit. */
  visitorNotice?: string;
}

export const messages = pgTable(
  "messages",
  {
    id: id(),
    orgId: orgId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    kind: messageKindEnum("kind").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    text: text("text").notNull(),
    meta: jsonb("meta").$type<MessageMeta>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation").on(t.conversationId, t.createdAt)],
);

export const ownershipEvents = pgTable("ownership_events", {
  id: id(),
  orgId: orgId(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  actor: text("actor").notNull(),
  reasonCode: text("reason_code").notNull(),
  version: integer("version").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

export const toolCalls = pgTable("tool_calls", {
  id: id(),
  orgId: orgId(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  toolKey: text("tool_key").notNull(),
  toolName: text("tool_name").notNull(),
  access: text("access").$type<"read" | "write">().notNull(),
  policy: text("policy").$type<ToolPolicy | "read">().notNull(),
  inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
  status: toolCallStatusEnum("status").notNull(),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason"),
  durationMs: integer("duration_ms"),
  result: jsonb("result"),
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

// ---------------------------------------------------------------- plans, usage and billing

export interface PlanLimits {
  aiConversations: number;
  agents: number;
  deployments: number;
  seats: number;
  storageGb: number;
  models: ("fast" | "standard" | "advanced")[];
  httpTools: boolean;
}

export const planVersions = pgTable(
  "plan_versions",
  {
    id: id(),
    plan: planEnum("plan").notNull(),
    version: integer("version").notNull(),
    monthlyAed: numeric("monthly_aed", { precision: 10, scale: 2 }),
    yearlyAed: numeric("yearly_aed", { precision: 10, scale: 2 }),
    overageAed: numeric("overage_aed", { precision: 10, scale: 2 }),
    limits: jsonb("limits").$type<PlanLimits>().notNull(),
    trialDays: integer("trial_days"),
    reason: text("reason").notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plan_versions_unique").on(t.plan, t.version)],
);

/** Append-only. One row per counted AI conversation (BIL-001 FR-027). */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    orgId: orgId(),
    deploymentId: uuid("deployment_id"),
    conversationId: uuid("conversation_id").notNull().unique(),
    period: text("period").notNull(),
    overage: boolean("overage").notNull().default(false),
    amountAed: numeric("amount_aed", { precision: 10, scale: 2 }).notNull().default("0"),
    costAed: numeric("cost_aed", { precision: 10, scale: 4 }).notNull().default("0"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_org_period").on(t.orgId, t.period)],
);

export const alertsSent = pgTable(
  "alerts_sent",
  {
    orgId: orgId(),
    period: text("period").notNull(),
    threshold: text("threshold").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.period, t.threshold] })],
);

export const invoices = pgTable("invoices", {
  id: id(),
  orgId: orgId(),
  number: text("number").notNull().unique(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  plan: planEnum("plan").notNull(),
  planAmountAed: numeric("plan_amount_aed", { precision: 10, scale: 2 }).notNull(),
  overageCount: integer("overage_count").notNull().default(0),
  overageAmountAed: numeric("overage_amount_aed", { precision: 10, scale: 2 }).notNull().default("0"),
  vatAed: numeric("vat_aed", { precision: 10, scale: 2 }).notNull(),
  totalAed: numeric("total_aed", { precision: 10, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("open"),
  /** The provider's payment (Stripe PaymentIntent id) that charged this invoice. */
  paymentRef: text("payment_ref"),
  failureReason: text("failure_reason"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- audit, notifications, operators

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: id(),
    orgId: orgId(),
    actorUserId: uuid("actor_user_id"),
    actorName: text("actor_name").notNull(),
    area: text("area")
      .$type<"Agents" | "Knowledge" | "Tools" | "Deployments" | "Conversations" | "Users" | "Billing" | "Exports">()
      .notNull(),
    action: text("action").notNull(),
    item: text("item").notNull(),
    change: text("change").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_time").on(t.orgId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    orgId: orgId(),
    /** Roles that receive it; empty means only `userId`. */
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
    userId: uuid("user_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    link: text("link").notNull(),
    /** Set when the thing it points at is handled; it then stops counting. */
    doneAt: timestamp("done_at", { withTimezone: true }),
    subjectId: uuid("subject_id"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_org").on(t.orgId, t.createdAt)],
);

export const notificationReads = pgTable(
  "notification_reads",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);

export const supportGrants = pgTable("support_grants", {
  id: id(),
  orgId: orgId(),
  grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  includeConversations: boolean("include_conversations").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const operatorActions = pgTable("operator_actions", {
  id: id(),
  operatorId: uuid("operator_id").notNull(),
  operatorName: text("operator_name").notNull(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

export const salesRequests = pgTable("sales_requests", {
  id: id(),
  orgId: uuid("org_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  message: text("message").notNull().default(""),
  createdAt: createdAt(),
});
