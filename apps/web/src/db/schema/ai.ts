import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  arrayIndex,
  audited,
  bilingualName,
  bilingualTitle,
  enumCheck,
  id,
  isActive,
  jsonObjectCheck,
  money,
  optionalEnumCheck,
  principalTypeCheck,
  rowCheck,
  searchKey,
  trigramIndex,
  ts,
} from "./_conventions";
import { organizations as orgUnit, users as person } from "./hiwar";
import {
  AGENT_STATUSES,
  AGENT_TOOL_MODES,
  AGENT_TRUSTS,
  ASSISTANT_CHAT_ROLES,
  APPROVAL_DECISIONS,
  APPROVAL_POLICIES,
  APPROVAL_STATUSES,
  CHANNEL_BINDING_TYPES,
  CHANNEL_DIRECTIONS,
  CHANNEL_STATUSES,
  CHANNEL_TYPES,
  CONNECTOR_AUTH_TYPES,
  CONNECTOR_STATUSES,
  CONNECTOR_TRANSPORTS,
  CONVERSATION_OUTCOMES,
  CONVERSATION_ROLES,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_SURFACES,
  EXECUTION_PROFILES,
  INBOUND_ACTIONS,
  INBOX_KINDS,
  INBOX_STATUSES,
  INGESTION_KINDS,
  INGESTION_STATUSES,
  KNOWLEDGE_COLLECTION_STATUSES,
  KNOWLEDGE_SOURCE_STATUSES,
  KNOWLEDGE_SOURCE_TYPES,
  MEMORY_ACCESSES,
  MEMORY_SCOPE_KINDS,
  MEMORY_STATUSES,
  MODEL_ENGINES,
  MODEL_KINDS,
  GATEWAY_PROVIDERS,
  MODEL_PROVIDER_KINDS,
  PRINCIPAL_TYPES,
  PROVIDER_AUTH_TYPES,
  RETRIEVAL_MODES,
  RISKS,
  ROUTE_KINDS,
  RUN_CONTEXT_TYPES,
  RUN_STATUSES,
  RUN_STEP_TYPES,
  RUN_TRIGGERS,
  SENSITIVITIES,
  SKILL_SOURCE_TYPES,
  SKILL_VERSION_STATUSES,
  STORYLINE_MODES,
  STORYLINE_ON_ERRORS,
  STORYLINE_STEP_TYPES,
  STORYLINE_VERSION_STATUSES,
  TOOL_TIERS,
  UNKNOWN_SENDER_POLICIES,
  VISITOR_IDENTITIES,
  VISITOR_JWT_FALLBACKS,
  VOICE_MODES,
  BUSINESS_HOURS_MODES,
} from "./enums";

/** Data model sections 10 to 16 — agents, runs, capabilities and the engage surfaces. */
export const ai = pgSchema("ai");

/**
 * Section 1.1: a secret is `bytea` ciphertext produced by the envelope encryption in
 * `src/lib/crypto.ts`. The column type is declared here so no table can hold a secret as
 * readable text by accident.
 */
const ciphertext = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/* --------------------------------------------- section 10: agents, runs and the inbox */

export const agent = ai.table(
  "agent",
  {
    id: id(),
    code: text("code").notNull(),
    ...bilingualName,
    initials: text("initials").notNull(),
    orgUnitId: uuid("org_unit_id").references(() => orgUnit.id),
    reportsToType: text("reports_to_type"),
    reportsToId: uuid("reports_to_id"),
    isSystem: boolean("is_system").notNull().default(false),
    /**
     * The one agent the platform ships and depends on (D65).
     *
     * `is_system` says the platform ships an agent for its own use; this says the platform
     * would break without it. The AI Assistant panel always runs this agent, so deleting it
     * would remove a product surface — the server refuses, and the UI hides the action.
     * Everything about it stays configurable: only its existence is fixed.
     */
    isBuiltin: boolean("is_builtin").notNull().default(false),
    /**
     * Which version of the seeded defaults this agent was last reset to or created from.
     *
     * A seed upgrade moves the defaults forward without overwriting what somebody has
     * customised since: the seed compares this, not the configuration itself.
     */
    defaultVersion: integer("default_version"),
    status: text("status").notNull().default("Idle"),
    activeVersionId: uuid("active_version_id"),
    searchKey: searchKey("search_key", "name_en", "name_ar", "code"),
    ...audited,
  },
  (t) => [
    uniqueIndex("agent_code_key").on(t.code),
    index("agent_org_unit_idx").on(t.orgUnitId),
    trigramIndex("agent_search_idx", t.searchKey),
    enumCheck("agent_status_check", t.status, AGENT_STATUSES),
    principalTypeCheck("agent_reports_to_check", t.reportsToType),
  ],
);

export const route = ai.table(
  "route",
  {
    id: id(),
    alias: text("alias").notNull(),
    kind: text("kind").notNull().default("Standard"),
    outputSchemaJson: jsonb("output_schema_json").$type<Record<string, unknown>>(),
    confidenceThreshold: numeric("confidence_threshold", { precision: 5, scale: 4, mode: "number" }),
    maxRetriesOnInvalid: integer("max_retries_on_invalid"),
    voiceMode: text("voice_mode"),
    sttModel: text("stt_model"),
    ttsVoice: text("tts_voice"),
    languages: text("languages").array(),
    bargeIn: boolean("barge_in"),
    maxCallMinutes: integer("max_call_minutes"),
    routeVersion: integer("route_version").notNull().default(1),
    ...audited,
  },
  (t) => [
    uniqueIndex("route_alias_key").on(t.alias),
    enumCheck("route_kind_check", t.kind, ROUTE_KINDS),
    optionalEnumCheck("route_voice_mode_check", t.voiceMode, VOICE_MODES),
    jsonObjectCheck("route_output_schema_check", t.outputSchemaJson),
  ],
);

