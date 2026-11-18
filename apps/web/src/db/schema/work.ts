import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgSchema, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  arrayIndex,
  audited,
  bilingualName,
  bilingualTitle,
  enumCheck,
  id,
  jsonObjectCheck,
  jsonbIndex,
  money,
  optionalEnumCheck,
  principalTypeCheck,
  rowCheck,
  searchKey,
  trigramIndex,
  ts,
} from "./_conventions";
import { orgUnit, person } from "./core";
import {
  ARTIFACT_LINK_TYPES,
  ARTIFACT_STATUSES,
  FILE_STATUSES,
  ASSIGNEE_TYPES,
  ATTACHMENT_OWNERS,
  ATTRIBUTE_DATA_TYPES,
  COMMENTABLE_CARDS,
  AUDIENCE_ACCESSES,
  CONTEXT_HANDOFF_OWNERS,
  DECISION_SOURCES,
  DECOMPOSITIONS,
  ENTRY_MODES,
  FILE_SCOPES_OF_USE,
  INTAKE_CHANNELS,
  MESSAGE_FEEDBACK_VALUES,
  PRIORITIES,
  PRINCIPAL_TYPES,
  PRODUCER_TYPES,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  REQUESTER_TYPES,
  REQUEST_ENTRY_MODES,
  REQUEST_EVENT_TYPES,
  REQUEST_STEP_OUTCOMES,
  REQUEST_TYPE_VERSION_STATUSES,
  ROOM_ROLES,
  ROOM_SOURCES,
  ROOM_STATUSES,
  ROOM_TYPES,
  ROUTING_RULE_KINDS,
  SAVED_VIEW_SCREENS,
  SCHEDULE_REPEATS,
  SCHEDULE_RUN_OUTCOMES,
  SCHEDULE_STATUSES,
  SENSITIVITIES,
  SLA_UNITS,
  TOOL_TIERS,
  TURN_TAKINGS,
  WORK_ITEM_ACTIVITY_TYPES,
  WORK_ITEM_ORIGINS,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
} from "./enums";

/** Data model sections 4 to 9 — projects, rooms, requests, work items, schedules and files. */
export const work = pgSchema("work");

/* ---------------------------------------------------------------- section 4: projects */

export const project = work.table(
  "project",
  {
    id: id(),
    key: text("key").notNull(),
    ...bilingualName,
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    orgUnitId: uuid("org_unit_id").references(() => orgUnit.id),
    sensitivity: text("sensitivity").notNull().default("Internal"),
    status: text("status").notNull().default("Planned"),
    requireReviewerNotAuthor: boolean("require_reviewer_not_author").notNull().default(true),
    searchKey: searchKey("search_key", "name_en", "name_ar", "key"),
    ...audited,
  },
  (t) => [
    uniqueIndex("project_key_key").on(t.key),
    index("project_org_unit_idx").on(t.orgUnitId),
    trigramIndex("project_search_idx", t.searchKey),
    enumCheck("project_status_check", t.status, PROJECT_STATUSES),
    enumCheck("project_sensitivity_check", t.sensitivity, SENSITIVITIES),
  ],
);

export const projectMember = work.table(
  "project_member",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: uuid("principal_id").notNull(),
    projectRole: text("project_role").notNull().default("Member"),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.principalType, t.principalId], name: "project_member_pk" }),
    enumCheck("project_member_principal_check", t.principalType, PRINCIPAL_TYPES),
    enumCheck("project_member_role_check", t.projectRole, PROJECT_ROLES),
  ],
);

/** Empty means "every agent the trust level allows" (data model section 4). */
export const projectAllowedAgent = work.table(
  "project_allowed_agent",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.projectId, t.agentId], name: "project_allowed_agent_pk" })],
);

export const projectAllowedConnector = work.table(
  "project_allowed_connector",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull(),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.projectId, t.connectorId], name: "project_allowed_connector_pk" })],
);

