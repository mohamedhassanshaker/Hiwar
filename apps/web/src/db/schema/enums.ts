/**
 * Every enumeration in `Tahseel_AWP_Data_Model.md` section 21, plus the few the entity
 * tables name inline. They are plain string tuples so one declaration serves three jobs:
 * the `CHECK` constraint on the `text` column (data model section 1.1), the TypeScript
 * union a repository returns, and the Zod enum an action input is validated against.
 */

export const WORK_ITEM_TYPES = ["Task", "SubItem", "Bug"] as const;
export const WORK_ITEM_STATUSES = ["Backlog", "ToDo", "InProgress", "InReview", "Blocked", "Done", "Cancelled"] as const;
export const PRIORITIES = ["High", "Medium", "Low"] as const;
export const PROJECT_STATUSES = ["Backlog", "Planned", "InProgress", "Paused", "Done", "Archived"] as const;
export const SENSITIVITIES = ["Public", "Internal", "Confidential", "Restricted"] as const;
export const ROOM_STATUSES = ["Active", "Idle", "Paused", "Closed", "Archived"] as const;
export const TURN_TAKINGS = ["MentionOnly", "Autonomous"] as const;
export const REQUEST_TYPE_VERSION_STATUSES = ["Draft", "Published", "Retired"] as const;
export const DECOMPOSITIONS = ["None", "Template", "Agent", "Hybrid"] as const;
export const ENTRY_MODES = ["TemplateForm", "AgenticInteractive"] as const;
export const AUDIENCE_ACCESSES = ["CanAct", "NotifyOnly", "ViewOnly"] as const;
export const AGENT_STATUSES = ["Idle", "Running", "Waiting", "Paused", "Error", "Retired"] as const;
export const EXECUTION_PROFILES = ["Conversational", "Task", "Planner", "Reviewer", "Triage", "Scripted", "Routine"] as const;
export const AGENT_TRUSTS = ["Restricted", "Standard", "Elevated", "Coordinator", "System"] as const;
export const AGENT_TOOL_MODES = ["Auto", "Approval", "Denied"] as const;
export const TOOL_TIERS = ["T0", "T1", "T2", "T3"] as const;
/**
 * What a run can be (specification section 3, D40-D42).
 *
 * `Blocked` is distinct from `Waiting` on purpose: a waiting run is resumable and sits
 * in a queue somebody is watching, while a blocked one recorded a blocker through
 * `write_handoff` and needs a person to take it somewhere else. Reporting a blocked run
 * as waiting leaves it in a queue nobody acts on; reporting it as succeeded is a lie.
 *
 * The suspension reasons the specification names — approval, question, budget — are not
 * separate statuses. A waiting run already has the approval row or the question row that
 * says what it waits on, and a second place to say so is a second thing to keep true.
 */
export const RUN_STATUSES = ["Queued", "Running", "Waiting", "Blocked", "Succeeded", "Failed", "Cancelled", "BudgetExceeded"] as const;
export const APPROVAL_STATUSES = ["Pending", "Approved", "Rejected", "ChangesRequested", "Expired"] as const;
export const MEMORY_SCOPE_KINDS = ["Organisation", "BusinessUnit", "Agent", "Session"] as const;
export const MEMORY_STATUSES = ["Active", "PendingReview", "NeedsAttention", "Rejected", "Archived"] as const;
export const KNOWLEDGE_SOURCE_TYPES = ["Upload", "UrlCrawl", "McpResource"] as const;
export const RETRIEVAL_MODES = ["Vector", "Graph", "Hybrid"] as const;
export const ROUTE_KINDS = ["Standard", "Typesafe", "Voice", "Embedding", "Decision"] as const;
/** The route kinds that answer chat completions: an agent runs on one, and a graph extracts with one. */
export const CHAT_ROUTE_KINDS = ["Standard", "Typesafe"] as const;
/** What an allowed model answers at — what a test connection and a route step both need to
 * know to call it at the right endpoint. Provider-agnostic: these are wire-format families a
 * compatible server may implement (OpenAI's `/chat/completions`, `/embeddings`,
 * `/images/generations`, `/audio/speech`, `/audio/transcriptions`; the `/rerank` shape several
 * servers share; and a provider's own decisions endpoint, e.g. OpenRouter's). `Audio` and
 * `Video` name a model's output without a wire format common enough across providers to probe
 * directly. */
export const MODEL_KINDS = ["Chat", "Embedding", "Image", "Speech", "Transcription", "Rerank", "Decision", "Audio", "Video"] as const;
/** Where a `Decision` model answers: off the provider's bare origin, not under its API base
 * path (OpenRouter serves `/api/alpha/decisions`, beside `/api/v1`). */