export const agentVersion = ai.table(
  "agent_version",
  {
    id: id(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    instructions: text("instructions").notNull().default(""),
    executionProfile: text("execution_profile").notNull().default("Task"),
    primaryRouteId: uuid("primary_route_id").references(() => route.id),
    fallbackRouteId: uuid("fallback_route_id").references(() => route.id),
    trust: text("trust").notNull().default("Standard"),
    memoryEnabled: boolean("memory_enabled").notNull().default(false),
    runBudgetSoftAed: money("run_budget_soft_aed"),
    runBudgetHardAed: money("run_budget_hard_aed"),
    releaseNotes: text("release_notes"),
    evalScore: numeric("eval_score", { precision: 5, scale: 2, mode: "number" }),
    publishedAt: ts("published_at"),
    publishedBy: uuid("published_by").references(() => person.id),
    isActive: boolean("is_active").notNull().default(false),
    ...audited,
  },
  (t) => [
    uniqueIndex("agent_version_key").on(t.agentId, t.versionNumber),
    // Section 23 rule 6: one active version per agent.
    uniqueIndex("agent_version_active_key")
      .on(t.agentId)
      .where(sql`${t.isActive}`),
    enumCheck("agent_version_profile_check", t.executionProfile, EXECUTION_PROFILES),
    enumCheck("agent_version_trust_check", t.trust, AGENT_TRUSTS),
    rowCheck(
      "agent_version_budget_check",
      `"run_budget_soft_aed" is null or "run_budget_hard_aed" is null or "run_budget_soft_aed" <= "run_budget_hard_aed"`,
    ),
  ],
);

/* ------------------------------------------------------------------ section 11: skills */

export const skill = ai.table(
  "skill",
  {
    id: id(),
    skillName: text("skill_name").notNull(),
    ...bilingualTitle,
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    sourceType: text("source_type").notNull().default("Authored"),
    sourceUrl: text("source_url"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    authorPersonId: uuid("author_person_id").references(() => person.id),
    currentVersionId: uuid("current_version_id"),
    searchKey: searchKey("search_key", "skill_name", "title_en", "title_ar"),
    ...audited,
  },
  (t) => [
    uniqueIndex("skill_name_key").on(t.skillName),
    arrayIndex("skill_tags_idx", t.tags),
    trigramIndex("skill_search_idx", t.searchKey),
    enumCheck("skill_source_check", t.sourceType, SKILL_SOURCE_TYPES),
  ],
);

export const skillVersion = ai.table(
  "skill_version",
  {
    id: id(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    versionLabel: text("version_label").notNull(),
    packageRef: text("package_ref"),
    checksum: text("checksum"),
    frontmatterValid: boolean("frontmatter_valid").notNull().default(false),
    /**
     * `allowed-tools` from the skill's frontmatter: the tools it needs to do its job,
     * as `connector/tool` references.
     *
     * Declared rather than discovered, because a skill is prose and the tools it will
     * reach for cannot be read out of it. `UC-51.2-05` compares this with what an agent is
     * allowed, so attaching a skill an agent cannot actually run is caught when the skill
     * is attached and not when a run fails.
     */
    declaredTools: text("declared_tools").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("Draft"),
    ...audited,
  },
  (t) => [
    uniqueIndex("skill_version_key").on(t.skillId, t.versionLabel),
    enumCheck("skill_version_status_check", t.status, SKILL_VERSION_STATUSES),
  ],
);

export const skillScanResult = ai.table("skill_scan_result", {
  skillVersionId: uuid("skill_version_id")
    .primaryKey()
    .references(() => skillVersion.id, { onDelete: "cascade" }),
  scripts: integer("scripts").notNull().default(0),
  networkCalls: integer("network_calls").notNull().default(0),
  promptInjectionPatterns: integer("prompt_injection_patterns").notNull().default(0),
  embeddedSecrets: integer("embedded_secrets").notNull().default(0),
  sandboxOnly: boolean("sandbox_only").notNull().default(true),
  scannedAt: ts("scanned_at").notNull().defaultNow(),
  ...audited,
});

export const skillTestCase = ai.table(
  "skill_test_case",
  {
    id: id(),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersion.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    input: text("input"),
    expected: text("expected"),
    lastResult: text("last_result"),
    lastDurationMs: integer("last_duration_ms"),
    ...audited,
  },
  (t) => [uniqueIndex("skill_test_case_key").on(t.skillVersionId, t.name)],
);

/* -------------------------------------------------------------- section 12: connectors */

export const connectorCatalogEntry = ai.table(
  "connector_catalog_entry",
  {
    id: id(),
    ...bilingualName,
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    logoRef: text("logo_ref"),
    defaultUrl: text("default_url"),
    authType: text("auth_type").notNull().default("None"),
    // How many tools the entry publishes before it is installed; `connector_list` reports it.
    toolCount: integer("tool_count").notNull().default(0),
    ...audited,
  },
  (t) => [enumCheck("connector_catalog_auth_check", t.authType, CONNECTOR_AUTH_TYPES)],
);

export const connector = ai.table(
  "connector",
  {
    id: id(),
    code: text("code").notNull(),
    ...bilingualName,
    catalogEntryId: uuid("catalog_entry_id").references(() => connectorCatalogEntry.id),
    transport: text("transport").notNull().default("StreamableHttp"),
    serverUrl: text("server_url"),
    // A `Stdio` connector's own executable and arguments, as one command line (e.g.
    // `npx -y @modelcontextprotocol/server-foo`) — what the runtime actually runs in the
    // Pod it gives that connector. `StreamableHttp` leaves this empty and uses `serverUrl`.
    command: text("command"),
    authType: text("auth_type").notNull().default("None"),
    // Write-only: the console never reads it back (specification section 9, Secrets).
    secretRef: ciphertext("secret_ref"),
    defaultTierForNewTools: text("default_tier_for_new_tools").notNull().default("T1"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    status: text("status").notNull().default("Disabled"),
    lastHandshakeAt: ts("last_handshake_at"),
    protocolVersion: text("protocol_version"),
    searchKey: searchKey("search_key", "name_en", "name_ar", "code"),
    ...audited,
  },
  (t) => [
    uniqueIndex("connector_code_key").on(t.code),
    trigramIndex("connector_search_idx", t.searchKey),
    enumCheck("connector_transport_check", t.transport, CONNECTOR_TRANSPORTS),
    enumCheck("connector_auth_check", t.authType, CONNECTOR_AUTH_TYPES),
    enumCheck("connector_status_check", t.status, CONNECTOR_STATUSES),
    enumCheck("connector_default_tier_check", t.defaultTierForNewTools, TOOL_TIERS),
  ],
);

export const connectorTool = ai.table(
  "connector_tool",
  {
    id: id(),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connector.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ...bilingualTitle,
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    readOnlyHint: boolean("read_only_hint"),
    destructiveHint: boolean("destructive_hint"),
    tier: text("tier").notNull().default("T1"),
    isAvailable: boolean("is_available").notNull().default(true),
    /**
     * For an `OpenApi` connector, the operation this tool calls: its HTTP method, its path
     * relative to the connector's server URL, where each parameter goes, and the JSON
     * Schema the agent's arguments are validated against. Null for an MCP connector, where
     * the server owns the schema and the platform only forwards.
     */
    operation: jsonb("operation").$type<Record<string, unknown>>(),
    ...audited,
  },
  (t) => [
    uniqueIndex("connector_tool_key").on(t.connectorId, t.name),
    enumCheck("connector_tool_tier_check", t.tier, TOOL_TIERS),
    jsonObjectCheck("connector_tool_operation_check", t.operation),
  ],
);

export const connectorAllowedAgent = ai.table(
  "connector_allowed_agent",
  {
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connector.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.connectorId, t.agentId], name: "connector_allowed_agent_pk" })],
);

/* ------------------------------------------------------------------ section 13: memory */

export const memoryScope = ai.table(
  "memory_scope",
  {
    id: id(),
    kind: text("kind").notNull(),
    refId: uuid("ref_id"),
    /**
     * D68: the one person this scope belongs to. Set on an agent scope, which is per
     * (agent, person) so what a mission remembers for one person is not read back in
     * another person's mission with the same agent. Null is a shared scope — the
     * organisation's, a business unit's, a room's — where sharing is the point.
     */
    personId: uuid("person_id").references(() => person.id),
    parentScopeId: uuid("parent_scope_id"),
    path: text("path").notNull(),
    ...audited,
  },
  (t) => [
    uniqueIndex("memory_scope_path_key").on(t.path),
    // One private scope per (agent, person). The path already carries both, but two
    // concurrent runs for the same person resolve the scope before either has written it.
    uniqueIndex("memory_scope_agent_person_key")
      .on(t.refId, t.personId)
      .where(sql`${t.personId} is not null`),
    index("memory_scope_person_idx").on(t.personId).where(sql`${t.personId} is not null`),
    foreignKey({ columns: [t.parentScopeId], foreignColumns: [t.id], name: "memory_scope_parent_fk" }),
    enumCheck("memory_scope_kind_check", t.kind, MEMORY_SCOPE_KINDS),
  ],
);

export const memory = ai.table(
  "memory",
  {
    id: id(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => memoryScope.id),
    ...bilingualTitle,
    path: text("path").notNull(),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id"),
    status: text("status").notNull().default("Active"),
    accessJson: jsonb("access_json").$type<Record<string, unknown>>(),
    writePolicyJson: jsonb("write_policy_json").$type<Record<string, unknown>>(),
    reviewDueAt: ts("review_due_at"),
    lastReviewedAt: ts("last_reviewed_at"),
    currentVersion: integer("current_version").notNull().default(1),
    searchKey: searchKey("search_key", "title_en", "title_ar", "path"),
    ...audited,
  },
  (t) => [
    uniqueIndex("memory_path_key").on(t.path),
    index("memory_scope_idx").on(t.scopeId),
    trigramIndex("memory_search_idx", t.searchKey),
    enumCheck("memory_status_check", t.status, MEMORY_STATUSES),
    principalTypeCheck("memory_owner_check", t.ownerType),
    jsonObjectCheck("memory_access_check", t.accessJson),
    jsonObjectCheck("memory_write_policy_check", t.writePolicyJson),
  ],
);

export const memoryVersion = ai.table(
  "memory_version",
  {
    id: id(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memory.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    contentRef: text("content_ref"),
    content: text("content"),
    changeNote: text("change_note"),
    createdByType: text("created_by_type").notNull(),
    createdById: uuid("created_by_id"),
    restoredFromVersion: integer("restored_from_version"),
    ...audited,
  },
  (t) => [
    uniqueIndex("memory_version_key").on(t.memoryId, t.versionNumber),
    enumCheck("memory_version_creator_check", t.createdByType, PRINCIPAL_TYPES),
  ],
);

export const memoryEntry = ai.table(
  "memory_entry",
  {
    id: id(),
    memoryVersionId: uuid("memory_version_id")
      .notNull()
      .references(() => memoryVersion.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref"),
    ...audited,
  },
  (t) => [
    index("memory_entry_version_idx").on(t.memoryVersionId),
    enumCheck("memory_entry_source_check", t.sourceType, ["AgentRun", "Person", "Document"]),
  ],
);

export const memoryReview = ai.table(
  "memory_review",
  {
    id: id(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memory.id, { onDelete: "cascade" }),
    memoryVersionId: uuid("memory_version_id").references(() => memoryVersion.id),
    proposedByAgentId: uuid("proposed_by_agent_id").references(() => agent.id),
    reviewerPersonId: uuid("reviewer_person_id").references(() => person.id),
    decision: text("decision"),
    decidedAt: ts("decided_at"),
    ...audited,
  },
  (t) => [
    index("memory_review_memory_idx").on(t.memoryId),
    optionalEnumCheck("memory_review_decision_check", t.decision, ["Approved", "Rejected"]),
  ],
);

/* --------------------------------------------------------------- section 14: knowledge */

export const knowledgeCollection = ai.table(
  "knowledge_collection",
  {
    id: id(),
    collectionId: text("collection_id").notNull(),
    ...bilingualName,
    projectId: uuid("project_id"),
    visibility: text("visibility").notNull().default("Internal"),
    status: text("status").notNull().default("Ready"),
    indexConfigJson: jsonb("index_config_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    chunkingConfigJson: jsonb("chunking_config_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    modelsConfigJson: jsonb("models_config_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    retrievalConfigJson: jsonb("retrieval_config_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    lastSyncAt: ts("last_sync_at"),
    /** `UC-56.2-04`: what the last ingestion run could not read, in the words the screen shows. */
    lastError: text("last_error"),
    // Written back by ingestion from Neo4j, which is where the graph itself lives (section 22).
    entityCount: integer("entity_count").notNull().default(0),
    searchKey: searchKey("search_key", "name_en", "name_ar", "collection_id"),
    ...audited,
  },
  (t) => [
    uniqueIndex("knowledge_collection_code_key").on(t.collectionId),
    trigramIndex("knowledge_collection_search_idx", t.searchKey),
    enumCheck("knowledge_collection_status_check", t.status, KNOWLEDGE_COLLECTION_STATUSES),
    enumCheck("knowledge_collection_visibility_check", t.visibility, SENSITIVITIES),
    jsonObjectCheck("knowledge_collection_index_check", t.indexConfigJson),
    jsonObjectCheck("knowledge_collection_chunking_check", t.chunkingConfigJson),
    jsonObjectCheck("knowledge_collection_models_check", t.modelsConfigJson),
    jsonObjectCheck("knowledge_collection_retrieval_check", t.retrievalConfigJson),
  ],
);

export const knowledgeSource = ai.table(
  "knowledge_source",
  {
    id: id(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollection.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    configJson: jsonb("config_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    documentCount: integer("document_count").notNull().default(0),
    status: text("status").notNull().default("Indexed"),
    /** `UC-57.1-08`: why a source says Error, in the words the screen shows. */
    lastError: text("last_error"),
    ...audited,
  },
  (t) => [
    index("knowledge_source_collection_created_idx").on(t.collectionId, t.createdAt.desc(), t.id.desc()),
    index("knowledge_source_name_search_idx").using("gin", sql`(public.awp_normalise(${t.name})) gin_trgm_ops`),
    enumCheck("knowledge_source_type_check", t.type, KNOWLEDGE_SOURCE_TYPES),
    enumCheck("knowledge_source_status_check", t.status, KNOWLEDGE_SOURCE_STATUSES),
    jsonObjectCheck("knowledge_source_config_check", t.configJson),
  ],
);

export const knowledgeDocument = ai.table(
  "knowledge_document",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    rawRef: text("raw_ref").notNull(),
    checksum: text("checksum"),
    status: text("status").notNull().default("Indexed"),
    chunkCount: integer("chunk_count").notNull().default(0),
    // `UC-57.2-05`: a collection has a size ceiling, which cannot be enforced without
    // knowing what each document in it weighs.
    sizeBytes: integer("size_bytes").notNull().default(0),
    searchKey: searchKey("search_key", "title"),
    ...audited,
  },
  (t) => [
    index("knowledge_document_source_idx").on(t.sourceId),
    trigramIndex("knowledge_document_search_idx", t.searchKey),
    enumCheck("knowledge_document_status_check", t.status, KNOWLEDGE_SOURCE_STATUSES),
  ],
);

export const ingestionJob = ai.table(
  "ingestion_job",
  {
    id: id(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollection.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => knowledgeSource.id),
    kind: text("kind").notNull(),
    progress: integer("progress").notNull().default(0),
    status: text("status").notNull().default("Queued"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    temporalWorkflowId: text("temporal_workflow_id"),
    error: text("error"),
    ...audited,
  },
  (t) => [
    index("ingestion_job_collection_idx").on(t.collectionId, t.createdAt),
    enumCheck("ingestion_job_kind_check", t.kind, INGESTION_KINDS),
    enumCheck("ingestion_job_status_check", t.status, INGESTION_STATUSES),
    rowCheck("ingestion_job_progress_check", `"progress" between 0 and 100`),
  ],
);

export const retrievalTest = ai.table(
  "retrieval_test",
  {
    id: id(),
    collectionId: uuid("collection_id").references(() => knowledgeCollection.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    mode: text("mode").notNull(),
    durationMs: integer("duration_ms"),
    resultsJson: jsonb("results_json").$type<Record<string, unknown>>(),
    runBy: uuid("run_by").references(() => person.id),
    runAt: ts("run_at").notNull().defaultNow(),
    ...audited,
  },
  (t) => [
    index("retrieval_test_collection_idx").on(t.collectionId, t.runAt),
    enumCheck("retrieval_test_mode_check", t.mode, RETRIEVAL_MODES),
    jsonObjectCheck("retrieval_test_results_check", t.resultsJson),
  ],
);

/* -------------------------------------------------------- section 15: models and routes */

export const modelProvider = ai.table(
  "model_provider",
  {
    id: id(),
    ...bilingualName,
    kind: text("kind").notNull().default("Cloud"),
    // What agentgateway calls this provider. Data, not a lookup from the display name:
    // see GATEWAY_PROVIDERS. A custom engine is always "Custom" and carries a base URL on
    // its connection.
    gatewayProvider: text("gateway_provider").notNull().default("Custom"),
    engine: text("engine"),
    isActive: isActive(),
    ...audited,
  },
  (t) => [
    enumCheck("model_provider_kind_check", t.kind, MODEL_PROVIDER_KINDS),
    enumCheck("model_provider_gateway_check", t.gatewayProvider, GATEWAY_PROVIDERS),
    rowCheck("model_provider_custom_gateway_check", `("kind" <> 'Custom') or ("gateway_provider" = 'Custom')`),
    optionalEnumCheck("model_provider_engine_check", t.engine, MODEL_ENGINES),
    rowCheck("model_provider_engine_required_check", `("kind" = 'Cloud' and "engine" is null) or ("kind" = 'Custom' and "engine" is not null)`),
  ],
);

export const providerConnection = ai.table(
  "provider_connection",
  {
    id: id(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProvider.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    region: text("region"),
    baseUrl: text("base_url"),
    authType: text("auth_type").notNull().default("ApiKey"),
    secretRef: ciphertext("secret_ref"),
    isActive: isActive(),
    /** When the saved connection was last tested; null until a test has run. */
    lastTestAt: ts("last_test_at"),
    /** That test's per-model results, `{ results: ModelProbe[] }`. */
    lastTestResultJson: jsonb("last_test_result_json").$type<Record<string, unknown>>(),
    ...audited,
  },
  (t) => [
    uniqueIndex("provider_connection_key").on(t.providerId, t.name),
    enumCheck("provider_connection_auth_check", t.authType, PROVIDER_AUTH_TYPES),
    jsonObjectCheck("provider_connection_last_test_check", t.lastTestResultJson),
  ],
);

export const connectionAllowedModel = ai.table(
  "connection_allowed_model",
  {
    id: id(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => providerConnection.id, { onDelete: "cascade" }),
    modelName: text("model_name").notNull(),
    modalities: text("modalities").array().notNull().default(sql`'{text}'::text[]`),
    // Chat by default: every model before this column existed was one `/chat/completions`
    // could answer, so a migrated row keeps calling the endpoint it always called.
    kind: text("kind").notNull().default("Chat"),
    contextWindow: integer("context_window"),
    priceIn: numeric("price_in", { precision: 18, scale: 6, mode: "number" }),
    priceOut: numeric("price_out", { precision: 18, scale: 6, mode: "number" }),
    ...audited,
  },
  (t) => [
    uniqueIndex("connection_allowed_model_key").on(t.connectionId, t.modelName),
    enumCheck("connection_allowed_model_kind_check", t.kind, MODEL_KINDS),
  ],
);

export const routeStep = ai.table(
  "route_step",
  {
    id: id(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => route.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProvider.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => providerConnection.id),
    modelName: text("model_name").notNull(),
    ...audited,
  },
  (t) => [uniqueIndex("route_step_order_key").on(t.routeId, t.sortOrder)],
);

/* ------------------------------------- agent version children, now that routes exist */

export const agentSkill = ai.table(
  "agent_skill",
  {
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersion.id),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.agentVersionId, t.skillVersionId], name: "agent_skill_pk" })],
);

/** Section 23 rule 4: never looser than the tool's tier, the project rules or the trust. */
export const agentToolMode = ai.table(
  "agent_tool_mode",
  {
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    connectorToolId: uuid("connector_tool_id")
      .notNull()
      .references(() => connectorTool.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("Approval"),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.agentVersionId, t.connectorToolId], name: "agent_tool_mode_pk" }),
    enumCheck("agent_tool_mode_check", t.mode, AGENT_TOOL_MODES),
  ],
);

/**
 * The platform and harness-answered tools this version is granted (D38, D80).
 *
 * A grant, not a catalogue: a row here is a name the run token carries, and the MCP
 * server is the thing that refuses everything else — a row naming a tool the platform
 * does not have grants nothing. Versioned alongside the skills, the connector tool modes
 * and the knowledge access for the same reason they are: a published version keeps the
 * grant it was published with, and a rollback takes the grant back with it.
 *
 * No rows means no tools. An agent whose grant was never written reaches nothing rather
 * than everything.
 */
export const agentPlatformTool = ai.table(
  "agent_platform_tool",
  {
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.agentVersionId, t.toolName], name: "agent_platform_tool_pk" })],
);