/** The "Human approval for" list. Section 23 rule 4: a rule can only raise a tier. */
export const projectApprovalRule = work.table(
  "project_approval_rule",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    actionOrToolRef: text("action_or_tool_ref").notNull(),
    approverType: text("approver_type").notNull(),
    approverId: uuid("approver_id"),
    minimumTier: text("minimum_tier").notNull().default("T2"),
    ...audited,
  },
  (t) => [
    uniqueIndex("project_approval_rule_key").on(t.projectId, t.actionOrToolRef),
    enumCheck("project_approval_rule_approver_check", t.approverType, PRINCIPAL_TYPES),
    enumCheck("project_approval_rule_tier_check", t.minimumTier, TOOL_TIERS),
  ],
);

export const decision = work.table(
  "decision",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    ...bilingualTitle,
    decidedBy: uuid("decided_by").references(() => person.id),
    decidedAt: ts("decided_at").notNull().defaultNow(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    ...audited,
  },
  (t) => [
    index("decision_project_idx").on(t.projectId, t.decidedAt),
    enumCheck("decision_source_check", t.sourceType, DECISION_SOURCES),
  ],
);

/* ---------------------------------------------------------- section 5: discussion rooms */

export const discussionRoom = work.table(
  "discussion_room",
  {
    id: id(),
    key: text("key").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    ...bilingualTitle,
    type: text("type").notNull().default("Chat"),
    source: text("source").notNull().default("Console"),
    status: text("status").notNull().default("Active"),
    turnTaking: text("turn_taking").notNull().default("MentionOnly"),
    agentHopLimit: integer("agent_hop_limit").notNull().default(6),
    costCapAed: money("cost_cap_aed"),
    forkedFromRoomId: uuid("forked_from_room_id"),
    mirrorChannelId: uuid("mirror_channel_id"),
    mirrorExternalRef: text("mirror_external_ref"),
    lastActivityAt: ts("last_activity_at"),
    searchKey: searchKey("search_key", "title_en", "title_ar", "key"),
    ...audited,
  },
  (t) => [
    uniqueIndex("discussion_room_key_key").on(t.key),
    index("discussion_room_project_idx").on(t.projectId),
    index("discussion_room_activity_idx").on(t.lastActivityAt),
    index("discussion_room_recent_idx").on(sql`(coalesce(${t.lastActivityAt}, ${t.createdAt})) desc`, t.id.desc()),
    trigramIndex("discussion_room_search_idx", t.searchKey),
    foreignKey({ columns: [t.forkedFromRoomId], foreignColumns: [t.id], name: "discussion_room_fork_fk" }),
    enumCheck("discussion_room_status_check", t.status, ROOM_STATUSES),
    enumCheck("discussion_room_type_check", t.type, ROOM_TYPES),
    enumCheck("discussion_room_source_check", t.source, ROOM_SOURCES),
    enumCheck("discussion_room_turn_taking_check", t.turnTaking, TURN_TAKINGS),
  ],
);

export const roomParticipant = work.table(
  "room_participant",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => discussionRoom.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: uuid("principal_id").notNull(),
    roomRole: text("room_role").notNull().default("Member"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.principalType, t.principalId], name: "room_participant_pk" }),
    enumCheck("room_participant_principal_check", t.principalType, PRINCIPAL_TYPES),
    enumCheck("room_participant_role_check", t.roomRole, ROOM_ROLES),
  ],
);

/**
 * Append-only and monthly range-partitioned on `created_at` (data model section 1.1), so
 * the primary key carries the partition column.
 */