export const DECISIONS_PATH = "/api/alpha/decisions";
export const LIVE_CHANNEL_TYPES = ["WebWidget", "WhatsApp", "MicrosoftTeams"] as const;
export const COMING_SOON_CHANNEL_TYPES = [
  "Slack",
  "Email",
  "Sms",
  "VoiceIvr",
  "Telegram",
  "Webex",
  "GoogleChat",
  "Instagram",
  "FacebookMessenger",
] as const;
export const CHANNEL_TYPES = [...LIVE_CHANNEL_TYPES, ...COMING_SOON_CHANNEL_TYPES] as const;
export const STORYLINE_MODES = ["Guided", "Strict"] as const;
export const STORYLINE_STEP_TYPES = [
  "Message",
  "Ask",
  "Form",
  "Confirm",
  "Decide",
  "Classify",
  "Tool",
  "Skill",
  "Verify",
  "CreateWork",
  "Handoff",
  "Wait",
  "Subflow",
  "GoTo",
  "End",
] as const;
export const BUDGET_PERIODS = ["Daily", "Weekly", "Monthly", "Quarterly"] as const;
export const BUDGET_ACTIONS_AT_100 = ["NotifyOnly", "SwitchToCheaperAlias", "PauseAgent"] as const;
export const FILE_SCOPES_OF_USE = ["OnlyMe", "Selected", "AllProject"] as const;
export const SCHEDULE_REPEATS = ["Once", "Daily", "Weekly", "Monthly", "OnEvent"] as const;

/** Section 1: an actor or assignee is one of these four kinds of principal. */
export const PRINCIPAL_TYPES = ["Person", "Agent", "Group", "Role", "ExternalContact", "System", "Client"] as const;
export const ASSIGNEE_TYPES = ["Person", "Agent", "Group", "None"] as const;

/** `Pending`: registered by themselves and waiting for an approver (D393). */
export const PERSON_STATUSES = ["Invited", "Pending", "Active", "Suspended"] as const;
export const ROLE_SCOPE_TYPES = ["Organisation", "OrgUnit", "Project"] as const;
export const PERMISSION_EFFECTS = ["Allow", "Deny"] as const;
export const PROJECT_ROLES = ["Owner", "Member", "Agent"] as const;
export const ROOM_ROLES = ["Owner", "Admin", "Member", "LeadAgent", "MemberAgent", "Observer"] as const;
export const ROOM_TYPES = ["Chat", "Review", "WarRoom", "Support", "Automation"] as const;
export const ROOM_SOURCES = ["Console", "Teams", "Widget", "WhatsApp", "Routine"] as const;
export const MESSAGE_FEEDBACK_VALUES = ["Helpful", "NotHelpful"] as const;
export const CONTEXT_HANDOFF_OWNERS = ["Room", "WorkItem", "Request", "Run"] as const;
export const ATTRIBUTE_DATA_TYPES = [
  "Text",
  "LongText",
  "Number",
  "Money",
  "Date",
  "DateTime",
  "Enum",
  "Boolean",
  "Person",
  "File",
  "Table",
] as const;
/** An SLA is a count of one of these, so "30 minutes" and "2 days" are both expressible. */
export const SLA_UNITS = ["Minutes", "Hours", "Days", "BusinessDays"] as const;
export const INTAKE_CHANNELS = ["Console", "Teams", "Email", "Widget", "WhatsApp", "Api"] as const;
export const ROUTING_RULE_KINDS = ["Condition", "Action"] as const;
export const REQUESTER_TYPES = ["Person", "ExternalContact"] as const;
export const REQUEST_ENTRY_MODES = ["Form", "Agentic"] as const;
export const REQUEST_EVENT_TYPES = [
  "Submitted",
  "Classified",
  "StepEntered",
  "ActionTaken",
  "Returned",
  "Assigned",
  "Comment",
] as const;
export const ATTACHMENT_OWNERS = ["Request", "WorkItem", "Room", "Conversation"] as const;

/** What a terminal step actually ends the request as — a request filtered by `Rejected`
 * must have been written as one, not inferred from it sharing `Completed` with an approval. */
export const REQUEST_STEP_OUTCOMES = ["Completed", "Rejected"] as const;
export const WORK_ITEM_ORIGINS = ["Manual", "Request", "Room", "Schedule", "Agent", "Comment"] as const;

/**
 * The dashboard cards a comment thread can hang on. A thread is identified by the card it
 * is about, so the set is closed: a card that is renamed keeps its id, and a card that is
 * removed takes its threads with it rather than leaving them addressed to nothing.
 */
export const COMMENTABLE_CARDS = ["runs", "tasks", "attention", "live"] as const;