export const agentMemoryAccess = ai.table(
  "agent_memory_access",
  {
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    memoryScopeId: uuid("memory_scope_id")
      .notNull()
      .references(() => memoryScope.id, { onDelete: "cascade" }),
    access: text("access").notNull().default("Read"),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.agentVersionId, t.memoryScopeId], name: "agent_memory_access_pk" }),
    enumCheck("agent_memory_access_check", t.access, MEMORY_ACCESSES),
  ],
);

export const agentKnowledgeAccess = ai.table(
  "agent_knowledge_access",
  {
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollection.id, { onDelete: "cascade" }),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.agentVersionId, t.collectionId], name: "agent_knowledge_access_pk" })],
);

/* ------------------------------------------------------------------- runs and approvals */

export const run = ai.table(
  "run",
  {
    id: id(),
    key: text("key").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id),
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersion.id),
    trigger: text("trigger").notNull(),
    contextType: text("context_type").notNull(),
    /**
     * Exactly the tools this run was granted when it started (D35).
     *
     * The grant has to be reconstructable after the fact — "what could this run reach?"
     * is the first question asked about anything an agent did — and it has to be stable
     * across a resume, so a grant widened since the run started cannot apply to it
     * retroactively (D50).
     */
    grantedTools: text("granted_tools").array(),
    /**
     * The run that delegated this one (D46).
     *
     * A delegated run is a run in its own right with its own trace, so without this a
     * mission that delegates three times is four unrelated rows: nothing says which
     * delegation caused which cost, or which child a failure came from.
     */
    parentRunId: uuid("parent_run_id"),
    contextId: uuid("context_id"),
    status: text("status").notNull().default("Queued"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    waitingSeconds: integer("waiting_seconds").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cacheHitPct: numeric("cache_hit_pct", { precision: 5, scale: 2, mode: "number" }),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    estimatedCostAed: money("estimated_cost_aed").notNull().default(0),
    temporalWorkflowId: text("temporal_workflow_id"),
    traceId: text("trace_id"),
    replayOfRunId: uuid("replay_of_run_id"),
    replayFromStep: integer("replay_from_step"),
    ...audited,
  },
  (t) => [
    uniqueIndex("run_key_key").on(t.key),
    index("run_agent_idx").on(t.agentId, t.createdAt),
    index("run_started_idx").on(t.startedAt.desc(), t.id.desc()),
    index("run_agent_started_idx").on(t.agentId, t.startedAt.desc(), t.id.desc()),
    index("run_context_idx").on(t.contextType, t.contextId),
    index("run_status_idx").on(t.status),
    foreignKey({ columns: [t.replayOfRunId], foreignColumns: [t.id], name: "run_replay_fk" }),
    enumCheck("run_trigger_check", t.trigger, RUN_TRIGGERS),
    enumCheck("run_context_check", t.contextType, RUN_CONTEXT_TYPES),
    enumCheck("run_status_check", t.status, RUN_STATUSES),
  ],
);