export const roomMessage = work.table(
  "room_message",
  {
    id: uuid("id")
      .notNull()
      .default(sql`uuidv7()`),
    roomId: uuid("room_id")
      .notNull()
      .references(() => discussionRoom.id),
    seq: integer("seq").notNull(),
    senderType: text("sender_type").notNull(),
    senderId: uuid("sender_id"),
    contentJson: jsonb("content_json").notNull().$type<Record<string, unknown>>(),
    runId: uuid("run_id"),
    artifactId: uuid("artifact_id"),
    approvalId: uuid("approval_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt], name: "room_message_pk" }),
    index("room_message_room_idx").on(t.roomId, t.seq),
    enumCheck("room_message_sender_check", t.senderType, PRINCIPAL_TYPES),
    jsonObjectCheck("room_message_content_check", t.contentJson),
  ],
);

export const messageFeedback = work.table(
  "message_feedback",
  {
    id: id(),
    messageId: uuid("message_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    value: text("value").notNull(),
    comment: text("comment"),
    ...audited,
  },
  (t) => [
    uniqueIndex("message_feedback_key").on(t.messageId, t.personId),
    enumCheck("message_feedback_value_check", t.value, MESSAGE_FEEDBACK_VALUES),
  ],
);

/** Written when a room closes and at the end of every run (specification section 5). */
export const contextHandoff = work.table(
  "context_handoff",
  {
    id: id(),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    goal: text("goal"),
    decisions: text("decisions"),
    openQuestions: text("open_questions"),
    nextStep: text("next_step"),
    ...audited,
  },
  (t) => [
    uniqueIndex("context_handoff_owner_key").on(t.ownerType, t.ownerId),
    enumCheck("context_handoff_owner_check", t.ownerType, CONTEXT_HANDOFF_OWNERS),
  ],
);

export const roomWorkItemLink = work.table(
  "room_work_item_link",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => discussionRoom.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull(),
    messageId: uuid("message_id"),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.roomId, t.workItemId], name: "room_work_item_link_pk" })],
);

/* ------------------------------------------- section 6: requests and request types */

export const requestType = work.table(
  "request_type",
  {
    id: id(),
    code: text("code").notNull(),
    ...bilingualName,
    categoryEn: text("category_en"),
    categoryAr: text("category_ar"),
    currentPublishedVersionId: uuid("current_published_version_id"),
    searchKey: searchKey("search_key", "name_en", "name_ar", "code"),
    ...audited,
  },
  (t) => [uniqueIndex("request_type_code_key").on(t.code), trigramIndex("request_type_search_idx", t.searchKey)],
);