/** Who said a line in a saved assistant conversation. */
export const ASSISTANT_CHAT_ROLES = ["user", "assistant"] as const;
export const WORK_ITEM_ACTIVITY_TYPES = [
  "Created",
  "StatusChanged",
  "Assigned",
  "Commented",
  "SubmittedForReview",
  "Approved",
  "ChangesRequested",
  "Reopened",
  "Unblocked",
  "SubItemAdded",
] as const;
export const SAVED_VIEW_SCREENS = ["WorkItems", "Requests"] as const;
export const SCHEDULE_STATUSES = ["Active", "Paused"] as const;
export const SCHEDULE_RUN_OUTCOMES = ["Created", "Failed", "Skipped"] as const;
export const ARTIFACT_STATUSES = ["Active", "Inactive"] as const;
/**
 * `UC-33.1-05`: an uploaded file the content scan flagged is held rather than served, so it
 * has a third state an artifact produced by a run does not.
 */
export const FILE_STATUSES = ["Active", "Inactive", "Quarantined"] as const;
export const ARTIFACT_LINK_TYPES = ["WorkItem", "Request", "Room"] as const;
export const PRODUCER_TYPES = ["Agent", "Person"] as const;
export const RUN_TRIGGERS = ["Mention", "Assignment", "RequestStep", "Schedule", "Widget", "Manual", "Replay", "Delegation"] as const;
/**
 * What a run is about. `Console` is a run bound to a screen rather than to a record —
 * the page assistant and the playground — whose context id is a path, not a row id.
 * Without it such a run had to claim to be about a `WorkItem`, and the screen path was
 * then written to a uuid column the first time it asked for an approval.
 */
export const RUN_CONTEXT_TYPES = ["Room", "WorkItem", "Request", "Deployment", "Console"] as const;
export const RUN_STEP_TYPES = ["Start", "Model", "Tool", "Skill", "Approval", "Question", "Verify", "Handoff"] as const;
export const RISKS = ["Low", "Medium", "High"] as const;
export const APPROVAL_POLICIES = ["Single", "AnyOf", "Sequential"] as const;
export const APPROVAL_DECISIONS = ["Approved", "Rejected", "ChangesRequested"] as const;
export const INBOX_KINDS = ["Approval", "Question", "Mention", "SlaWarning", "Review", "Update"] as const;
export const INBOX_STATUSES = ["Open", "Resolved"] as const;
export const SKILL_SOURCE_TYPES = ["Bundled", "Uploaded", "Git", "Registry", "Authored"] as const;
export const SKILL_VERSION_STATUSES = ["Draft", "Published"] as const;
/**
 * How the platform reaches a connector. `OpenApi` is a plain REST API described by an
 * OpenAPI or Swagger document: the connector runtime calls its operations over HTTP
 * instead of speaking MCP to it.
 */
export const CONNECTOR_TRANSPORTS = ["StreamableHttp", "Stdio", "OpenApi"] as const;
/**
 * How a connector is authenticated (D296). `ApiKey` is a key in a named header or query
 * parameter; `Bearer` a static token in `Authorization`; `Basic` a user name and password;
 * `ClientCredentials` the OAuth 2 client-credentials grant; `OAuth` the authorization-code
 * grant an administrator completes once with Connect.
 */
export const CONNECTOR_AUTH_TYPES = ["OAuth", "ClientCredentials", "Bearer", "ApiKey", "Basic", "None"] as const;
export const CONNECTOR_STATUSES = ["Connected", "Error", "Disabled"] as const;
export const MEMORY_ACCESSES = ["Read", "ReadWrite"] as const;
export const KNOWLEDGE_COLLECTION_STATUSES = ["Ready", "Ingesting", "Error"] as const;
export const KNOWLEDGE_SOURCE_STATUSES = ["Indexed", "Indexing", "Error"] as const;
export const INGESTION_KINDS = ["Ingest", "Reindex", "ReindexAll"] as const;
export const INGESTION_STATUSES = ["Queued", "Running", "Succeeded", "Failed"] as const;
export const MODEL_PROVIDER_KINDS = ["Cloud", "Custom"] as const;

/**
 * The provider identities agentgateway understands, which is what a route renders to.
 *
 * Held as data on the provider rather than derived from its display name: a name is
 * bilingual and editable, so deriving the gateway identity from it means renaming
 * "Azure OpenAI" silently stops every route through it from being applied.
 */