/** Append-only and monthly range-partitioned on `started_at`. */
export const runStep = ai.table(
  "run_step",
  {
    id: uuid("id")
      .notNull()
      .default(sql`uuidv7()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    result: text("result"),
    hooksApplied: text("hooks_applied").array().notNull().default(sql`'{}'::text[]`),
    estimatedCostAed: money("estimated_cost_aed").notNull().default(0),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.startedAt], name: "run_step_pk" }),
    index("run_step_run_idx").on(t.runId, t.seq),
    enumCheck("run_step_type_check", t.type, RUN_STEP_TYPES),
  ],
);

export const playgroundTest = ai.table(
  "playground_test",
  {
    id: id(),
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    input: text("input").notNull(),
    output: text("output"),
    durationMs: integer("duration_ms"),
    estimatedCostAed: money("estimated_cost_aed"),
    runId: uuid("run_id").references(() => run.id),
    ...audited,
  },
  (t) => [index("playground_test_version_idx").on(t.agentVersionId, t.createdAt)],
);

export const approval = ai.table(
  "approval",
  {
    id: id(),
    key: text("key").notNull(),
    runId: uuid("run_id").references(() => run.id),
    requestedByType: text("requested_by_type").notNull(),
    requestedById: uuid("requested_by_id"),
    workItemId: uuid("work_item_id"),
    requestId: uuid("request_id"),
    action: text("action").notNull(),
    // Which tool call of the run this approval is for. The run is blocked on a signal keyed
    // by it, so a decision cannot resume the run without it.
    callId: text("call_id"),
    argumentsRedacted: jsonb("arguments_redacted").$type<Record<string, unknown>>(),
    // What this approval is an approval *of*: the canonical hash of the call's arguments
    // and the version of the record it targets. The server will not run a T2 call whose
    // arguments or target have moved since a person agreed to them — it refuses and the
    // agent asks again, rather than acting on an agreement to something else.
    argumentsHash: text("arguments_hash"),
    targetVersion: integer("target_version"),
    // Single use and time limited. A pending approval left open is a standing grant.
    expiresAt: ts("expires_at"),
    consumedAt: ts("consumed_at"),
    evidence: text("evidence"),
    risk: text("risk").notNull().default("Medium"),
    policy: text("policy").notNull().default("Single"),
    escalateAfter: ts("escalate_after"),
    status: text("status").notNull().default("Pending"),
    ...audited,
  },
  (t) => [
    uniqueIndex("approval_key_key").on(t.key),
    index("approval_status_idx").on(t.status),
    index("approval_binding_idx").on(t.runId, t.action, t.argumentsHash),
    enumCheck("approval_requester_check", t.requestedByType, PRINCIPAL_TYPES),
    enumCheck("approval_risk_check", t.risk, RISKS),
    enumCheck("approval_policy_check", t.policy, APPROVAL_POLICIES),
    enumCheck("approval_status_check", t.status, APPROVAL_STATUSES),
    jsonObjectCheck("approval_arguments_check", t.argumentsRedacted),
  ],
);

export const approvalDecision = ai.table(
  "approval_decision",
  {
    id: id(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approval.id, { onDelete: "cascade" }),
    approverPersonId: uuid("approver_person_id")
      .notNull()
      .references(() => person.id),
    sequence: integer("sequence").notNull().default(1),
    decision: text("decision").notNull(),
    reason: text("reason"),
    decidedAt: ts("decided_at").notNull().defaultNow(),
    ...audited,
  },
  (t) => [
    uniqueIndex("approval_decision_key").on(t.approvalId, t.approverPersonId),
    enumCheck("approval_decision_check", t.decision, APPROVAL_DECISIONS),
    // Section 23 rule 3: a rejection always carries a reason.
    rowCheck("approval_decision_reason_check", `("decision" <> 'Rejected') or ("reason" is not null and length(btrim("reason")) > 0)`),
  ],
);

export const agentQuestion = ai.table(
  "agent_question",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    askedToType: text("asked_to_type").notNull(),
    askedToId: uuid("asked_to_id").notNull(),
    question: text("question").notNull(),
    /** `UC-12.2-03`: the answers the agent will accept, when it offers a choice. */
    options: text("options").array(),
    answer: text("answer"),
    answeredBy: uuid("answered_by").references(() => person.id),
    answeredAt: ts("answered_at"),
    ...audited,
  },
  (t) => [
    index("agent_question_run_idx").on(t.runId),
    enumCheck("agent_question_asked_to_check", t.askedToType, ["Person", "Group"]),
  ],
);

export const inboxItem = ai.table(
  "inbox_item",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    /** D394: an Update carries its own words and link, since what it reports (a request moving on) has no row of its own to read them from. */
    titleEn: text("title_en"),
    titleAr: text("title_ar"),
    linkPath: text("link_path"),
    status: text("status").notNull().default("Open"),
    resolvedAt: ts("resolved_at"),
    ...audited,
  },
  (t) => [
    uniqueIndex("inbox_item_key").on(t.personId, t.kind, t.sourceType, t.sourceId),
    index("inbox_item_open_idx")
      .on(t.personId)
      .where(sql`${t.status} = 'Open'`),
    index("inbox_item_person_listed_idx").on(t.personId, t.status, t.createdAt, t.id),
    enumCheck("inbox_item_kind_check", t.kind, INBOX_KINDS),
    enumCheck("inbox_item_status_check", t.status, INBOX_STATUSES),
  ],
);

/* --------------------------- section 16: channels, deployments and storylines */

export const embeddedDeployment = ai.table(
  "embedded_deployment",
  {
    id: id(),
    code: text("code").notNull(),
    ...bilingualName,
    defaultAgentId: uuid("default_agent_id").references(() => agent.id),
    status: text("status").notNull().default("Draft"),
    allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
    visitorIdentity: text("visitor_identity").notNull().default("AnonymousOtpStepUp"),
    /** The shared secret the host site signs a visitor token with. */
    visitorJwtSecretRef: ciphertext("visitor_jwt_secret_ref"),
    /** What happens when the token is missing or does not verify. */
    visitorJwtFallback: text("visitor_jwt_fallback").notNull().default("Anonymous"),
    handoffQueue: text("handoff_queue"),
    rateLimitPerVisitor: integer("rate_limit_per_visitor").notNull().default(30),
    widgetTitleEn: text("widget_title_en"),
    widgetTitleAr: text("widget_title_ar"),
    accentColour: text("accent_colour"),
    welcomeMessageEn: text("welcome_message_en"),
    welcomeMessageAr: text("welcome_message_ar"),
    activeStorylineVersionId: uuid("active_storyline_version_id"),
    /** The service identity a visitor's free conversation runs the agent as (D221). */
    runAsPersonId: uuid("run_as_person_id").references(() => person.id),
    /** The widget's notice under its header, and whether a visitor may close it (D231). */
    disclaimerEn: text("disclaimer_en"),
    disclaimerAr: text("disclaimer_ar"),
    disclaimerDismissible: boolean("disclaimer_dismissible").notNull().default(true),
    /** The chips under the greeting, in order, each starting a storyline (D231). */
    quickActionsJson: jsonb("quick_actions_json").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    voiceInput: boolean("voice_input").notNull().default(true),
    readAloud: boolean("read_aloud").notNull().default(true),
    /** Minutes of silence after which a widget session ends. */
    sessionIdleMinutes: integer("session_idle_minutes").notNull().default(30),
    /** Minutes a half-finished scenario may be resumed for. */
    progressRetentionMinutes: integer("progress_retention_minutes").notNull().default(1440),
    searchKey: searchKey("search_key", "name_en", "name_ar", "code"),
    ...audited,
  },
  (t) => [
    uniqueIndex("embedded_deployment_code_key").on(t.code),
    arrayIndex("embedded_deployment_origins_idx", t.allowedOrigins),
    trigramIndex("embedded_deployment_search_idx", t.searchKey),
    enumCheck("embedded_deployment_status_check", t.status, DEPLOYMENT_STATUSES),
    enumCheck("embedded_deployment_identity_check", t.visitorIdentity, VISITOR_IDENTITIES),
    enumCheck("embedded_deployment_jwt_fallback_check", t.visitorJwtFallback, VISITOR_JWT_FALLBACKS),
  ],
);

/** What happened in an embedded widget, for its dashboards (specification section 15, D231). */
export const widgetEvent = ai.table(
  "widget_event",
  {
    id: id(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => embeddedDeployment.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => deploymentConversation.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    propsJson: jsonb("props_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("widget_event_deployment_idx").on(t.deploymentId, t.at)],
);

export const channel = ai.table(
  "channel",
  {
    id: id(),
    type: text("type").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(false),
    status: text("status").notNull().default("Disabled"),
    bindingType: text("binding_type"),
    bindingId: uuid("binding_id"),
    unknownSenders: text("unknown_senders").notNull().default("ExternalContact"),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
    businessHours: text("business_hours").notNull().default("AlwaysOn"),
    secretRef: ciphertext("secret_ref"),
    /** Where outbound messages are posted, which the Test channel check calls. */
    endpointUrl: text("endpoint_url"),
    /** Verifies that an inbound webhook really came from the provider. */
    inboundSecretRef: ciphertext("inbound_secret_ref"),
    offlineMessageEn: text("offline_message_en"),
    offlineMessageAr: text("offline_message_ar"),
    lastTestAt: ts("last_test_at"),
    lastTestResultJson: jsonb("last_test_result_json").$type<Record<string, unknown>>(),
    ...audited,
  },
  (t) => [
    uniqueIndex("channel_type_key").on(t.type),
    enumCheck("channel_type_check", t.type, CHANNEL_TYPES),
    enumCheck("channel_status_check", t.status, CHANNEL_STATUSES),
    optionalEnumCheck("channel_binding_check", t.bindingType, CHANNEL_BINDING_TYPES),
    enumCheck("channel_unknown_senders_check", t.unknownSenders, UNKNOWN_SENDER_POLICIES),
    enumCheck("channel_business_hours_check", t.businessHours, BUSINESS_HOURS_MODES),
    jsonObjectCheck("channel_last_test_check", t.lastTestResultJson),
  ],
);

export const deploymentSurface = ai.table(
  "deployment_surface",
  {
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => embeddedDeployment.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),
    channelId: uuid("channel_id").references(() => channel.id),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.deploymentId, t.surface], name: "deployment_surface_pk" }),
    enumCheck("deployment_surface_check", t.surface, DEPLOYMENT_SURFACES),
  ],
);

export const storyline = ai.table(
  "storyline",
  {
    id: id(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => embeddedDeployment.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    ...bilingualName,
    searchKey: searchKey("search_key", "name_en", "name_ar", "code"),
    ...audited,
  },
  (t) => [
    uniqueIndex("storyline_code_key").on(t.deploymentId, t.code),
    trigramIndex("storyline_search_idx", t.searchKey),
  ],
);

export const storylineVersion = ai.table(
  "storyline_version",
  {
    id: id(),
    storylineId: uuid("storyline_id")
      .notNull()
      .references(() => storyline.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    mode: text("mode").notNull().default("Guided"),
    status: text("status").notNull().default("Draft"),
    publishedAt: ts("published_at"),
    ...audited,
  },
  (t) => [
    uniqueIndex("storyline_version_key").on(t.storylineId, t.versionNumber),
    // Section 23 rule 6: one published storyline version per storyline.
    uniqueIndex("storyline_version_published_key")
      .on(t.storylineId)
      .where(sql`${t.status} = 'Published'`),
    enumCheck("storyline_version_mode_check", t.mode, STORYLINE_MODES),
    enumCheck("storyline_version_status_check", t.status, STORYLINE_VERSION_STATUSES),
  ],
);

export const storylineStep = ai.table(
  "storyline_step",
  {
    id: id(),
    storylineVersionId: uuid("storyline_version_id")
      .notNull()
      .references(() => storylineVersion.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    name: text("name").notNull(),
    stepType: text("step_type").notNull(),
    agentOverrideId: uuid("agent_override_id").references(() => agent.id),
    messageEn: text("message_en"),
    messageAr: text("message_ar"),
    sendVerbatim: boolean("send_verbatim").notNull().default(false),
    slot: text("slot"),
    maxAttempts: integer("max_attempts"),
    verifyMethod: text("verify_method"),
    handoffQueue: text("handoff_queue"),
    toolRefs: text("tool_refs").array().notNull().default(sql`'{}'::text[]`),
    skillRefs: text("skill_refs").array().notNull().default(sql`'{}'::text[]`),
    nextStepId: uuid("next_step_id"),
    onError: text("on_error").notNull().default("Handoff"),
    configJson: jsonb("config_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    ...audited,
  },
  (t) => [
    uniqueIndex("storyline_step_order_key").on(t.storylineVersionId, t.sortOrder),
    foreignKey({ columns: [t.nextStepId], foreignColumns: [t.id], name: "storyline_step_next_fk" }),
    enumCheck("storyline_step_type_check", t.stepType, STORYLINE_STEP_TYPES),
    enumCheck("storyline_step_on_error_check", t.onError, STORYLINE_ON_ERRORS),
    jsonObjectCheck("storyline_step_config_check", t.configJson),
    // "Send verbatim" only means something on a step that carries a message.
    rowCheck("storyline_step_verbatim_check", `(not "send_verbatim") or ("message_en" is not null)`),
  ],
);

export const deploymentConversation = ai.table(
  "deployment_conversation",
  {
    id: id(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => embeddedDeployment.id, { onDelete: "cascade" }),
    storylineVersionId: uuid("storyline_version_id").references(() => storylineVersion.id),
    externalContactId: uuid("external_contact_id"),
    /** The channel the visitor arrived on; null for the console preview. */
    channelId: uuid("channel_id"),
    /** Identifies the visitor across turns: a browser key, a phone number or a Teams user id. */
    visitorKey: text("visitor_key"),
    /** The storyline engine's state between turns. */
    stateJson: jsonb("state_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    roomId: uuid("room_id"),
    currentStepId: uuid("current_step_id").references(() => storylineStep.id),
    slotsJson: jsonb("slots_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    outcome: text("outcome"),
    requestId: uuid("request_id"),
    rating: integer("rating"),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    /** A person took the conversation over: the agent answers nothing until they resume it (D342). */
    agentPausedBy: uuid("agent_paused_by").references(() => person.id),
    agentPausedAt: ts("agent_paused_at"),
    ...audited,
  },
  (t) => [
    index("deployment_conversation_deployment_idx").on(t.deploymentId, t.startedAt),
    index("deployment_conversation_started_idx").on(t.startedAt),
    optionalEnumCheck("deployment_conversation_outcome_check", t.outcome, CONVERSATION_OUTCOMES),
    jsonObjectCheck("deployment_conversation_slots_check", t.slotsJson),
    jsonObjectCheck("deployment_conversation_state_check", t.stateJson),
    index("deployment_conversation_visitor_idx").on(t.deploymentId, t.visitorKey),
    rowCheck("deployment_conversation_rating_check", `"rating" is null or "rating" between 1 and 5`),
  ],
);

/**
 * One line of a visitor conversation, in the order the widget shows them. The engine's
 * emissions are kept as written so a conversation can be re-read, handed to a person, or
 * mirrored to a channel without replaying the storyline.
 */
export const conversationMessage = ai.table(
  "conversation_message",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => deploymentConversation.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    role: text("role").notNull(),
    /** The emission kind, so the widget redraws quick replies and confirmations as they were. */
    kind: text("kind").notNull(),
    textEn: text("text_en"),
    textAr: text("text_ar"),
    payloadJson: jsonb("payload_json").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    ...audited,
  },
  (t) => [
    uniqueIndex("conversation_message_order_key").on(t.conversationId, t.sortOrder),
    enumCheck("conversation_message_role_check", t.role, CONVERSATION_ROLES),
    jsonObjectCheck("conversation_message_payload_check", t.payloadJson),
  ],
);

/**
 * Every message a channel carried, with what the gateway decided about it. This is what
 * makes "the message is dropped and logged" (`UC-61.1-08`) true, and it is the window the
 * rate limiter counts over (`UC-61.1-09`).
 */
export const channelMessage = ai.table(
  "channel_message",
  {
    id: id(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    /** The provider's identifier for the other party: a phone number, a Teams user id, a visitor key. */
    senderKey: text("sender_key").notNull(),
    bodyText: text("body_text"),
    action: text("action").notNull(),
    detail: text("detail"),
    conversationId: uuid("conversation_id").references(() => deploymentConversation.id, { onDelete: "set null" }),
    roomId: uuid("room_id"),
    requestId: uuid("request_id"),
    ...audited,
  },
  (t) => [
    index("channel_message_sender_idx").on(t.channelId, t.senderKey, t.createdAt),
    enumCheck("channel_message_direction_check", t.direction, CHANNEL_DIRECTIONS),
    enumCheck("channel_message_action_check", t.action, INBOUND_ACTIONS),
  ],
);

/**
 * One saved assistant conversation (handoff v2 section 1.10).
 *
 * Stored against the person rather than the browser, so the history they built up follows
 * them to another device the way the rest of the console does. Only the latest 30 are
 * kept; the service drops the oldest past that rather than letting a year of questions
 * accumulate under someone who never opens the history.
 */
export const assistantChat = ai.table(
  "assistant_chat",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    /** The first question asked, which is what the history list shows. */
    title: text("title").notNull(),
    /** The screen the conversation was opened on (`UC-03.1-06`). */
    screen: text("screen").notNull(),
    lastMessageAt: ts("last_message_at").notNull().defaultNow(),
    ...audited,
  },
  (t) => [index("assistant_chat_person_idx").on(t.personId, t.lastMessageAt)],
);

/** One turn of a saved conversation, in the order it was said. */
export const assistantChatMessage = ai.table(
  "assistant_chat_message",
  {
    id: id(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => assistantChat.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    role: text("role").notNull(),
    bodyText: text("body_text").notNull(),
    ...audited,
  },
  (t) => [
    uniqueIndex("assistant_chat_message_order_key").on(t.chatId, t.sortOrder),
    enumCheck("assistant_chat_message_role_check", t.role, ASSISTANT_CHAT_ROLES),
  ],
);