export const requestTypeVersion = work.table(
  "request_type_version",
  {
    id: id(),
    requestTypeId: uuid("request_type_id")
      .notNull()
      .references(() => requestType.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("Draft"),
    defaultProjectId: uuid("default_project_id").references(() => project.id),
    decomposition: text("decomposition").notNull().default("None"),
    slaValue: integer("sla_value"),
    slaUnit: text("sla_unit"),
    intakeChannels: text("intake_channels").array().notNull().default(sql`'{Console}'::text[]`),
    entryModes: text("entry_modes").array().notNull().default(sql`'{TemplateForm}'::text[]`),
    publishedAt: ts("published_at"),
    publishedBy: uuid("published_by").references(() => person.id),
    ...audited,
  },
  (t) => [
    uniqueIndex("request_type_version_key").on(t.requestTypeId, t.versionNumber),
    // Section 23 rule 6: only one published version per request type at a time.
    uniqueIndex("request_type_version_published_key")
      .on(t.requestTypeId)
      .where(sql`${t.status} = 'Published'`),
    arrayIndex("request_type_version_channels_idx", t.intakeChannels),
    enumCheck("request_type_version_status_check", t.status, REQUEST_TYPE_VERSION_STATUSES),
    enumCheck("request_type_version_decomposition_check", t.decomposition, DECOMPOSITIONS),
    optionalEnumCheck("request_type_version_sla_unit_check", t.slaUnit, SLA_UNITS),
    rowCheck(
      "request_type_version_channels_check",
      `"intake_channels" <@ ARRAY[${INTAKE_CHANNELS.map((c) => `'${c}'`).join(",")}]::text[]`,
    ),
    rowCheck("request_type_version_modes_check", `"entry_modes" <@ ARRAY[${ENTRY_MODES.map((m) => `'${m}'`).join(",")}]::text[]`),
  ],
);

export const attributeDefinition = work.table(
  "attribute_definition",
  {
    id: id(),
    requestTypeVersionId: uuid("request_type_version_id")
      .notNull()
      .references(() => requestTypeVersion.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    labelEn: text("label_en").notNull(),
    labelAr: text("label_ar").notNull(),
    dataType: text("data_type").notNull(),
    required: boolean("required").notNull().default(false),
    /** A list's choices, each with its stored value and a label in each language. */
    enumValues: jsonb("enum_values").$type<{ value: string; labelEn: string; labelAr: string }[]>(),
    validationJson: jsonb("validation_json").$type<Record<string, unknown>>(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** The step the attribute is asked at; null is the request form. */
    stepId: uuid("step_id").references(() => transitionStep.id, { onDelete: "set null" }),
    ...audited,
  },
  (t) => [
    uniqueIndex("attribute_definition_key").on(t.requestTypeVersionId, t.key),
    enumCheck("attribute_definition_type_check", t.dataType, ATTRIBUTE_DATA_TYPES),
    jsonObjectCheck("attribute_definition_validation_check", t.validationJson),
    rowCheck("attribute_definition_enum_values_check", `"enum_values" is null or jsonb_typeof("enum_values") = 'array'`),
  ],
);

export const transitionStep = work.table(
  "transition_step",
  {
    id: id(),
    requestTypeVersionId: uuid("request_type_version_id")
      .notNull()
      .references(() => requestTypeVersion.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    ...bilingualName,
    slaValue: integer("sla_value"),
    slaUnit: text("sla_unit"),
    isTerminal: boolean("is_terminal").notNull().default(false),
    /** What a request is left as when it ends on this step. Meaningless on a step that is
     * not terminal, so a default is all a non-terminal step ever needs. */
    terminalOutcome: text("terminal_outcome").notNull().default("Completed"),
    ...audited,
  },
  (t) => [
    uniqueIndex("transition_step_order_key").on(t.requestTypeVersionId, t.sortOrder),
    optionalEnumCheck("transition_step_sla_unit_check", t.slaUnit, SLA_UNITS),
    enumCheck("transition_step_outcome_check", t.terminalOutcome, REQUEST_STEP_OUTCOMES),
  ],
);

/** Section 23 rule 5: a terminal step has no audience and no outgoing routing rule. */
export const stepAudience = work.table(
  "step_audience",
  {
    id: id(),
    stepId: uuid("step_id")
      .notNull()
      .references(() => transitionStep.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: uuid("principal_id"),
    access: text("access").notNull().default("CanAct"),
    sequence: integer("sequence"),
    ...audited,
  },
  (t) => [
    index("step_audience_step_idx").on(t.stepId),
    enumCheck("step_audience_principal_check", t.principalType, [...PRINCIPAL_TYPES, "Requester"]),
    enumCheck("step_audience_access_check", t.access, AUDIENCE_ACCESSES),
  ],
);

export const routingRule = work.table(
  "routing_rule",
  {
    id: id(),
    fromStepId: uuid("from_step_id")
      .notNull()
      .references(() => transitionStep.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    kind: text("kind").notNull(),
    expression: text("expression"),
    actionName: text("action_name"),
    // A rule whose target step is gone routes nowhere, so it goes with the step (D301).
    toStepId: uuid("to_step_id").references(() => transitionStep.id, { onDelete: "cascade" }),
    ...audited,
  },
  (t) => [
    uniqueIndex("routing_rule_order_key").on(t.fromStepId, t.sortOrder),
    enumCheck("routing_rule_kind_check", t.kind, ROUTING_RULE_KINDS),
    rowCheck(
      "routing_rule_payload_check",
      `("kind" = 'Condition' and "expression" is not null) or ("kind" = 'Action' and "action_name" is not null)`,
    ),
  ],
);

export const request = work.table(
  "request",
  {
    id: id(),
    key: text("key").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    requestTypeVersionId: uuid("request_type_version_id")
      .notNull()
      .references(() => requestTypeVersion.id),
    ...bilingualTitle,
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    requesterType: text("requester_type").notNull().default("Person"),
    requesterId: uuid("requester_id").notNull(),
    channel: text("channel").notNull().default("Console"),
    entryMode: text("entry_mode").notNull().default("Form"),
    currentStepId: uuid("current_step_id").references(() => transitionStep.id),
    status: text("status").notNull().default("Submitted"),
    submittedAt: ts("submitted_at"),
    dueAt: ts("due_at"),
    closedAt: ts("closed_at"),
    parentRequestId: uuid("parent_request_id"),
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    originRoomId: uuid("origin_room_id").references(() => discussionRoom.id),
    originDeploymentId: uuid("origin_deployment_id"),
    /** The person who took the current step; the other audiences wait until it moves. */
    claimedBy: uuid("claimed_by"),
    claimedAt: ts("claimed_at"),
    searchKey: searchKey("search_key", "title_en", "title_ar", "key"),
    ...audited,
  },
  (t) => [
    uniqueIndex("request_key_key").on(t.key),
    index("request_project_idx").on(t.projectId),
    index("request_step_idx").on(t.currentStepId),
    index("request_due_idx").on(t.dueAt),
    index("request_list_idx").on(t.createdAt.desc(), t.key.desc()).where(sql`${t.parentRequestId} is null`),
    index("request_requester_idx").on(t.requesterId),
    trigramIndex("request_search_idx", t.searchKey),
    jsonbIndex("request_attributes_idx", t.attributes),
    foreignKey({ columns: [t.parentRequestId], foreignColumns: [t.id], name: "request_parent_fk" }),
    enumCheck("request_requester_check", t.requesterType, REQUESTER_TYPES),
    enumCheck("request_entry_mode_check", t.entryMode, REQUEST_ENTRY_MODES),
    enumCheck("request_channel_check", t.channel, INTAKE_CHANNELS),
    jsonObjectCheck("request_attributes_check", t.attributes),
  ],
);

/** Append-only and monthly range-partitioned on `at`. */
export const requestEvent = work.table(
  "request_event",
  {
    id: uuid("id")
      .notNull()
      .default(sql`uuidv7()`),
    requestId: uuid("request_id")
      .notNull()
      .references(() => request.id),
    at: ts("at").notNull().defaultNow(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    eventType: text("event_type").notNull(),
    fromStepId: uuid("from_step_id"),
    toStepId: uuid("to_step_id"),
    detailEn: text("detail_en"),
    detailAr: text("detail_ar"),
    /** The attribute values the action supplied (D314). */
    attributes: jsonb("attributes").$type<Record<string, string>>(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.at], name: "request_event_pk" }),
    index("request_event_request_idx").on(t.requestId, t.at),
    index("request_event_actor_idx").on(t.actorId),
    enumCheck("request_event_actor_check", t.actorType, PRINCIPAL_TYPES),
    enumCheck("request_event_type_check", t.eventType, REQUEST_EVENT_TYPES),
    jsonObjectCheck("request_event_attributes_check", t.attributes),
  ],
);

export const attachment = work.table(
  "attachment",
  {
    id: id(),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    fileName: text("file_name").notNull(),
    contentRef: text("content_ref").notNull(),
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => person.id),
    ...audited,
  },
  (t) => [
    index("attachment_owner_idx").on(t.ownerType, t.ownerId),
    enumCheck("attachment_owner_check", t.ownerType, ATTACHMENT_OWNERS),
  ],
);

/* --------------------------------------------------------------- section 7: work items */

export const workItem = work.table(
  "work_item",
  {
    id: id(),
    key: text("key").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    type: text("type").notNull().default("Task"),
    ...bilingualTitle,
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    status: text("status").notNull().default("Backlog"),
    priority: text("priority").notNull().default("Medium"),
    assigneeType: text("assignee_type").notNull().default("None"),
    assigneeId: uuid("assignee_id"),
    reviewerType: text("reviewer_type"),
    reviewerId: uuid("reviewer_id"),
    dueAt: ts("due_at"),
    parentWorkItemId: uuid("parent_work_item_id"),
    requestId: uuid("request_id").references(() => request.id),
    requestTypeVersionId: uuid("request_type_version_id").references(() => requestTypeVersion.id),
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    originType: text("origin_type").notNull().default("Manual"),
    originId: uuid("origin_id"),
    blockedReasonEn: text("blocked_reason_en"),
    blockedReasonAr: text("blocked_reason_ar"),
    completedAt: ts("completed_at"),
    searchKey: searchKey("search_key", "title_en", "title_ar", "key"),
    ...audited,
  },
  (t) => [
    uniqueIndex("work_item_key_key").on(t.key),
    index("work_item_project_idx").on(t.projectId, t.status),
    index("work_item_assignee_idx").on(t.assigneeType, t.assigneeId),
    index("work_item_parent_idx").on(t.parentWorkItemId),
    index("work_item_due_idx").on(t.dueAt),
    index("work_item_created_idx").on(t.createdAt.desc(), t.key.desc()),
    index("work_item_status_created_idx").on(t.status, t.createdAt.desc(), t.key.desc()),
    index("work_item_reviewer_idx").on(t.reviewerId),
    index("work_item_created_by_idx").on(t.createdBy),
    trigramIndex("work_item_search_idx", t.searchKey),
    jsonbIndex("work_item_attributes_idx", t.attributes),
    foreignKey({ columns: [t.parentWorkItemId], foreignColumns: [t.id], name: "work_item_parent_fk" }),
    enumCheck("work_item_type_check", t.type, WORK_ITEM_TYPES),
    enumCheck("work_item_status_check", t.status, WORK_ITEM_STATUSES),
    enumCheck("work_item_priority_check", t.priority, PRIORITIES),
    enumCheck("work_item_assignee_check", t.assigneeType, ASSIGNEE_TYPES),
    principalTypeCheck("work_item_reviewer_check", t.reviewerType),
    enumCheck("work_item_origin_check", t.originType, WORK_ITEM_ORIGINS),
    jsonObjectCheck("work_item_attributes_check", t.attributes),
    // Section 23 rule 1 is enforced by the sub-item trigger in 02-integrity.sql, which needs
    // the parent row; this check keeps the shape the trigger relies on.
    rowCheck("work_item_sub_item_check", `("type" <> 'SubItem') or ("parent_work_item_id" is not null)`),
  ],
);

/** Append-only and monthly range-partitioned on `at`. */
export const workItemActivity = work.table(
  "work_item_activity",
  {
    id: uuid("id")
      .notNull()
      .default(sql`uuidv7()`),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItem.id),
    at: ts("at").notNull().defaultNow(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    eventType: text("event_type").notNull(),
    detailEn: text("detail_en"),
    detailAr: text("detail_ar"),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.at], name: "work_item_activity_pk" }),
    index("work_item_activity_item_idx").on(t.workItemId, t.at),
    enumCheck("work_item_activity_actor_check", t.actorType, PRINCIPAL_TYPES),
    enumCheck("work_item_activity_type_check", t.eventType, WORK_ITEM_ACTIVITY_TYPES),
  ],
);

export const savedView = work.table(
  "saved_view",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    screen: text("screen").notNull(),
    filterJson: jsonb("filter_json").notNull().$type<Record<string, unknown>>(),
    ...audited,
  },
  (t) => [
    uniqueIndex("saved_view_key").on(t.personId, t.screen, t.name),
    enumCheck("saved_view_screen_check", t.screen, SAVED_VIEW_SCREENS),
    jsonObjectCheck("saved_view_filter_check", t.filterJson),
  ],
);