export const GATEWAY_PROVIDERS = [
  "Anthropic",
  "Azure",
  "Baseten",
  "Bedrock",
  "Cerebras",
  "Cohere",
  "Custom",
  "Deepinfra",
  "Deepseek",
  "Fireworks",
  "Gemini",
  "Groq",
  "Huggingface",
  "Meta",
  "Mistral",
  "Ollama",
  "OpenAI",
  "Openrouter",
  "TogetherAI",
  "VertexAI",
  "XAI",
] as const;
export const MODEL_ENGINES = [
  "Ollama",
  "VLlm",
  "LmStudio",
  "Tgi",
  "LlamaCpp",
  "LocalAi",
  "TritonNim",
  "OpenAiCompatible",
] as const;
/** How a provider connection authenticates. Wider than a connector: clouds use workload identity. */
export const PROVIDER_AUTH_TYPES = ["ApiKey", "EntraId", "IamRole", "BearerToken", "OAuth", "None"] as const;
export const VOICE_MODES = ["Realtime", "Pipeline"] as const;
export const CHANNEL_STATUSES = ["Enabled", "Degraded", "Disabled"] as const;
export const CHANNEL_BINDING_TYPES = ["EmbeddedDeployment", "RoomMirror", "RequestIntake"] as const;
export const UNKNOWN_SENDER_POLICIES = ["ExternalContact", "Ignore"] as const;
export const BUSINESS_HOURS_MODES = ["AlwaysOn", "WorkingCalendar"] as const;
export const DEPLOYMENT_STATUSES = ["Enabled", "Disabled", "Draft"] as const;
export const VISITOR_IDENTITIES = ["AnonymousOtpStepUp", "SignedJwt"] as const;
/** What a deployment does with a visitor whose signed token is missing or not valid. */
export const VISITOR_JWT_FALLBACKS = ["Anonymous", "Refuse"] as const;
export const DEPLOYMENT_SURFACES = ["Widget", "WhatsApp", "Teams"] as const;
export const CONVERSATION_OUTCOMES = ["Completed", "HandedOff", "Abandoned", "Cancelled", "RequestCreated"] as const;
export const STORYLINE_ON_ERRORS = ["RetryOnce", "GoToStep", "Handoff"] as const;
/** A published storyline version stays readable after the next one replaces it. */
export const STORYLINE_VERSION_STATUSES = ["Draft", "Published", "Superseded"] as const;
export const BUDGET_EVENT_TYPES = ["WarningSent", "HardLimitReached", "ActionApplied"] as const;
export const CLIENT_STATUSES = ["Active", "Inactive"] as const;
export const CLIENT_KEY_STATUSES = ["Active", "Revoked"] as const;
export const CLIENT_PERMISSIONS = [
  "agents:invoke",
  "requests:write",
  "work_items:read",
  "rooms:read",
  "knowledge:search",
  "webhooks:receive",
] as const;
/**
 * Who an audit entry names. `ExternalContact` is a stranger acting through a channel the
 * platform published — an embedded widget, WhatsApp, a request type's intake form on
 * another site. They are the actor, so the entry says so rather than attributing their
 * submission to the platform.
 */
export const AUDIT_ACTOR_TYPES = ["Person", "Agent", "Client", "ExternalContact", "System"] as const;
export const AUDIT_OUTCOMES = ["Allowed", "Denied"] as const;
export const BRANDING_ASSET_KINDS = ["LogoLight", "LogoDark", "Favicon"] as const;
export const FEATURE_FLAG_GROUPS = ["AgentsAndRuns", "MemoryAndKnowledge", "Collaboration", "Engage", "Platform"] as const;
export const LOG_LEVELS = ["Debug", "Info", "Warn", "Error"] as const;
export const PREFERRED_LANGUAGES = ["en", "ar"] as const;
export const DECISION_SOURCES = ["Approval", "ChangeSet", "Room"] as const;
export const OUTBOX_STATUSES = ["Pending", "Delivered", "Failed"] as const;
/** D240: the system email notifications, and where each one got to. */
export const MAIL_NOTIFICATION_KINDS = ["RequestCreated", "RequestUpdated", "RequestFinished", "WorkItemFinished", "Invitation", "Test", "AgentEmail", "Alert"] as const;
/** D247: the emails the platform sends by itself, each with its own template. */
export const MAIL_TEMPLATE_KINDS = ["requestCreated", "requestUpdated", "requestFinished", "workItemFinished", "invitation"] as const;
export const MAIL_NOTIFICATION_STATUSES = ["Queued", "Sending", "Sent", "Failed", "Skipped"] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];
export type ToolTier = (typeof TOOL_TIERS)[number];
export type RoleScopeType = (typeof ROLE_SCOPE_TYPES)[number];
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

/** Which way a channel message travelled, and what the gateway did with an inbound one. */
export const CHANNEL_DIRECTIONS = ["Inbound", "Outbound"] as const;
export const INBOUND_ACTIONS = ["Process", "Offline", "Throttled", "Dropped"] as const;

/** Who said a line in a visitor conversation. */
export const CONVERSATION_ROLES = ["Visitor", "Agent", "HumanAgent", "System"] as const;
