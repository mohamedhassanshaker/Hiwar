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
import { organizations as orgUnit, users as person } from "./hiwar";
import {
  ASSIGNEE_TYPES,
  ATTACHMENT_OWNERS,
  CONTEXT_HANDOFF_OWNERS,
  DECOMPOSITIONS,
  ENTRY_MODES,
  INTAKE_CHANNELS,
  PRIORITIES,
  PRINCIPAL_TYPES,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  REQUESTER_TYPES,
  REQUEST_ENTRY_MODES,
  REQUEST_TYPE_VERSION_STATUSES,
  ROOM_ROLES,
  ROOM_SOURCES,
  ROOM_STATUSES,
  ROOM_TYPES,
  SENSITIVITIES,
  SLA_UNITS,
  TURN_TAKINGS,
  WORK_ITEM_ORIGINS,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
} from "./enums";

/**
 * The TAWP work-domain tables the AI capabilities join to: projects, discussion rooms, requests
 * and work items. Hiwar has none of these screens, so the tables stay empty; they exist so the
 * module's queries run unchanged and return nothing for those links.
 */
export const work = pgSchema("work");

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
    currentStepId: uuid("current_step_id"),
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