/* ------------------------------------------------- section 8: scheduled work items */

export const scheduledWorkItem = work.table(
  "scheduled_work_item",
  {
    id: id(),
    ...bilingualTitle,
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    createsWorkItemType: text("creates_work_item_type"),
    createsRequestTypeId: uuid("creates_request_type_id").references(() => requestType.id),
    audienceType: text("audience_type").notNull(),
    audienceId: uuid("audience_id").notNull(),
    repeats: text("repeats").notNull(),
    eventName: text("event_name"),
    startDate: text("start_date"),
    timeOfDay: text("time_of_day"),
    timeZone: text("time_zone").notNull().default("Asia/Dubai"),
    skipHolidaysAndWeekends: boolean("skip_holidays_and_weekends").notNull().default(true),
    instructionsEn: text("instructions_en"),
    instructionsAr: text("instructions_ar"),
    status: text("status").notNull().default("Active"),
    temporalScheduleId: text("temporal_schedule_id"),
    nextRunAt: ts("next_run_at"),
    ...audited,
  },
  (t) => [
    index("scheduled_work_item_project_idx").on(t.projectId),
    uniqueIndex("scheduled_work_item_temporal_key").on(t.temporalScheduleId),
    enumCheck("scheduled_work_item_repeats_check", t.repeats, SCHEDULE_REPEATS),
    enumCheck("scheduled_work_item_status_check", t.status, SCHEDULE_STATUSES),
    enumCheck("scheduled_work_item_audience_check", t.audienceType, ["Agent", "Person", "Group"]),
    optionalEnumCheck("scheduled_work_item_creates_check", t.createsWorkItemType, WORK_ITEM_TYPES),
    rowCheck(
      "scheduled_work_item_creates_one_check",
      `("creates_work_item_type" is not null) <> ("creates_request_type_id" is not null)`,
    ),
    rowCheck("scheduled_work_item_event_check", `("repeats" <> 'OnEvent') or ("event_name" is not null)`),
  ],
);

export const scheduleRun = work.table(
  "schedule_run",
  {
    id: id(),
    scheduledWorkItemId: uuid("scheduled_work_item_id")
      .notNull()
      .references(() => scheduledWorkItem.id, { onDelete: "cascade" }),
    firedAt: ts("fired_at").notNull().defaultNow(),
    outcome: text("outcome").notNull(),
    createdWorkItemId: uuid("created_work_item_id").references(() => workItem.id),
    createdRequestId: uuid("created_request_id").references(() => request.id),
    error: text("error"),
    ...audited,
  },
  (t) => [
    index("schedule_run_schedule_idx").on(t.scheduledWorkItemId, t.firedAt),
    enumCheck("schedule_run_outcome_check", t.outcome, SCHEDULE_RUN_OUTCOMES),
  ],
);

/* ------------------------------------------------- section 9: artifacts and files */

export const artifact = work.table(
  "artifact",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    ...bilingualName,
    producedByType: text("produced_by_type").notNull(),
    producedById: uuid("produced_by_id"),
    runId: uuid("run_id"),
    linkedToType: text("linked_to_type"),
    linkedToId: uuid("linked_to_id"),
    status: text("status").notNull().default("Active"),
    currentVersionId: uuid("current_version_id"),
    searchKey: searchKey("search_key", "name_en", "name_ar"),
    ...audited,
  },
  (t) => [
    index("artifact_project_idx").on(t.projectId),
    index("artifact_linked_idx").on(t.linkedToType, t.linkedToId),
    index("artifact_created_idx").on(t.createdAt.desc(), t.id.desc()),
    trigramIndex("artifact_search_idx", t.searchKey),
    enumCheck("artifact_producer_check", t.producedByType, PRODUCER_TYPES),
    enumCheck("artifact_status_check", t.status, ARTIFACT_STATUSES),
    optionalEnumCheck("artifact_linked_check", t.linkedToType, ARTIFACT_LINK_TYPES),
  ],
);

export const artifactVersion = work.table(
  "artifact_version",
  {
    id: id(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    contentRef: text("content_ref").notNull(),
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    ...audited,
  },
  (t) => [uniqueIndex("artifact_version_key").on(t.artifactId, t.versionNumber)],
);

export const projectFile = work.table(
  "project_file",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    name: text("name").notNull(),
    contentRef: text("content_ref").notNull(),
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => person.id),
    scopeOfUse: text("scope_of_use").notNull().default("AllProject"),
    status: text("status").notNull().default("Active"),
    linkedToType: text("linked_to_type"),
    linkedToId: uuid("linked_to_id"),
    searchKey: searchKey("search_key", "name"),
    ...audited,
  },
  (t) => [
    index("project_file_project_idx").on(t.projectId),
    index("project_file_created_idx").on(t.createdAt.desc(), t.id.desc()),
    trigramIndex("project_file_search_idx", t.searchKey),
    enumCheck("project_file_scope_check", t.scopeOfUse, FILE_SCOPES_OF_USE),
    enumCheck("project_file_status_check", t.status, FILE_STATUSES),
    optionalEnumCheck("project_file_linked_check", t.linkedToType, ARTIFACT_LINK_TYPES),
  ],
);

/** Used when `scope_of_use` is `Selected`; the server checks it before signing a URL. */
export const fileAccessGrant = work.table(
  "file_access_grant",
  {
    fileId: uuid("file_id")
      .notNull()
      .references(() => projectFile.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: uuid("principal_id").notNull(),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.fileId, t.principalType, t.principalId], name: "file_access_grant_pk" }),
    enumCheck("file_access_grant_principal_check", t.principalType, PRINCIPAL_TYPES),
  ],
);

/**
 * A comment thread on one dashboard card (handoff v2 section 5).
 *
 * The thread is the card, not a copy of it: there is one dashboard, so one thread per
 * commentable card, created the first time somebody writes on it. Everything a reader
 * needs — who said what, what they pointed at, who they meant — hangs off here, which is
 * what makes a mention reach the person mentioned rather than only the browser that typed
 * it.
 */
export const cardCommentThread = work.table(
  "card_comment_thread",
  {
    id: id(),
    cardId: text("card_id").notNull(),
    /** Denormalised so the Inbox can order threads without reading every message. */
    lastMessageAt: ts("last_message_at").notNull().defaultNow(),
    ...audited,
  },
  (t) => [
    uniqueIndex("card_comment_thread_card_key").on(t.cardId),
    enumCheck("card_comment_thread_card_check", t.cardId, COMMENTABLE_CARDS),
  ],
);

/**
 * One comment. A deleted comment keeps its row: the conversation around it still reads in
 * order, and "you deleted this comment" is what the thread shows in its place.
 */
export const cardComment = work.table(
  "card_comment",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => cardCommentThread.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => person.id),
    bodyText: text("body_text").notNull().default(""),
    /** The captured area of the card, as `bucket/key` the way `putObject` returned it. */
    captureRef: text("capture_ref"),
    editedAt: ts("edited_at"),
    deletedAt: ts("deleted_at"),
    /** The work item "Make it a task" raised from this comment, while it exists. */
    workItemId: uuid("work_item_id").references(() => workItem.id, { onDelete: "set null" }),
    ...audited,
  },
  (t) => [
    index("card_comment_thread_idx").on(t.threadId, t.createdAt),
    index("card_comment_work_item_idx").on(t.workItemId),
    // A comment is text, a picture, or both. The empty one only exists once it is deleted.
    rowCheck(
      "card_comment_content_check",
      `("deleted_at" is not null) or ("body_text" <> '') or ("capture_ref" is not null)`,
    ),
  ],
);

/**
 * Who a comment named. Written at the same time as the comment, so "will notify" and what
 * actually reaches the Inbox are the same list rather than two readings of the same text.
 */
export const cardCommentMention = work.table(
  "card_comment_mention",
  {
    id: id(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => cardComment.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    readAt: ts("read_at"),
    ...audited,
  },
  (t) => [
    uniqueIndex("card_comment_mention_key").on(t.commentId, t.personId),
    index("card_comment_mention_person_idx").on(t.personId, t.readAt),
  ],
);

/**
 * How far one person has read one thread. Unread is a fact about a reader, not about a
 * thread, so it cannot live on the thread: two people looking at the same card have
 * different answers.
 */
export const cardCommentRead = work.table(
  "card_comment_read",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => cardCommentThread.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    lastReadAt: ts("last_read_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.personId], name: "card_comment_read_pk" })],
);
