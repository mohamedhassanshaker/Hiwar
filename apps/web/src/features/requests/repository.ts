import { and, asc, desc, eq, gte, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import { containsTerm } from "@/db/search";
import { finalStatus, NO_NOTICES, queueFinishedNotices, queueRequestNotices } from "@/db/queries/mail";

/**
 * The step whose audiences a request at `step` answers to (D217): the step of the same name in
 * the newest published version of its request type, so an audience added after the request was
 * raised applies to it; the request's own step when that version has no step by that name.
 * Only the audiences follow: routing stays the pinned version's.
 */
function audienceStepOf(step: SQL): SQL {
  return sql`coalesce((
    select latest.id from work.transition_step pinned
      join work.request_type_version pv on pv.id = pinned.request_type_version_id
      join work.request_type_version lv on lv.request_type_id = pv.request_type_id and lv.status = 'Published'
      join work.transition_step latest on latest.request_type_version_id = lv.id and latest.name_en = pinned.name_en
     where pinned.id = ${step}
     order by lv.version_number desc
     limit 1
  ), ${step})`;
}
import { assertWritten } from "@/lib/concurrency";
import { humanSize } from "@/lib/utils";
import { announce } from "@/lib/notify";
import { ruleLabel, type Rule } from "./routing";
import { formatSla, type AttributeDefinition, type Request, type RequestDetail, type RequestStep, type RequestType, type RequestFilters, type RequestInquiry, type RequestInquiryOptions, type RequestInquiryRow, type RequestReportNode, type RequestReportWorkItem, type RequestTypeDetail, type SlaUnit } from "./types";

/** The only module in `requests` that touches Drizzle. */

/** The prototype writes the intake channels as one readable list. */
const CHANNEL_LABEL: Record<string, string> = { Console: "Console", Teams: "Teams", Email: "Email", Widget: "Widget", WhatsApp: "WhatsApp", Api: "API" };

const openCount = sql<number>`(
  select count(*) from work.request rq
  join work.request_type_version rtv on rtv.id = rq.request_type_version_id
  where rtv.request_type_id = ${s.requestType.id} and rq.status not in ('Completed', 'Rejected')
)::int`;

/** What every reader of an attribute definition selects, so the readers cannot drift apart. */
const attributeColumns = {
  key: s.attributeDefinition.key,
  labelEn: s.attributeDefinition.labelEn,
  labelAr: s.attributeDefinition.labelAr,
  dataType: s.attributeDefinition.dataType,
  required: s.attributeDefinition.required,
  enumValues: s.attributeDefinition.enumValues,
  stepName: sql<string | null>`(select ts.name_en from work.transition_step ts where ts.id = ${outer(s.attributeDefinition.stepId)})`,
};

/**
 * One row per type: its published version while it has one, its draft before it is first
 * published. A version that has been superseded is not a type of its own.
 */
export async function listRequestTypes(): Promise<RequestType[]> {
  const rows = await dbRo()
    .select({
      c: s.requestType.code,
      n: s.requestType.nameEn,
      nAr: s.requestType.nameAr,
      cat: s.requestType.categoryEn,
      versionNumber: s.requestTypeVersion.versionNumber,
      st: s.requestTypeVersion.status,
      channels: s.requestTypeVersion.intakeChannels,
      dec: s.requestTypeVersion.decomposition,
      slaValue: s.requestTypeVersion.slaValue,
      slaUnit: s.requestTypeVersion.slaUnit,
      open: openCount,
      p: s.project.key,
    })
    .from(s.requestType)
    .innerJoin(
      s.requestTypeVersion,
      eq(
        s.requestTypeVersion.id,
        sql`coalesce(${s.requestType.currentPublishedVersionId}, (
          select v.id from work.request_type_version v
           where v.request_type_id = ${s.requestType.id} and v.status = 'Draft'
           order by v.version_number desc limit 1
        ))`,
      ),
    )
    .leftJoin(s.project, eq(s.project.id, s.requestTypeVersion.defaultProjectId))
    .orderBy(asc(s.requestType.code));

  return rows.map((row) => ({
    c: row.c,
    n: row.n,
    nAr: row.nAr,
    cat: row.cat ?? "",
    v: `v${row.versionNumber}`,
    st: row.st,
    ch: (row.channels ?? []).map((channel) => CHANNEL_LABEL[channel] ?? channel).join(", "),
    dec: row.dec.toLowerCase(),
    sla: formatSla(row.slaValue, row.slaUnit),
    open: row.open,
    p: row.p ?? "",
  }));
}

/**
 * One page of the top-level requests a person may see (`UC-27.1-05`), newest first, with how
 * many match (D349). Visibility, the filters, the order and the page are all decided here, so
 * a list of any size costs one page and one count.
 */
export async function listRequestPage(
  visibleIds: string[] | null,
  personId: string,
  filters: RequestFilters,
  page: { limit: number; offset: number },
): Promise<{ rows: Request[]; total: number }> {
  const inProjects = visibleIds === null ? undefined : visibleIds.length > 0 ? inArray(s.request.projectId, visibleIds) : sql`false`;
  const where = and(
    // A key names one request, a sub-request too (D388: its report); the list itself is top-level.
    filters.key ? undefined : isNull(s.request.parentRequestId),
    inProjects ? or(inProjects, await ownRequest(personId)) : undefined,
    filters.key ? eq(s.request.key, filters.key) : undefined,
    filters.q ? containsTerm(s.request.searchKey, filters.q) : undefined,
    filters.projectKey ? eq(s.project.key, filters.projectKey) : undefined,
    filters.requester === "ext"
      ? sql`${s.request.requesterType} <> 'Person'`
      : filters.requester
        ? and(eq(s.request.requesterType, "Person"), eq(s.request.requesterId, filters.requester))
        : undefined,
    filters.typeCode ? eq(s.requestType.code, filters.typeCode) : undefined,
    filters.status ? eq(s.request.status, filters.status) : undefined,
    filters.submittedFrom ? sql`${s.request.submittedAt} >= ${filters.submittedFrom}` : undefined,
    filters.submittedBefore ? sql`${s.request.submittedAt} < ${filters.submittedBefore}` : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    dbRo()
      .select({
        k: s.request.key,
        t: s.request.titleEn,
        tAr: s.request.titleAr,
        ty: s.requestType.code,
        p: s.project.key,
        requesterType: s.request.requesterType,
        requesterId: s.request.requesterId,
        st: s.request.status,
        submittedAt: s.request.submittedAt,
        createdAt: s.request.createdAt,
        ch: s.request.channel,
        mode: s.request.entryMode,
      })
      .from(s.request)
      .innerJoin(s.project, eq(s.project.id, s.request.projectId))
      .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
      .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
      .where(where)
      .orderBy(desc(s.request.createdAt), desc(s.request.key))
      .limit(page.limit)
      .offset(page.offset),
    dbRo()
      .select({ total: sql<number>`count(*)::int` })
      .from(s.request)
      .innerJoin(s.project, eq(s.project.id, s.request.projectId))
      .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
      .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
      .where(where),
  ]);

  return {
    total: counted?.total ?? 0,
    rows: rows.map((row) => ({
      k: row.k,
      t: row.t,
      tAr: row.tAr,
      ty: row.ty,
      p: row.p,
      by: row.requesterType === "Person" ? (row.requesterId ?? "ext") : "ext",
      st: row.st,
      submittedAt: (row.submittedAt ?? row.createdAt ?? new Date()).toISOString(),
      ch: CHANNEL_LABEL[row.ch] ?? row.ch,
      mode: row.mode === "Agentic" ? "agent" : "form",
    })),
  };
}

/** The transition steps of one request type version, with audiences and routing rules. */
async function stepsOf(versionId: string): Promise<RequestStep[]> {
  const steps = await dbRo()
    .select({
      id: s.transitionStep.id,
      n: s.transitionStep.nameEn,
      nAr: s.transitionStep.nameAr,
      sortOrder: s.transitionStep.sortOrder,
      isTerminal: s.transitionStep.isTerminal,
      terminalOutcome: s.transitionStep.terminalOutcome,
      slaValue: s.transitionStep.slaValue,
      slaUnit: s.transitionStep.slaUnit,
    })
    .from(s.transitionStep)
    .where(eq(s.transitionStep.requestTypeVersionId, versionId))
    .orderBy(asc(s.transitionStep.sortOrder));
  if (steps.length === 0) return [];

  const stepIds = steps.map((step) => step.id);

  const audiences = await dbRo()
    .select({
      stepId: s.stepAudience.stepId,
      principalType: s.stepAudience.principalType,
      access: s.stepAudience.access,
      sequence: s.stepAudience.sequence,
      agentName: s.agent.nameEn,
      agentNameAr: s.agent.nameAr,
      groupName: s.group.nameEn,
      groupNameAr: s.group.nameAr,
      roleName: s.role.nameEn,
      roleNameAr: s.role.nameAr,
      personName: s.person.nameEn,
      personNameAr: s.person.nameAr,
    })
    .from(s.stepAudience)
    .leftJoin(s.agent, eq(s.agent.id, s.stepAudience.principalId))
    .leftJoin(s.group, eq(s.group.id, s.stepAudience.principalId))
    .leftJoin(s.role, eq(s.role.id, s.stepAudience.principalId))
    .leftJoin(s.person, eq(s.person.id, s.stepAudience.principalId))
    .where(inArray(s.stepAudience.stepId, stepIds))
    // The id is a UUIDv7, so audiences without a sequence read in the order they were added.
    .orderBy(asc(s.stepAudience.sequence), asc(s.stepAudience.id));

  const rules = await dbRo()
    .select({
      fromStepId: s.routingRule.fromStepId,
      kind: s.routingRule.kind,
      expression: s.routingRule.expression,
      actionName: s.routingRule.actionName,
      toStepName: sql<string>`(select ts.name_en from work.transition_step ts where ts.id = ${outer(s.routingRule.toStepId)})`,
      sortOrder: s.routingRule.sortOrder,
    })
    .from(s.routingRule)
    .where(inArray(s.routingRule.fromStepId, stepIds))
    .orderBy(asc(s.routingRule.sortOrder));

  return steps.map((step) => ({
    n: step.n,
    nAr: step.nAr,
    isTerminal: step.isTerminal,
    terminalOutcome: step.terminalOutcome,
    slaValue: step.slaValue,
    slaUnit: step.slaUnit as SlaUnit | null,
    aud: audiences
      .filter((audience) => audience.stepId === step.id)
      .map<[string, string, string]>((audience) => {
        // Every principal an audience may name, the requester included, reads as a name (D164).
        const requester = audience.principalType === "Requester";
        const en = requester ? "Requester" : (audience.agentName ?? audience.groupName ?? audience.roleName ?? audience.personName ?? "");
        const ar = requester ? "مقدم الطلب" : (audience.agentNameAr ?? audience.groupNameAr ?? audience.roleNameAr ?? audience.personNameAr ?? "");
        const suffix = audience.principalType === "Agent" ? " (agent)" : audience.sequence ? " (sequential)" : "";
        // `UC-30.2-02`: the step lists each audience with what it may do there.
        return [en + suffix, ar + suffix, audience.access];
      }),
    out: rules
      .filter((rule) => rule.fromStepId === step.id)
      .map<[string, string, string]>((rule) => {
        const label = ruleLabel(rule);
        return [label, label, rule.toStepName];
      }),
  }));
}

/**
 * One request type's version, as a screen shows it.
 *
 * `prefer` decides which version when a type has both: the designer edits the draft, and
 * everything else reads what is published. Without the choice the screens would disagree
 * about what the type is.
 */
export async function readRequestTypeDetail(
  code: string,
  prefer: "published" | "draft" = "published",
): Promise<RequestTypeDetail | null> {
  const wanted = prefer === "draft" ? "Draft" : "Published";
  const rows = await dbRo()
    .select({ id: s.requestTypeVersion.id, status: s.requestTypeVersion.status })
    .from(s.requestTypeVersion)
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .where(eq(s.requestType.code, code))
    .orderBy(desc(s.requestTypeVersion.versionNumber));
  const row = rows.find((candidate) => candidate.status === wanted) ?? rows[0];
  return row ? readVersionDetail(row.id) : null;
}

/**
 * One version of a request type, by its id.
 *
 * Publishing judges the version it is about to publish, which is not the one a code and a
 * preference resolve to while another version is live.
 */
export async function readVersionDetail(versionId: string): Promise<RequestTypeDetail | null> {
  const [row] = await dbRo()
    .select({
      id: s.requestTypeVersion.id,
      code: s.requestType.code,
      version: s.requestTypeVersion.versionNumber,
      status: s.requestTypeVersion.status,
      defaultProject: s.project.key,
      intakeChannels: s.requestTypeVersion.intakeChannels,
      entryModes: s.requestTypeVersion.entryModes,
      decomposition: s.requestTypeVersion.decomposition,
      slaValue: s.requestTypeVersion.slaValue,
      slaUnit: s.requestTypeVersion.slaUnit,
    })
    .from(s.requestTypeVersion)
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .leftJoin(s.project, eq(s.project.id, s.requestTypeVersion.defaultProjectId))
    .where(eq(s.requestTypeVersion.id, versionId))
    .limit(1);
  if (!row) return null;

  return {
    code: row.code,
    version: row.version,
    status: row.status,
    steps: await stepsOf(row.id),
    attributes: await attributesOfVersion(row.id),
    defaultProject: row.defaultProject,
    intakeChannels: row.intakeChannels ?? [],
    entryModes: row.entryModes ?? [],
    decomposition: row.decomposition,
    slaValue: row.slaValue,
    slaUnit: row.slaUnit as SlaUnit | null,
  };
}

/**
 * One request as its detail screen shows it: the type version's steps and the current step's
 * position among them, attributes and their definitions, attachments, history (latest first),
 * sub requests, work items and parent. `null` when no request has the key.
 */
export async function readRequestDetail(key: string): Promise<RequestDetail | null> {
  const [row] = await dbRo()
    .select({
      id: s.request.id,
      key: s.request.key,
      descEn: s.request.descriptionEn,
      descAr: s.request.descriptionAr,
      attributes: s.request.attributes,
      versionId: s.requestTypeVersion.id,
      versionNumber: s.requestTypeVersion.versionNumber,
      typeName: s.requestType.nameEn,
      // The tracker draws the steps in order and marks one of them, so what it needs is the
      // position in that list rather than the stored sort order, which need not start at 0.
      currentStepOrder: sql<number | null>`(
        select count(*) from work.transition_step ts
        where ts.request_type_version_id = ${s.request.requestTypeVersionId}
          and ts.sort_order < (select own.sort_order from work.transition_step own where own.id = ${outer(s.request.currentStepId)})
      )::int`,
      dueAt: s.request.dueAt,
      parentKey: sql<string | null>`(select pr.key from work.request pr where pr.id = ${outer(s.request.parentRequestId)})`,
    })
    .from(s.request)
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .where(eq(s.request.key, key))
    .limit(1);
  if (!row) return null;

  const [attachments, history, subRequests, workItems] = await Promise.all([
    dbRo()
      .select({ fileName: s.attachment.fileName, size: s.attachment.size })
      .from(s.attachment)
      .where(eq(s.attachment.ownerId, row.id)),
    dbRo()
      .select({
        at: s.requestEvent.at,
        actorType: s.requestEvent.actorType,
        actorPerson: s.person.id,
        actorAgent: s.agent.code,
        detailEn: s.requestEvent.detailEn,
        detailAr: s.requestEvent.detailAr,
        attributes: s.requestEvent.attributes,
      })
      .from(s.requestEvent)
      .leftJoin(s.person, eq(s.person.id, s.requestEvent.actorId))
      .leftJoin(s.agent, eq(s.agent.id, s.requestEvent.actorId))
      .where(eq(s.requestEvent.requestId, row.id))
      // D315: the latest first.
      .orderBy(desc(s.requestEvent.at)),
    dbRo()
      .select({ k: s.request.key, t: s.request.titleEn, tAr: s.request.titleAr, st: s.request.status })
      .from(s.request)
      .where(eq(s.request.parentRequestId, row.id))
      .orderBy(asc(s.request.key)),
    dbRo()
      .select({
        k: s.workItem.key,
        t: s.workItem.titleEn,
        tAr: s.workItem.titleAr,
        st: s.workItem.status,
        assigneeType: s.workItem.assigneeType,
        assigneePerson: s.person.id,
        assigneeAgent: s.agent.code,
      })
      .from(s.workItem)
      .leftJoin(s.person, eq(s.person.id, s.workItem.assigneeId))
      .leftJoin(s.agent, eq(s.agent.id, s.workItem.assigneeId))
      .where(eq(s.workItem.requestId, row.id))
      .orderBy(asc(s.workItem.key)),
  ]);

  return {
    key: row.key,
    descEn: row.descEn ?? "",
    descAr: row.descAr ?? "",
    steps: await stepsOf(row.versionId),
    currentStep: row.currentStepOrder ?? 0,
    // `UC-29.1-06`: the same four hours the dashboard's "SLA at risk" card counts, so a
    // request flagged on one screen is flagged on the other.
    slaAtRisk: row.dueAt !== null && row.dueAt.getTime() - Date.now() < 4 * 60 * 60 * 1000,
    attributes: Object.entries((row.attributes as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)]),
    fields: await attributesOfVersion(row.versionId),
    schemaLabel: `${row.typeName} v${row.versionNumber}`,
    dueAt: row.dueAt?.toISOString() ?? null,
    attachments: attachments.map<[string, string]>((file) => [file.fileName, humanSize(file.size)]),
    history: history.map((entry) => ({
      at: entry.at.toISOString(),
      who: (entry.actorType === "Agent" ? entry.actorAgent : entry.actorPerson) ?? "",
      detailEn: entry.detailEn ?? "",
      detailAr: entry.detailAr ?? "",
      attributes: entry.attributes ? Object.entries(entry.attributes).map<[string, string]>(([k, v]) => [k, String(v)]) : null,
    })),
    subRequests,
    workItems: workItems.map((item) => ({
      k: item.k,
      t: item.t,
      tAr: item.tAr,
      who: (item.assigneeType === "Agent" ? item.assigneeAgent : item.assigneePerson) ?? "",
      st: item.st,
    })),
    parent: row.parentKey,
  };
}

/** What converting a request into a discussion room posts on its board. */
export type RequestRoomSummary = {
  titleEn: string;
  titleAr: string;
  descEn: string | null;
  status: string;
  projectKey: string;
  typeNameEn: string;
};

/** The title, description, status, project and type of a request, or `null` when there is none. */
export async function requestRoomSummary(key: string): Promise<RequestRoomSummary | null> {
  const [row] = await dbRo()
    .select({
      titleEn: s.request.titleEn,
      titleAr: s.request.titleAr,
      descEn: s.request.descriptionEn,
      status: s.request.status,
      projectKey: s.project.key,
      typeNameEn: s.requestType.nameEn,
    })
    .from(s.request)
    .innerJoin(s.project, eq(s.project.id, s.request.projectId))
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .where(eq(s.request.key, key))
    .limit(1);
  return row ?? null;
}

/** The attribute definitions of one version, in their order. */
export async function attributesOfVersion(versionId: string): Promise<AttributeDefinition[]> {
  return dbRo()
    .select(attributeColumns)
    .from(s.attributeDefinition)
    .where(eq(s.attributeDefinition.requestTypeVersionId, versionId))
    .orderBy(asc(s.attributeDefinition.sortOrder), asc(s.attributeDefinition.id));
}

/** The attribute definitions of the version a request would pin, for validation. */
export async function attributeDefinitionsOf(code: string): Promise<AttributeDefinition[]> {
  return dbRo()
    .select(attributeColumns)
    .from(s.attributeDefinition)
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.attributeDefinition.requestTypeVersionId))
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    // A request pins the published version, so a draft's attributes are not what it is
    // validated against. Without this a half-designed draft would reject real requests.
    .where(and(eq(s.requestType.code, code), eq(s.requestTypeVersion.id, s.requestType.currentPublishedVersionId)))
    .orderBy(asc(s.attributeDefinition.sortOrder), asc(s.attributeDefinition.id));
}

/** The next request key in the `REQ-` sequence. */
async function nextRequestKey(): Promise<string> {
  const { rows } = await db().execute<{ next: number }>(sql`
    select coalesce(max(substring(key from '[0-9]+$')::int), 9000) + 1 as next from work.request
  `);
  return `REQ-${rows[0]?.next ?? 9001}`;
}

export type NewRequest = {
  projectKey: string;
  requestTypeCode: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  entryMode: string;
  attributes: Record<string, string>;
  requesterId: string;
  /** An external contact raises a request from a channel or the embedded widget. */
  requesterType?: string;
  channel?: string;
  /** The request this one is a sub request of. */
  parentRequestId?: string | null;
  /** The discussion room it was raised from, for a request made out of a room message. */
  originRoomId?: string | null;
};

/** The row id of the discussion room with this key, or null when there is none. */
export async function roomIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.discussionRoom.id }).from(s.discussionRoom).where(eq(s.discussionRoom.key, key)).limit(1);
  return row?.id ?? null;
}

/**
 * Specification 8.2: a request pins the published version of its type, so a later change
 * to the type never moves a request that is already in flight.
 */
export async function createRequest(input: NewRequest): Promise<string> {
  const key = await nextRequestKey();
  const queued = await db().transaction(async (tx) => {
    const [project] = await tx.select({ id: s.project.id }).from(s.project).where(eq(s.project.key, input.projectKey)).limit(1);
    if (!project) throw new Error(`No project ${input.projectKey}.`);
    const [version] = await tx
      .select({ id: s.requestType.currentPublishedVersionId })
      .from(s.requestType)
      .where(eq(s.requestType.code, input.requestTypeCode))
      .limit(1);
    if (!version?.id) throw new Error(`Request type ${input.requestTypeCode} has no published version.`);

    const [firstStep] = await tx
      .select({ id: s.transitionStep.id })
      .from(s.transitionStep)
      .where(eq(s.transitionStep.requestTypeVersionId, version.id))
      .orderBy(asc(s.transitionStep.sortOrder))
      .limit(1);

    const [created] = await tx
      .insert(s.request)
      .values({
        key,
        projectId: project.id,
        requestTypeVersionId: version.id,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionEn,
        requesterType: input.requesterType ?? "Person",
        requesterId: input.requesterId,
        channel: input.channel ?? "Console",
        entryMode: input.entryMode,
        currentStepId: firstStep?.id ?? null,
        status: "Submitted",
        submittedAt: new Date(),
        attributes: input.attributes,
        parentRequestId: input.parentRequestId ?? null,
        originRoomId: input.originRoomId ?? null,
        createdBy: input.requesterType === "ExternalContact" ? null : input.requesterId,
        updatedBy: input.requesterType === "ExternalContact" ? null : input.requesterId,
      })
      .returning({ id: s.request.id });

    const [submitted] = await tx
      .insert(s.requestEvent)
      .values({
        requestId: created.id,
        actorType: input.requesterType ?? "Person",
        actorId: input.requesterId,
        eventType: "Submitted",
        detailEn: "Request submitted.",
        detailAr: "تم تقديم الطلب.",
      })
      .returning({ id: s.requestEvent.id });
    // D247: the requester's receipt. An external contact has no person to email here.
    if ((input.requesterType ?? "Person") !== "Person") return NO_NOTICES;
    return queueRequestNotices(tx, { kind: "RequestCreated", requestId: created.id, outcome: "Submitted", eventId: submitted.id, except: [], actorId: input.requesterId });
  });
  await announce(queued);
  return key;
}

/**
 * Promotes one draft version to the published one of its type.
 *
 * `request_type_version_published_key` allows a type one published version, so the one it
 * supersedes is retired in the same transaction. A request pins the version it was raised
 * under, so retiring the old row changes nothing about requests already in flight.
 */
export async function publishVersion(versionId: string, personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [version] = await tx
      .select({ requestTypeId: s.requestTypeVersion.requestTypeId })
      .from(s.requestTypeVersion)
      .where(eq(s.requestTypeVersion.id, versionId))
      .limit(1);
    assertWritten(version ? [version] : [], "RequestTypeVersion");

    await tx
      .update(s.requestTypeVersion)
      .set({ status: "Retired", updatedAt: new Date(), updatedBy: personId })
      .where(
        and(
          eq(s.requestTypeVersion.requestTypeId, version.requestTypeId),
          eq(s.requestTypeVersion.status, "Published"),
        ),
      );

    const rows = await tx
      .update(s.requestTypeVersion)
      .set({
        status: "Published",
        publishedAt: new Date(),
        publishedBy: personId,
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(eq(s.requestTypeVersion.id, versionId))
      .returning({ id: s.requestTypeVersion.id });
    assertWritten(rows, "RequestTypeVersion");

    await tx
      .update(s.requestType)
      .set({ currentPublishedVersionId: versionId, updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.requestType.id, version.requestTypeId));
  });
}

/** `UC-25.2-02`: the request moves to Completed, with the event that says why. */
export async function completeRequest(key: string, personId: string): Promise<void> {
  const queued = await db().transaction(async (tx) => {
    const rows = await tx
      .update(s.request)
      .set({ status: "Completed", updatedAt: new Date(), updatedBy: personId })
      .where(and(eq(s.request.key, key), sql`${s.request.status} <> 'Completed'`))
      .returning({ id: s.request.id });
    if (rows.length === 0) return NO_NOTICES;

    const [event] = await tx.insert(s.requestEvent).values({
      requestId: rows[0].id,
      actorType: "Person",
      actorId: personId,
      eventType: "ActionTaken",
      detailEn: "every work item of this request is finished",
      detailAr: "اكتملت كل بنود العمل لهذا الطلب",
    }).returning({ id: s.requestEvent.id });
    // D240: the requester is told; the work items finishing it were not their act.
    return queueFinishedNotices(tx, { subjectType: "Request", subjectId: rows[0].id, outcome: "Completed", eventId: event.id, except: [], actorId: personId });
  });
  await announce(queued);
}

/** The codes behind the ids a schedule stores, so a firing can use the ordinary path. */
export async function codesForSchedule(input: { requestTypeId: string; projectId: string }): Promise<{
  requestTypeCode: string;
  projectKey: string;
} | null> {
  const [type] = await dbRo().select({ code: s.requestType.code }).from(s.requestType).where(eq(s.requestType.id, input.requestTypeId)).limit(1);
  const [project] = await dbRo().select({ key: s.project.key }).from(s.project).where(eq(s.project.id, input.projectId)).limit(1);
  if (!type || !project) return null;
  return { requestTypeCode: type.code, projectKey: project.key };
}

/** Whether a request still exists, read on the primary so a delete just made is seen. */
export async function requestExists(id: string): Promise<boolean> {
  const [row] = await db().select({ id: s.request.id }).from(s.request).where(eq(s.request.id, id)).limit(1);
  return Boolean(row);
}

/** The key of a request by its row id, or null when it is gone. Primary, as a run's end reads it. */
export async function requestKeyOf(id: string): Promise<string | null> {
  const [row] = await db().select({ key: s.request.key }).from(s.request).where(eq(s.request.id, id)).limit(1);
  return row?.key ?? null;
}

/** Whether anyone took a step action on, returned or rejected the request since `since` (D385). */
export async function requestMovedSince(id: string, since: Date): Promise<boolean> {
  const [row] = await db()
    .select({ id: s.requestEvent.id })
    .from(s.requestEvent)
    .where(
      and(
        eq(s.requestEvent.requestId, id),
        gte(s.requestEvent.at, since),
        inArray(s.requestEvent.eventType, ["ActionTaken", "Returned"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The row id of a request, so a firing can record what it created. */
export async function requestIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.request.id }).from(s.request).where(eq(s.request.key, key)).limit(1);
  return row?.id ?? null;
}

/** The row id and project of a request, or `null` when no request has the key. */
export async function requestScopeByKey(key: string): Promise<{ id: string; projectId: string } | null> {
  const [row] = await dbRo()
    .select({ id: s.request.id, projectId: s.request.projectId })
    .from(s.request)
    .where(eq(s.request.key, key))
    .limit(1);
  return row ?? null;
}

/** The row id of a project, or `null` when no project has the key. */
export async function projectIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.project.id }).from(s.project).where(eq(s.project.key, key)).limit(1);
  return row?.id ?? null;
}

/**
 * What still points at a request and would block deleting it. Its own decision log
 * (`request_event`) is the request's diary rather than something else's reference to it, so
 * it is removed alongside the request instead of being reported here; `channel_message`'s
 * reference is `ON DELETE SET NULL` and so never blocks either.
 */
export async function requestDeleteBlockers(requestId: string): Promise<{
  approvals: number;
  deploymentConversations: number;
  childRequests: number;
  scheduleRuns: number;
  workItems: number;
}> {
  const countIn = (table: string, column: string) =>
    sql<number>`(select count(*) from ${sql.raw(table)} x where x.${sql.raw(column)} = ${outer(s.request.id)})::int`;
  const [row] = await dbRo()
    .select({
      approvals: countIn("ai.approval", "request_id"),
      deploymentConversations: countIn("ai.deployment_conversation", "request_id"),
      childRequests: countIn("work.request", "parent_request_id"),
      scheduleRuns: countIn("work.schedule_run", "created_request_id"),
      workItems: countIn("work.work_item", "request_id"),
    })
    .from(s.request)
    .where(eq(s.request.id, requestId))
    .limit(1);
  return row ?? { approvals: 0, deploymentConversations: 0, childRequests: 0, scheduleRuns: 0, workItems: 0 };
}

/** The request and its own decision log, once nothing else still points at it. */
export async function deleteRequest(requestId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(s.requestEvent).where(eq(s.requestEvent.requestId, requestId));
    await tx.delete(s.request).where(eq(s.request.id, requestId));
  });
}

/**
 * What still uses a request type and would block deleting it: its requests, work items pinned
 * to one of its versions, schedules that raise it, and storyline steps that name it; and, for
 * a delete that takes its requests with it, what points at those requests from outside them
 * (approvals, deployment conversations, child requests of other types, schedule runs, work
 * items). Its own versions, steps, audiences, rules and attributes go with it.
 */
export async function requestTypeDeleteBlockers(code: string): Promise<{
  requests: number;
  workItems: number;
  schedules: number;
  storylineSteps: number;
  approvals: number;
  deploymentConversations: number;
  childRequests: number;
  scheduleRuns: number;
} | null> {
  const versions = sql`(select v.id from work.request_type_version v where v.request_type_id = ${outer(s.requestType.id)})`;
  const requests = sql`(select r.id from work.request r where r.request_type_version_id in ${versions})`;
  const [row] = await dbRo()
    .select({
      requests: sql<number>`(select count(*) from work.request x where x.request_type_version_id in ${versions})::int`,
      workItems: sql<number>`(select count(*) from work.work_item x where x.request_type_version_id in ${versions} or x.request_id in ${requests})::int`,
      schedules: sql<number>`(select count(*) from work.scheduled_work_item x where x.creates_request_type_id = ${outer(s.requestType.id)})::int`,
      storylineSteps: sql<number>`(select count(*) from ai.storyline_step x where x.config_json ->> 'requestTypeCode' = ${code})::int`,
      approvals: sql<number>`(select count(*) from ai.approval x where x.request_id in ${requests})::int`,
      deploymentConversations: sql<number>`(select count(*) from ai.deployment_conversation x where x.request_id in ${requests})::int`,
      childRequests: sql<number>`(select count(*) from work.request x where x.parent_request_id in ${requests} and x.request_type_version_id not in ${versions})::int`,
      scheduleRuns: sql<number>`(select count(*) from work.schedule_run x where x.created_request_id in ${requests})::int`,
    })
    .from(s.requestType)
    .where(eq(s.requestType.code, code))
    .limit(1);
  return row ?? null;
}

/**
 * The request type with its versions and their steps, audiences, rules and attributes, and,
 * with `withRequests`, every request of it and their decision logs, in one transaction.
 */
export async function deleteRequestType(code: string, withRequests: boolean): Promise<void> {
  await db().transaction(async (tx) => {
    if (withRequests) {
      const requests = sql`(select r.id from work.request r join work.request_type_version v on v.id = r.request_type_version_id
        join work.request_type rt on rt.id = v.request_type_id where rt.code = ${code})`;
      await tx.execute(sql`delete from work.request_event where request_id in ${requests}`);
      await tx.execute(sql`delete from work.request where id in ${requests}`);
    }
    await tx.delete(s.requestType).where(eq(s.requestType.code, code));
  });
}

/* ------------------------------------------------- S-30: editing a request type's draft */

/**
 * The draft of a type, if it has one.
 *
 * Publishing asks for this rather than `draftVersionOf`: that one creates a draft from the
 * published version when there is none, which is right for the designer's first edit and
 * wrong for a publish, where it would promote a copy of what is already live.
 */
export async function existingDraftOf(code: string): Promise<string | null> {
  const [draft] = await dbRo()
    .select({ id: s.requestTypeVersion.id })
    .from(s.requestTypeVersion)
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .where(and(eq(s.requestType.code, code), eq(s.requestTypeVersion.status, "Draft")))
    .orderBy(desc(s.requestTypeVersion.versionNumber))
    .limit(1);
  return draft?.id ?? null;
}

/**
 * The id of the type's draft version, creating one as a copy of the published version when there
 * is no draft. `null` for an unknown type, or one with neither a draft nor a published version.
 *
 * A published version is immutable: every request raised against it is pinned to it, so editing
 * one in place would rewrite the flow those requests are following. Editing therefore always
 * happens on a draft.
 */
export async function draftVersionOf(code: string): Promise<string | null> {
  const [type] = await dbRo()
    .select({ id: s.requestType.id, publishedId: s.requestType.currentPublishedVersionId })
    .from(s.requestType)
    .where(eq(s.requestType.code, code))
    .limit(1);
  if (!type) return null;

  const [draft] = await dbRo()
    .select({ id: s.requestTypeVersion.id })
    .from(s.requestTypeVersion)
    .where(and(eq(s.requestTypeVersion.requestTypeId, type.id), eq(s.requestTypeVersion.status, "Draft")))
    .orderBy(desc(s.requestTypeVersion.versionNumber))
    .limit(1);
  if (draft) return draft.id;
  if (!type.publishedId) return null;
  return copyVersion(type.id, type.publishedId);
}

/** Copies a published version, with its steps, audiences, rules and attributes. */
async function copyVersion(requestTypeId: string, sourceId: string): Promise<string> {
  return db().transaction(async (tx) => {
    const [source] = await tx.select().from(s.requestTypeVersion).where(eq(s.requestTypeVersion.id, sourceId)).limit(1);
    const { rows } = await tx.execute<{ next: number }>(
      sql`select coalesce(max(version_number), 0) + 1 as next from work.request_type_version where request_type_id = ${requestTypeId}`,
    );
    const [created] = await tx
      .insert(s.requestTypeVersion)
      .values({
        requestTypeId,
        versionNumber: rows[0].next,
        status: "Draft",
        defaultProjectId: source.defaultProjectId,
        decomposition: source.decomposition,
        slaValue: source.slaValue,
        slaUnit: source.slaUnit,
        intakeChannels: source.intakeChannels,
        entryModes: source.entryModes,
        createdBy: source.createdBy,
        updatedBy: source.updatedBy,
      })
      .returning({ id: s.requestTypeVersion.id });

    const steps = await tx
      .select()
      .from(s.transitionStep)
      .where(eq(s.transitionStep.requestTypeVersionId, sourceId))
      .orderBy(asc(s.transitionStep.sortOrder));
    /** The new step id for each old one, so the copied rules point inside the copy. */
    const mapped = new Map<string, string>();
    for (const step of steps) {
      const [copy] = await tx
        .insert(s.transitionStep)
        .values({
          requestTypeVersionId: created.id,
          sortOrder: step.sortOrder,
          nameEn: step.nameEn,
          nameAr: step.nameAr,
          slaValue: step.slaValue,
          slaUnit: step.slaUnit,
          isTerminal: step.isTerminal,
        })
        .returning({ id: s.transitionStep.id });
      mapped.set(step.id, copy.id);

      const audiences = await tx.select().from(s.stepAudience).where(eq(s.stepAudience.stepId, step.id));
      if (audiences.length > 0) {
        await tx.insert(s.stepAudience).values(
          audiences.map((audience) => ({
            stepId: copy.id,
            principalType: audience.principalType,
            principalId: audience.principalId,
            access: audience.access,
            sequence: audience.sequence,
          })),
        );
      }
    }

    for (const step of steps) {
      const rules = await tx.select().from(s.routingRule).where(eq(s.routingRule.fromStepId, step.id));
      if (rules.length === 0) continue;
      await tx.insert(s.routingRule).values(
        rules.map((rule) => ({
          fromStepId: mapped.get(step.id) as string,
          sortOrder: rule.sortOrder,
          kind: rule.kind,
          expression: rule.expression,
          actionName: rule.actionName,
          toStepId: rule.toStepId ? (mapped.get(rule.toStepId) ?? null) : null,
        })),
      );
    }

    // After the steps, so an attribute asked at a step is asked at that step's copy.
    const attributes = await tx.select().from(s.attributeDefinition).where(eq(s.attributeDefinition.requestTypeVersionId, sourceId));
    if (attributes.length > 0) {
      await tx.insert(s.attributeDefinition).values(
        attributes.map((attribute) => ({
          requestTypeVersionId: created.id,
          key: attribute.key,
          labelEn: attribute.labelEn,
          labelAr: attribute.labelAr,
          dataType: attribute.dataType,
          required: attribute.required,
          enumValues: attribute.enumValues,
          validationJson: attribute.validationJson,
          sortOrder: attribute.sortOrder,
          stepId: attribute.stepId ? (mapped.get(attribute.stepId) ?? null) : null,
        })),
      );
    }
    return created.id;
  });
}

/** `UC-30.1-01`: the general settings of a draft. */
export async function saveDraftGeneral(
  versionId: string,
  input: {
    categoryEn: string;
    decomposition: string;
    slaValue: number | null;
    slaUnit: string | null;
    defaultProjectKey: string | null;
    intakeChannels: string[];
    entryModes: string[];
  },
  personId: string,
): Promise<void> {
  const [project] = input.defaultProjectKey
    ? await dbRo().select({ id: s.project.id }).from(s.project).where(eq(s.project.key, input.defaultProjectKey)).limit(1)
    : [undefined];
  await db()
    .update(s.requestTypeVersion)
    .set({
      decomposition: input.decomposition,
      slaValue: input.slaValue,
      slaUnit: input.slaUnit,
      defaultProjectId: project?.id ?? null,
      intakeChannels: input.intakeChannels,
      entryModes: input.entryModes,
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(eq(s.requestTypeVersion.id, versionId));

  // The category belongs to the type rather than to one of its versions, so it moves with
  // the draft's save but is not versioned alongside it.
  await db()
    .update(s.requestType)
    .set({ categoryEn: input.categoryEn, categoryAr: input.categoryEn, updatedAt: new Date(), updatedBy: personId })
    .where(sql`${s.requestType.id} = (select v.request_type_id from work.request_type_version v where v.id = ${versionId})`);
}

/** `UC-30.2-01`: a step at the end of the ordered list. */
export async function addStep(versionId: string, nameEn: string, nameAr: string, sla: { value: number | null; unit: string | null }): Promise<string> {
  // The version row is locked while the next place is read, so two steps added at once (an
  // agent's parallel calls) are numbered one after the other rather than both taking it.
  return db().transaction(async (tx) => {
    await tx.execute(sql`select 1 from work.request_type_version where id = ${versionId} for update`);
    const { rows } = await tx.execute<{ next: number }>(
      sql`select coalesce(max(sort_order), 0) + 1 as next from work.transition_step where request_type_version_id = ${versionId}`,
    );
    const [created] = await tx
      .insert(s.transitionStep)
      .values({
        requestTypeVersionId: versionId,
        sortOrder: rows[0].next,
        nameEn,
        nameAr,
        slaValue: sla.value,
        slaUnit: sla.unit,
      })
      .returning({ id: s.transitionStep.id });
    return created.id;
  });
}

/** One step as an edit reads it, before and after. */
export type StepRow = {
  nameEn: string;
  nameAr: string;
  slaValue: number | null;
  slaUnit: string | null;
  isTerminal: boolean;
  terminalOutcome: string;
  /** Where the step sits in its version, from 1. */
  position: number;
  version: number;
};

/** Reads one step of a version by name, for an edit to diff against. */
export async function readStep(versionId: string, stepName: string): Promise<StepRow | null> {
  const [row] = await dbRo()
    .select({
      nameEn: s.transitionStep.nameEn,
      nameAr: s.transitionStep.nameAr,
      slaValue: s.transitionStep.slaValue,
      slaUnit: s.transitionStep.slaUnit,
      isTerminal: s.transitionStep.isTerminal,
      terminalOutcome: s.transitionStep.terminalOutcome,
      position: sql<number>`(
        select count(*)::int from work.transition_step o
        where o.request_type_version_id = ${outer(s.transitionStep.requestTypeVersionId)}
          and o.sort_order <= ${outer(s.transitionStep.sortOrder)}
      )`,
      version: s.transitionStep.version,
    })
    .from(s.transitionStep)
    .where(and(eq(s.transitionStep.requestTypeVersionId, versionId), eq(s.transitionStep.nameEn, stepName)))
    .limit(1);
  return row ?? null;
}

/**
 * What marking a step terminal would discard: its audiences and its outgoing rules.
 *
 * Read before the write, because afterwards they are gone and the diff still has to say
 * what went. An approver agreeing to a terminal flip is agreeing to this with it.
 */
export async function stepCascade(stepId: string): Promise<{ audiences: string[]; rules: string[] }> {
  const audiences = await dbRo()
    .select({
      principalType: s.stepAudience.principalType,
      agentName: s.agent.nameEn,
      groupName: s.group.nameEn,
      roleName: s.role.nameEn,
    })
    .from(s.stepAudience)
    .leftJoin(s.agent, eq(s.agent.id, s.stepAudience.principalId))
    .leftJoin(s.group, eq(s.group.id, s.stepAudience.principalId))
    .leftJoin(s.role, eq(s.role.id, s.stepAudience.principalId))
    .where(eq(s.stepAudience.stepId, stepId));

  const rules = await dbRo()
    .select({
      kind: s.routingRule.kind,
      expression: s.routingRule.expression,
      actionName: s.routingRule.actionName,
      toStepName: sql<string>`(select ts.name_en from work.transition_step ts where ts.id = ${outer(s.routingRule.toStepId)})`,
    })
    .from(s.routingRule)
    .where(eq(s.routingRule.fromStepId, stepId));

  return {
    audiences: audiences.map(
      (one) => one.agentName ?? one.groupName ?? one.roleName ?? one.principalType,
    ),
    rules: rules.map(
      (one) => `${one.kind === "Condition" ? one.expression : one.actionName} â ${one.toStepName ?? "?"}`,
    ),
  };
}

/**
 * `UC-30.2`: applies one patch to a step, all of it or none.
 *
 * The version is part of the `where`, so a step somebody else saved since the agent read
 * it is not overwritten — the update matches nothing and the caller is told to read again.
 * Turning a step terminal clears its audiences and outgoing rules in the same transaction,
 * because a terminal step with either is not a state the flow may be left in.
 */
export async function updateStep(
  stepId: string,
  expectedVersion: number,
  patch: {
    nameEn?: string;
    nameAr?: string;
    slaValue?: number | null;
    slaUnit?: string | null;
    isTerminal?: boolean;
    terminalOutcome?: string;
    position?: number;
  },
  personId: string,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .update(s.transitionStep)
      .set({
        ...(patch.nameEn === undefined ? {} : { nameEn: patch.nameEn }),
        ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
        ...(patch.slaValue === undefined ? {} : { slaValue: patch.slaValue }),
        ...(patch.slaUnit === undefined ? {} : { slaUnit: patch.slaUnit }),
        ...(patch.isTerminal === undefined ? {} : { isTerminal: patch.isTerminal }),
        ...(patch.terminalOutcome === undefined ? {} : { terminalOutcome: patch.terminalOutcome }),
        version: expectedVersion + 1,
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(and(eq(s.transitionStep.id, stepId), eq(s.transitionStep.version, expectedVersion)))
      .returning({ id: s.transitionStep.id });
    if (rows.length === 0) return false;

    if (patch.isTerminal === true) {
      await tx.delete(s.stepAudience).where(eq(s.stepAudience.stepId, stepId));
      await tx.delete(s.routingRule).where(eq(s.routingRule.fromStepId, stepId));
    }
    if (patch.position !== undefined) {
      const [step] = await tx
        .select({ versionId: s.transitionStep.requestTypeVersionId })
        .from(s.transitionStep)
        .where(eq(s.transitionStep.id, stepId));
      const order = await tx
        .select({ id: s.transitionStep.id })
        .from(s.transitionStep)
        .where(eq(s.transitionStep.requestTypeVersionId, step.versionId))
        .orderBy(asc(s.transitionStep.sortOrder));
      const others = order.map((row) => row.id).filter((id) => id !== stepId);
      others.splice(Math.min(patch.position, order.length) - 1, 0, stepId);
      // Out of the way first: the order is unique per version, so renumbering in place
      // collides with a step that has not moved yet.
      await tx
        .update(s.transitionStep)
        .set({ sortOrder: sql`-1 - ${s.transitionStep.sortOrder}` })
        .where(eq(s.transitionStep.requestTypeVersionId, step.versionId));
      for (const [index, id] of others.entries()) {
        await tx.update(s.transitionStep).set({ sortOrder: index + 1 }).where(eq(s.transitionStep.id, id));
      }
    }
    return true;
  });
}

/** `UC-30.1-01`: a step's own clock — a count and the interval it counts. */
export async function setStepSla(stepId: string, value: number | null, unit: string | null): Promise<void> {
  await db()
    .update(s.transitionStep)
    .set({ slaValue: value, slaUnit: unit, updatedAt: new Date() })
    .where(eq(s.transitionStep.id, stepId));
}

/**
 * `UC-30.2-04`: a step marked terminal loses its audiences and its outgoing rules, because
 * that is what terminal means — nothing left to do and nowhere left to go. `outcome` is what
 * a request that ends here is left as; ignored, and reset to the default, on a normal step.
 */
export async function setStepTerminal(stepId: string, terminal: boolean, outcome: string = "Completed"): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(s.transitionStep)
      .set({ isTerminal: terminal, terminalOutcome: terminal ? outcome : "Completed", updatedAt: new Date() })
      .where(eq(s.transitionStep.id, stepId));
    if (terminal) {
      await tx.delete(s.stepAudience).where(eq(s.stepAudience.stepId, stepId));
      await tx.delete(s.routingRule).where(eq(s.routingRule.fromStepId, stepId));
    }
  });
}

/** `UC-30.2-09`: the rules that point at a step, so deleting it is not a silent break. */
export async function rulesPointingAt(stepId: string): Promise<{ fromStep: string; expression: string | null; actionName: string | null }[]> {
  const from = alias(s.transitionStep, "from_step");
  return dbRo()
    .select({ fromStep: from.nameEn, expression: s.routingRule.expression, actionName: s.routingRule.actionName })
    .from(s.routingRule)
    .innerJoin(from, eq(from.id, s.routingRule.fromStepId))
    .where(eq(s.routingRule.toStepId, stepId));
}

/**
 * Deletes a step and the rules that point at it.
 *
 * A rule whose target is gone routes nowhere, so it goes with the step rather than being
 * left behind as a route a request can never follow. What those rules were is reported by
 * `rulesPointingAt` before anything is deleted.
 */
export async function deleteStep(stepId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(s.routingRule).where(eq(s.routingRule.toStepId, stepId));
    await tx.delete(s.transitionStep).where(eq(s.transitionStep.id, stepId));
  });
}

/** `UC-30.2-02`: an audience on a step, with what it may do there. */
export async function addAudience(
  stepId: string,
  input: { principalType: string; principalId: string | null; access: string; sequence: number | null },
): Promise<void> {
  await db().insert(s.stepAudience).values({
    stepId,
    principalType: input.principalType,
    principalId: input.principalId,
    access: input.access,
    sequence: input.sequence,
  });
}

/** `UC-30.2-02`: remove a step's audience at its 1-based position, in the order the designer lists them. */
export async function removeAudienceAt(stepId: string, position: number): Promise<boolean> {
  const audiences = await db()
    .select({ id: s.stepAudience.id })
    .from(s.stepAudience)
    .where(eq(s.stepAudience.stepId, stepId))
    .orderBy(asc(s.stepAudience.sequence), asc(s.stepAudience.id));
  const target = audiences[position - 1];
  if (!target) return false;
  await db().delete(s.stepAudience).where(eq(s.stepAudience.id, target.id));
  return true;
}

/** `UC-30.2-03`: remove a step's routing rule at its 1-based position, in the order rules are tried. */
export async function removeRuleAt(stepId: string, position: number): Promise<boolean> {
  const rules = await db()
    .select({ id: s.routingRule.id })
    .from(s.routingRule)
    .where(eq(s.routingRule.fromStepId, stepId))
    .orderBy(asc(s.routingRule.sortOrder));
  const target = rules[position - 1];
  if (!target) return false;
  await db().delete(s.routingRule).where(eq(s.routingRule.id, target.id));
  return true;
}

/** D309: a step's routing rule at its 1-based position, read on the primary for an edit. */
export async function ruleAt(
  stepId: string,
  position: number,
): Promise<{ id: string; kind: string; expression: string | null; actionName: string | null } | undefined> {
  const rules = await db()
    .select({ id: s.routingRule.id, kind: s.routingRule.kind, expression: s.routingRule.expression, actionName: s.routingRule.actionName })
    .from(s.routingRule)
    .where(eq(s.routingRule.fromStepId, stepId))
    .orderBy(asc(s.routingRule.sortOrder));
  return rules[position - 1];
}

/** D309: change a routing rule in place; its place in the order is kept. */
export async function updateRule(
  id: string,
  values: { kind: string; expression: string | null; actionName: string | null; toStepId?: string | null },
): Promise<void> {
  await db().update(s.routingRule).set(values).where(eq(s.routingRule.id, id));
}

/**
 * The id behind an agent, named either by its code or by the id itself.
 *
 * The console picks an agent by code; the platform's own callers hold the id. Resolving
 * both here is what lets the audience row store one thing while either caller writes it.
 */
export async function agentIdOf(codeOrId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ id: s.agent.id })
    .from(s.agent)
    .where(or(eq(s.agent.code, codeOrId), sql`${s.agent.id}::text = ${codeOrId}`))
    .limit(1);
  return row?.id ?? null;
}

/** A person by id or email, a group or a role by id, code or English name. */
export async function principalIdOf(type: "Person" | "Group" | "Role", key: string): Promise<string | null> {
  const byId = sql`${type === "Person" ? s.person.id : type === "Group" ? s.group.id : s.role.id}::text = ${key}`;
  const query =
    type === "Person"
      ? dbRo().select({ id: s.person.id }).from(s.person).where(or(byId, sql`lower(${s.person.email}) = lower(${key})`))
      : type === "Group"
        ? dbRo().select({ id: s.group.id }).from(s.group).where(or(byId, eq(s.group.code, key), sql`lower(${s.group.nameEn}) = lower(${key})`))
        : dbRo().select({ id: s.role.id }).from(s.role).where(or(byId, eq(s.role.code, key), sql`lower(${s.role.nameEn}) = lower(${key})`));
  const [row] = await query.limit(1);
  return row?.id ?? null;
}

/** `UC-30.2-03` and `-10`: a rule out of a step, including one that points backwards. */
export async function addRule(
  fromStepId: string,
  input: { kind: string; expression: string | null; actionName: string | null; toStepName: string | null },
  versionId: string,
): Promise<void> {
  const [target] = input.toStepName
    ? await dbRo()
        .select({ id: s.transitionStep.id })
        .from(s.transitionStep)
        .where(and(eq(s.transitionStep.requestTypeVersionId, versionId), eq(s.transitionStep.nameEn, input.toStepName)))
        .limit(1)
    : [undefined];
  const { rows } = await db().execute<{ next: number }>(
    sql`select coalesce(max(sort_order), 0) + 1 as next from work.routing_rule where from_step_id = ${fromStepId}`,
  );
  await db().insert(s.routingRule).values({
    fromStepId,
    sortOrder: rows[0].next,
    kind: input.kind,
    expression: input.expression,
    actionName: input.actionName,
    toStepId: target?.id ?? null,
  });
}

/** `UC-30.3-01`: an attribute of the draft, which the form and the extraction both read. */
export async function addAttribute(
  versionId: string,
  input: {
    key: string;
    labelEn: string;
    labelAr: string;
    dataType: string;
    required: boolean;
    enumValues?: { value: string; labelEn: string; labelAr: string }[] | null;
    /** The step it is asked at; null or absent is the request form. */
    stepId?: string | null;
  },
): Promise<void> {
  const { rows } = await db().execute<{ next: number }>(
    sql`select coalesce(max(sort_order), 0) + 1 as next from work.attribute_definition where request_type_version_id = ${versionId}`,
  );
  await db().insert(s.attributeDefinition).values({
    requestTypeVersionId: versionId,
    key: input.key,
    labelEn: input.labelEn,
    labelAr: input.labelAr,
    dataType: input.dataType,
    required: input.required,
    enumValues: input.enumValues ?? null,
    stepId: input.stepId ?? null,
    sortOrder: rows[0].next,
  });
}

/**
 * D304: applies one attribute edit to the draft. False when the draft has no attribute by that key.
 * A `position` (from 1) renumbers the draft's attributes in one transaction (D316).
 */
export async function updateAttribute(
  versionId: string,
  key: string,
  patch: {
    labelEn?: string;
    labelAr?: string;
    dataType?: string;
    required?: boolean;
    enumValues?: { value: string; labelEn: string; labelAr: string }[] | null;
    stepId?: string | null;
    position?: number;
  },
): Promise<boolean> {
  const { position, ...fields } = patch;
  return db().transaction(async (tx) => {
    const rows = await tx
      .update(s.attributeDefinition)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(s.attributeDefinition.requestTypeVersionId, versionId), eq(s.attributeDefinition.key, key)))
      .returning({ id: s.attributeDefinition.id });
    if (rows.length === 0) return false;
    if (position !== undefined) {
      const order = await tx
        .select({ id: s.attributeDefinition.id })
        .from(s.attributeDefinition)
        .where(eq(s.attributeDefinition.requestTypeVersionId, versionId))
        .orderBy(asc(s.attributeDefinition.sortOrder), asc(s.attributeDefinition.id));
      const others = order.map((row) => row.id).filter((id) => id !== rows[0].id);
      others.splice(Math.min(position, order.length) - 1, 0, rows[0].id);
      for (const [index, id] of others.entries()) {
        await tx.update(s.attributeDefinition).set({ sortOrder: index + 1 }).where(eq(s.attributeDefinition.id, id));
      }
    }
    return true;
  });
}

/**
 * `UC-30.3-03`: an attribute removed from the draft stops appearing on new requests. The
 * values already stored on open requests are theirs, on the version they were pinned to,
 * and are untouched.
 */
export async function removeAttribute(versionId: string, key: string): Promise<void> {
  await db()
    .delete(s.attributeDefinition)
    .where(and(eq(s.attributeDefinition.requestTypeVersionId, versionId), eq(s.attributeDefinition.key, key)));
}

/** The step ids and names of one version, for a designer that addresses steps by name. */
export async function stepsOfVersion(versionId: string): Promise<{ id: string; nameEn: string; isTerminal: boolean }[]> {
  return dbRo()
    .select({ id: s.transitionStep.id, nameEn: s.transitionStep.nameEn, isTerminal: s.transitionStep.isTerminal })
    .from(s.transitionStep)
    .where(eq(s.transitionStep.requestTypeVersionId, versionId))
    .orderBy(asc(s.transitionStep.sortOrder));
}

/** `UC-27.2-02`: a new request type, with an empty draft version to configure. */
export async function createRequestType(input: {
  code: string;
  nameEn: string;
  nameAr: string;
  categoryEn: string;
  decomposition: string;
  personId: string;
}): Promise<void> {
  await db().transaction(async (tx) => {
    const [created] = await tx
      .insert(s.requestType)
      .values({
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        categoryEn: input.categoryEn,
        categoryAr: input.categoryEn,
        createdBy: input.personId,
        updatedBy: input.personId,
      })
      .returning({ id: s.requestType.id });
    await tx.insert(s.requestTypeVersion).values({
      requestTypeId: created.id,
      versionNumber: 1,
      status: "Draft",
      decomposition: input.decomposition,
      createdBy: input.personId,
      updatedBy: input.personId,
    });
  });
}

/* --------------------------------------------- S-29: acting on the step a request is at */

/** Everything deciding a step action needs, in one read. */
export type RequestForAction = {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  status: string;
  requesterId: string | null;
  attributes: Record<string, string>;
  versionId: string;
  currentStepId: string | null;
  currentStepName: string | null;
  currentStepIsTerminal: boolean;
  /** The person who has taken the current step, and their name, or null. */
  claimedBy: string | null;
  claimedByName: string | null;
  audiences: { id: string; principalType: string; principalId: string | null; access: string; sequence: number | null }[];
  rules: { kind: string; expression: string | null; actionName: string | null; toStepName: string | null }[];
};

/**
 * Whether a step ends a request (§7.2.5): marked terminal, or with no audience and no outgoing
 * rule — the definition the designer and the publish check use (`flow.ts`). Routing and the
 * "closed" check read the same, so a request routed to such a step completes rather than
 * waiting In review at a step nobody may act on (D159).
 */
const stepIsTerminal = sql<boolean>`(${outer(s.transitionStep.isTerminal)} or (
  not exists (select 1 from work.step_audience a where a.step_id = ${outer(s.transitionStep.id)})
  and not exists (select 1 from work.routing_rule r where r.from_step_id = ${outer(s.transitionStep.id)})
))`;

/**
 * A request with what deciding a step action needs: its status, requester, attributes as text,
 * the current step and whether it ends the request, who has taken it, the current step's
 * audiences, and the step's routing rules in the order they are tried. The audiences are read
 * from the same-named step of the newest published version (`audienceStepOf`, D217); the rules
 * stay the pinned version's. `null` when no request has the key.
 */
export async function readForAction(key: string): Promise<RequestForAction | null> {
  const target = alias(s.transitionStep, "to_step");
  const [row] = await dbRo()
    .select({
      id: s.request.id,
      key: s.request.key,
      projectId: s.request.projectId,
      projectKey: s.project.key,
      status: s.request.status,
      requesterId: s.request.requesterId,
      attributes: s.request.attributes,
      versionId: s.request.requestTypeVersionId,
      currentStepId: s.request.currentStepId,
      currentStepName: s.transitionStep.nameEn,
      currentStepIsTerminal: stepIsTerminal,
      claimedBy: s.request.claimedBy,
      claimedByName: sql<string | null>`(select p.name_en from core.person p where p.id = ${outer(s.request.claimedBy)})`,
    })
    .from(s.request)
    .innerJoin(s.project, eq(s.project.id, s.request.projectId))
    .leftJoin(s.transitionStep, eq(s.transitionStep.id, s.request.currentStepId))
    .where(eq(s.request.key, key))
    .limit(1);
  if (!row) return null;

  const audiences = row.currentStepId
    ? await dbRo()
        .select({
          id: s.stepAudience.id,
          principalType: s.stepAudience.principalType,
          principalId: s.stepAudience.principalId,
          access: s.stepAudience.access,
          sequence: s.stepAudience.sequence,
        })
        .from(s.stepAudience)
        .where(sql`${s.stepAudience.stepId} = ${audienceStepOf(sql`${row.currentStepId}::uuid`)}`)
        .orderBy(asc(s.stepAudience.sequence))
    : [];

  const rules = row.currentStepId
    ? await dbRo()
        .select({
          kind: s.routingRule.kind,
          expression: s.routingRule.expression,
          actionName: s.routingRule.actionName,
          toStepName: target.nameEn,
        })
        .from(s.routingRule)
        .leftJoin(target, eq(target.id, s.routingRule.toStepId))
        .where(eq(s.routingRule.fromStepId, row.currentStepId))
        .orderBy(asc(s.routingRule.sortOrder))
    : [];

  return {
    ...row,
    currentStepName: row.currentStepName ?? null,
    currentStepIsTerminal: row.currentStepIsTerminal ?? false,
    attributes: Object.fromEntries(
      Object.entries((row.attributes ?? {}) as Record<string, unknown>).map(([name, value]) => [name, String(value ?? "")]),
    ),
    audiences,
    rules,
  };
}

/** The id, terminality and outcome of a step of one version, named as the designer names it. */
export async function stepByName(
  versionId: string,
  name: string,
): Promise<{ id: string; isTerminal: boolean; terminalOutcome: string } | null> {
  const [row] = await dbRo()
    .select({ id: s.transitionStep.id, isTerminal: stepIsTerminal, terminalOutcome: s.transitionStep.terminalOutcome })
    .from(s.transitionStep)
    .where(and(eq(s.transitionStep.requestTypeVersionId, versionId), eq(s.transitionStep.nameEn, name)))
    .limit(1);
  return row ?? null;
}

/**
 * Who a request event names: the agent that acted when there is one, else the person, else
 * the platform itself.
 */
function eventActor(actorId: string | null, agentId: string | null | undefined): { actorType: string; actorId: string | null } {
  if (agentId) return { actorType: "Agent", actorId: agentId };
  return actorId ? { actorType: "Person", actorId } : { actorType: "System", actorId: null };
}

/** Moves a request to a step and records why, in one transaction. */
export async function moveToStep(input: {
  requestId: string;
  toStepId: string | null;
  status: string;
  /** The person the change is made for. */
  actorId: string;
  /** The agent that took the action, named on the event in the person's place. */
  agentId?: string | null;
  eventType: string;
  detailEn: string;
  detailAr: string;
  /** The request's attributes after the step's own were filled in, when the action gave any. */
  attributes?: Record<string, string>;
  /** The values the action itself supplied, recorded on its event (D314). */
  given?: Record<string, string>;
}): Promise<void> {
  const queued = await db().transaction(async (tx) => {
    const [before] = await tx.select({ status: s.request.status }).from(s.request).where(eq(s.request.id, input.requestId)).for("update");
    await tx
      .update(s.request)
      .set({
        ...(input.attributes ? { attributes: input.attributes } : {}),
        currentStepId: input.toStepId,
        status: input.status,
        // A step taken by somebody is released by the request leaving it.
        claimedBy: null,
        claimedAt: null,
        closedAt: input.status === "Closed" || input.status === "Completed" ? new Date() : null,
        updatedAt: new Date(),
        updatedBy: input.actorId,
      })
      .where(eq(s.request.id, input.requestId));
    const [event] = await tx
      .insert(s.requestEvent)
      .values({
        requestId: input.requestId,
        ...eventActor(input.actorId, input.agentId),
        eventType: input.eventType,
        toStepId: input.toStepId,
        detailEn: input.detailEn,
        detailAr: input.detailAr,
        attributes: input.given ?? null,
      })
      .returning({ id: s.requestEvent.id });
    // D247: a move that does not finish it is an update, told unless the requester made it.
    if (!finalStatus("Request", input.status)) {
      return queueRequestNotices(tx, {
        kind: "RequestUpdated",
        requestId: input.requestId,
        outcome: input.status,
        eventId: event.id,
        except: input.agentId ? [] : [input.actorId],
        actorId: input.actorId,
      });
    }
    // D240: finishing it, not moving within its final state, is what the requester is told.
    if (before && finalStatus("Request", before.status)) return NO_NOTICES;
    return queueFinishedNotices(tx, {
      subjectType: "Request",
      subjectId: input.requestId,
      outcome: input.status,
      eventId: event.id,
      // A person who finished it themselves knows; an agent finishing it for them is news.
      except: input.agentId ? [] : [input.actorId],
      actorId: input.actorId,
    });
  });
  await announce(queued);
}

/**
 * Takes the request's current step for one person, if nobody has it. One UPDATE, so two people
 * taking it at once cannot both succeed.
 */
export async function claimStep(input: { requestId: string; stepId: string; personId: string }): Promise<boolean> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .update(s.request)
      .set({ claimedBy: input.personId, claimedAt: new Date(), status: "InProgress", updatedAt: new Date(), updatedBy: input.personId })
      .where(and(eq(s.request.id, input.requestId), eq(s.request.currentStepId, input.stepId), isNull(s.request.claimedBy)))
      .returning({ id: s.request.id });
    if (rows.length === 0) return false;
    await tx.insert(s.requestEvent).values({
      requestId: input.requestId,
      ...eventActor(input.personId, null),
      eventType: "Assigned",
      toStepId: input.stepId,
      detailEn: "Took this step.",
      detailAr: "تولّى هذه الخطوة.",
    });
    return true;
  });
}

/** Hands the current step back, by the person who took it. */
export async function releaseStep(input: { requestId: string; personId: string; status: string }): Promise<boolean> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .update(s.request)
      .set({ claimedBy: null, claimedAt: null, status: input.status, updatedAt: new Date(), updatedBy: input.personId })
      .where(and(eq(s.request.id, input.requestId), eq(s.request.claimedBy, input.personId)))
      .returning({ id: s.request.id });
    if (rows.length === 0) return false;
    await tx.insert(s.requestEvent).values({
      requestId: input.requestId,
      ...eventActor(input.personId, null),
      eventType: "Assigned",
      detailEn: "Released this step.",
      detailAr: "أعاد هذه الخطوة.",
    });
    return true;
  });
}

/** The agents a step's audience names with `CanAct`, by the code a run starts with. */
export async function agentAudiencesOf(stepId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ code: s.agent.code })
    .from(s.stepAudience)
    .innerJoin(s.agent, eq(s.agent.id, s.stepAudience.principalId))
    .where(
      and(
        sql`${s.stepAudience.stepId} = ${audienceStepOf(sql`${stepId}::uuid`)}`,
        eq(s.stepAudience.principalType, "Agent"),
        eq(s.stepAudience.access, "CanAct"),
      ),
    );
  return rows.map((row) => row.code);
}

/** The routing rules out of a step, in the designer's order: the step's own contract (D41). */
export async function rulesOutOf(stepId: string): Promise<Rule[]> {
  const target = alias(s.transitionStep, "contract_to_step");
  const rows = await dbRo()
    .select({
      kind: s.routingRule.kind,
      expression: s.routingRule.expression,
      actionName: s.routingRule.actionName,
      toStepName: target.nameEn,
    })
    .from(s.routingRule)
    .leftJoin(target, eq(target.id, s.routingRule.toStepId))
    .where(eq(s.routingRule.fromStepId, stepId))
    .orderBy(asc(s.routingRule.sortOrder));
  return rows.map((row) => ({
    kind: row.kind as Rule["kind"],
    expression: row.expression,
    actionName: row.actionName,
    toStepName: row.toStepName,
  }));
}

/** The names of the files attached to a request, which a decision may name (D218). */
export async function attachmentNamesOf(requestId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ name: s.attachment.fileName })
    .from(s.attachment)
    .where(and(eq(s.attachment.ownerType, "Request"), eq(s.attachment.ownerId, requestId)));
  return rows.map((row) => row.name);
}

/**
 * Records something that happened to a request without moving it (`UC-29.2-09`): one history
 * event, whose actor is the agent when given, else the person, else System.
 */
export async function recordEvent(input: {
  requestId: string;
  /** The person it happened for, or null for the platform acting with nobody behind it. */
  actorId: string | null;
  /** The agent that did it, named on the event in the person's place. */
  agentId?: string | null;
  eventType: string;
  detailEn: string;
  detailAr: string;
}): Promise<void> {
  await db().insert(s.requestEvent).values({
    requestId: input.requestId,
    ...eventActor(input.actorId, input.agentId),
    eventType: input.eventType,
    detailEn: input.detailEn,
    detailAr: input.detailAr,
  });
}

/** The agent, person, context and status of one run, for binding what it may do to what it is about. */
export async function runBinding(runId: string): Promise<{
  agentId: string;
  personId: string | null;
  contextType: string;
  contextId: string | null;
  status: string;
} | null> {
  const [row] = await dbRo()
    .select({
      agentId: s.run.agentId,
      personId: s.run.createdBy,
      contextType: s.run.contextType,
      contextId: s.run.contextId,
      status: s.run.status,
    })
    .from(s.run)
    .where(eq(s.run.id, runId))
    .limit(1);
  return row ?? null;
}

/** The first step of a version, which is where a request returns to its requester. */
export async function firstStepOf(versionId: string): Promise<{ id: string; nameEn: string } | null> {
  const [row] = await dbRo()
    .select({ id: s.transitionStep.id, nameEn: s.transitionStep.nameEn })
    .from(s.transitionStep)
    .where(eq(s.transitionStep.requestTypeVersionId, versionId))
    .orderBy(asc(s.transitionStep.sortOrder))
    .limit(1);
  return row ?? null;
}

/** Which groups a person belongs to, so a group audience reaches them. */
export async function groupsOf(personId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ groupId: s.groupMember.groupId })
    .from(s.groupMember)
    .where(eq(s.groupMember.principalId, personId));
  return rows.map((row) => row.groupId);
}

/**
 * The roles a person holds through an assignment whose scope covers the project (`UC-41.2-03`):
 * the organisation, the project's org unit or a unit above it, or the project itself. A role
 * audience reaches a person only through these, so a role held in one unit acts in that unit.
 */
function rolesCovering(personId: string, projectId: SQL): SQL {
  return sql`(
    select ra.role_id from core.role_assignment ra
    where ra.person_id = ${personId}
      and (
        ra.scope_type = 'Organisation'
        or (ra.scope_type = 'Project' and ra.scope_id = ${projectId})
        or (ra.scope_type = 'OrgUnit' and ra.scope_id in (
          with recursive up as (
            select u.id, u.parent_org_unit_id from core.org_unit u
            where u.id = (select pr.org_unit_id from work.project pr where pr.id = ${projectId})
            union all
            select parent.id, parent.parent_org_unit_id from core.org_unit parent join up on parent.id = up.parent_org_unit_id
          )
          select up.id from up
        ))
      )
  )`;
}

/** Which roles a person holds in a project's scope, so a role audience on its request reaches them. */
export async function rolesOf(personId: string, projectId: string): Promise<string[]> {
  const { rows } = await dbRo().execute<{ role_id: string }>(sql`select role_id from ${rolesCovering(personId, sql`${projectId}::uuid`)} held`);
  return rows.map((row) => row.role_id);
}

/**
 * A request outside a person's projects that is still theirs: they raised it, are an audience of
 * the step it is at — by name, by a group they are in or a role they hold there (D166) — or acted
 * on one of its steps, which leaves them read access and no actions (D203).
 */
async function ownRequest(personId: string): Promise<SQL> {
  const reached = [personId, ...(await groupsOf(personId))];
  // The sets that do not depend on the request are computed once rather than per request
  // (D349); only a role audience depends on the request's project.
  return or(
    eq(s.request.requesterId, personId),
    sql`${s.request.currentStepId} in (
      select ts.id from work.transition_step ts
      where exists (
        select 1 from work.step_audience a
        where a.step_id = ${audienceStepOf(sql`ts.id`)}
          and a.principal_type in ('Person', 'Group') and a.principal_id = any(${sql.param(reached)}::uuid[])
      )
    )`,
    sql`(${s.request.currentStepId} in (
      select ts.id from work.transition_step ts
      where exists (select 1 from work.step_audience a where a.step_id = ${audienceStepOf(sql`ts.id`)} and a.principal_type = 'Role')
    ) and exists (
      select 1 from work.step_audience a
      where a.step_id = ${audienceStepOf(outer(s.request.currentStepId))}
        and a.principal_type = 'Role' and a.principal_id in ${rolesCovering(personId, outer(s.request.projectId))}
    ))`,
    sql`${s.request.id} in (
      select e.request_id from work.request_event e
      where e.actor_type = 'Person'
        and e.actor_id = ${personId}
        and e.event_type in ('ActionTaken', 'Returned')
    )`,
  ) as SQL;
}

/** Whether one request is among those `listRequestPage` gives the person; false when there is none. */
export async function requestVisibleTo(key: string, visibleIds: string[] | null, personId: string): Promise<boolean> {
  const inProjects = visibleIds === null ? sql`true` : visibleIds.length > 0 ? inArray(s.request.projectId, visibleIds) : sql`false`;
  const [row] = await dbRo()
    .select({ key: s.request.key })
    .from(s.request)
    .where(and(eq(s.request.key, key), or(inProjects, await ownRequest(personId))))
    .limit(1);
  return row !== undefined;
}

/** The decomposition of the version a request pinned, and the agent that would do it. */
export async function decompositionOf(key: string): Promise<{ decomposition: string; requestId: string } | null> {
  const [row] = await dbRo()
    .select({ decomposition: s.requestTypeVersion.decomposition, requestId: s.request.id })
    .from(s.request)
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
    .where(eq(s.request.key, key))
    .limit(1);
  return row ?? null;
}

/**
 * The agent that breaks a request down (`UC-29.2-10`).
 *
 * A published agent with the Planner profile, which is what the profile is for. There is no
 * fallback to another profile: an agent chosen because it was the only one left is not the
 * agent anybody configured for this.
 */
export async function decompositionAgent(): Promise<string | null> {
  const [row] = await dbRo()
    .select({ code: s.agent.code })
    .from(s.agent)
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .where(
      and(
        eq(s.agentVersion.executionProfile, "Planner"),
        eq(s.agent.isSystem, false),
        notInArray(s.agent.status, ["Paused", "Error", "Retired"]),
      ),
    )
    .orderBy(asc(s.agent.code))
    .limit(1);
  return row?.code ?? null;
}

/**
 * `UC-30.1-04`: everything the external intake widget needs to draw one request type's
 * form — its published version only, because a draft is not something a stranger may
 * raise a request against.
 */
export async function widgetIntakeProfile(code: string): Promise<{
  code: string;
  nameEn: string;
  nameAr: string;
  projectKey: string | null;
  intakeChannels: string[];
  attributes: AttributeDefinition[];
} | null> {
  const [row] = await dbRo()
    .select({
      versionId: s.requestTypeVersion.id,
      code: s.requestType.code,
      nameEn: s.requestType.nameEn,
      nameAr: s.requestType.nameAr,
      projectKey: s.project.key,
      intakeChannels: s.requestTypeVersion.intakeChannels,
    })
    .from(s.requestType)
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.requestType.currentPublishedVersionId))
    .leftJoin(s.project, eq(s.project.id, s.requestTypeVersion.defaultProjectId))
    .where(eq(s.requestType.code, code))
    .limit(1);
  if (!row) return null;

  return {
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    projectKey: row.projectKey,
    intakeChannels: row.intakeChannels ?? [],
    attributes: await attributesOfVersion(row.versionId),
  };
}

/** The channels one request type's published version takes intake from. */
export async function intakeChannelsOf(code: string): Promise<string[]> {
  const [row] = await dbRo()
    .select({ channels: s.requestTypeVersion.intakeChannels })
    .from(s.requestType)
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.requestType.currentPublishedVersionId))
    .where(eq(s.requestType.code, code))
    .limit(1);
  return row?.channels ?? [];
}

/** D384: who did something: a person's name, an agent's code, or the platform. */
const actorName = sql<string>`coalesce(
  (select p.name_en from core.person p where p.id = ${outer(s.requestEvent.actorId)}),
  (select a.code from ai.agent a where a.id = ${outer(s.requestEvent.actorId)}),
  'platform')`;

/**
 * D384: what a request's brief is made of, or null when there is no such request. Read from the
 * primary: the brief is built straight after the write that started the run.
 */
export async function readBriefFacts(key: string) {
  const [request] = await db()
    .select({
      id: s.request.id,
      createdAt: s.request.createdAt,
      title: s.request.titleEn,
      description: s.request.descriptionEn,
      status: s.request.status,
      dueAt: s.request.dueAt,
      submittedAt: s.request.submittedAt,
      channel: s.request.channel,
      attributes: s.request.attributes,
      type: s.requestType.nameEn,
      project: s.project.nameEn,
      step: sql<string | null>`(select t.name_en from work.transition_step t where t.id = ${outer(s.request.currentStepId)})`,
      requester: sql<string | null>`(select p.name_en from core.person p where p.id = ${outer(s.request.requesterId)})`,
    })
    .from(s.request)
    .innerJoin(s.project, eq(s.project.id, s.request.projectId))
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .where(eq(s.request.key, key))
    .limit(1);
  if (!request) return null;

  const [events, attachments] = await Promise.all([
    db()
      .select({ at: s.requestEvent.at, who: actorName, event: s.requestEvent.eventType, detail: s.requestEvent.detailEn })
      .from(s.requestEvent)
      .where(eq(s.requestEvent.requestId, request.id))
      .orderBy(asc(s.requestEvent.at)),
    db().select({ name: s.attachment.fileName, size: s.attachment.size }).from(s.attachment).where(eq(s.attachment.ownerId, request.id)),
  ]);

  return { request, events, attachments };
}

/**
 * D388: every request below `rootKey`, at any depth (at most 10 levels, 500 requests), that the
 * person may see by the list's rule (`UC-27.1-05`), with what a report shows of each. The caller
 * builds the tree from `parentKey`; a request whose parent is hidden is left out with it.
 */
export async function readSubRequestTree(rootKey: string, visibleIds: string[] | null, personId: string): Promise<RequestReportNode[]> {
  const { rows: found } = await dbRo().execute<{ id: string }>(sql`
    with recursive tree as (
      select c.id, 1 as depth from work.request c
       where c.parent_request_id = (select r.id from work.request r where r.key = ${rootKey})
      union all
      select c.id, t.depth + 1 from work.request c join tree t on c.parent_request_id = t.id
       where t.depth < 10
    )
    select id from tree limit 500`);
  if (found.length === 0) return [];
  const parent = alias(s.request, "parent_request");
  const inProjects = visibleIds === null ? undefined : visibleIds.length > 0 ? inArray(s.request.projectId, visibleIds) : sql`false`;
  const rows = await dbRo()
    .select({
      key: s.request.key,
      parentKey: parent.key,
      titleEn: s.request.titleEn,
      titleAr: s.request.titleAr,
      typeEn: s.requestType.nameEn,
      typeAr: s.requestType.nameAr,
      status: s.request.status,
      stepEn: sql<string | null>`(select t.name_en from work.transition_step t where t.id = ${outer(s.request.currentStepId)})`,
      stepAr: sql<string | null>`(select t.name_ar from work.transition_step t where t.id = ${outer(s.request.currentStepId)})`,
      submittedAt: s.request.submittedAt,
      dueAt: s.request.dueAt,
    })
    .from(s.request)
    .innerJoin(parent, eq(parent.id, s.request.parentRequestId))
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .where(and(inArray(s.request.id, found.map((row) => row.id)), inProjects ? or(inProjects, await ownRequest(personId)) : undefined))
    .orderBy(asc(s.request.createdAt), asc(s.request.key));
  return rows.map((row) => ({
    ...row,
    stepEn: row.stepEn ?? "",
    stepAr: row.stepAr ?? row.stepEn ?? "",
    submittedAt: row.submittedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
  }));
}

/** D388: the work items raised for these requests, each with its request and parent item, oldest first. */
export async function readRequestWorkItems(requestKeys: string[]): Promise<RequestReportWorkItem[]> {
  if (requestKeys.length === 0) return [];
  const parentItem = alias(s.workItem, "parent_item");
  const rows = await dbRo()
    .select({
      key: s.workItem.key,
      requestKey: s.request.key,
      parentKey: parentItem.key,
      titleEn: s.workItem.titleEn,
      titleAr: s.workItem.titleAr,
      status: s.workItem.status,
      priority: s.workItem.priority,
      assigneeType: s.workItem.assigneeType,
      assigneeId: s.workItem.assigneeId,
      agentCode: sql<string | null>`(select a.code from ai.agent a where a.id = ${outer(s.workItem.assigneeId)})`,
      dueAt: s.workItem.dueAt,
    })
    .from(s.workItem)
    .innerJoin(s.request, eq(s.request.id, s.workItem.requestId))
    .leftJoin(parentItem, eq(parentItem.id, s.workItem.parentWorkItemId))
    .where(inArray(s.request.key, requestKeys))
    .orderBy(asc(s.workItem.createdAt), asc(s.workItem.key));
  return rows.map((row) => ({
    key: row.key,
    requestKey: row.requestKey,
    parentKey: row.parentKey,
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    status: row.status,
    priority: row.priority,
    assignee: (row.assigneeType === "Agent" ? row.agentCode : row.assigneeId) ?? "",
    dueAt: row.dueAt?.toISOString() ?? null,
  }));
}

/** D388: a Requests report's filters as conditions, over the request, project and type joins. */
async function inquiryWhere(visibleIds: string[] | null, personId: string, filter: RequestInquiry): Promise<SQL | undefined> {
  const inProjects = visibleIds === null ? undefined : visibleIds.length > 0 ? inArray(s.request.projectId, visibleIds) : sql`false`;
  const stepName = sql`(select t.name_en from work.transition_step t where t.id = ${outer(s.request.currentStepId)})`;
  return and(
    inProjects ? or(inProjects, await ownRequest(personId)) : undefined,
    filter.level === "top" ? isNull(s.request.parentRequestId) : filter.level === "sub" ? sql`${s.request.parentRequestId} is not null` : undefined,
    filter.q ? containsTerm(s.request.searchKey, filter.q) : undefined,
    filter.projectKey ? eq(s.project.key, filter.projectKey) : undefined,
    filter.typeCode ? eq(s.requestType.code, filter.typeCode) : undefined,
    filter.status ? eq(s.request.status, filter.status) : undefined,
    filter.requester === "ext"
      ? sql`${s.request.requesterType} <> 'Person'`
      : filter.requester
        ? and(eq(s.request.requesterType, "Person"), eq(s.request.requesterId, filter.requester))
        : undefined,
    filter.channel ? eq(s.request.channel, filter.channel) : undefined,
    filter.step ? sql`${stepName} = ${filter.step}` : undefined,
    filter.submittedFrom ? sql`${s.request.submittedAt} >= ${filter.submittedFrom}` : undefined,
    filter.submittedBefore ? sql`${s.request.submittedAt} < ${filter.submittedBefore}` : undefined,
    filter.dueFrom ? sql`${s.request.dueAt} >= ${filter.dueFrom}` : undefined,
    filter.dueBefore ? sql`${s.request.dueAt} < ${filter.dueBefore}` : undefined,
    filter.overdue ? sql`${s.request.dueAt} < now() and ${s.request.status} not in ('Completed', 'Rejected', 'Closed', 'Cancelled')` : undefined,
  );
}

/**
 * D388: the requests a person may see (`UC-27.1-05`) that match a Requests report's filters,
 * sub-requests included, newest first, at most `limit` of them, and how many match in all.
 */
export async function inquireRequests(
  visibleIds: string[] | null,
  personId: string,
  filter: RequestInquiry,
  limit: number,
): Promise<{ rows: RequestInquiryRow[]; total: number }> {
  const where = await inquiryWhere(visibleIds, personId, filter);
  const parent = alias(s.request, "parent_request");
  const [rows, [counted]] = await Promise.all([
    dbRo()
      .select({
        key: s.request.key,
        parentKey: parent.key,
        titleEn: s.request.titleEn,
        titleAr: s.request.titleAr,
        typeEn: s.requestType.nameEn,
        typeAr: s.requestType.nameAr,
        projectKey: s.project.key,
        requesterType: s.request.requesterType,
        requesterId: s.request.requesterId,
        status: s.request.status,
        stepEn: sql<string | null>`(select t.name_en from work.transition_step t where t.id = ${outer(s.request.currentStepId)})`,
        stepAr: sql<string | null>`(select t.name_ar from work.transition_step t where t.id = ${outer(s.request.currentStepId)})`,
        channel: s.request.channel,
        submittedAt: s.request.submittedAt,
        dueAt: s.request.dueAt,
      })
      .from(s.request)
      .innerJoin(s.project, eq(s.project.id, s.request.projectId))
      .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
      .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
      .leftJoin(parent, eq(parent.id, s.request.parentRequestId))
      .where(where)
      .orderBy(desc(s.request.createdAt), desc(s.request.key))
      .limit(limit),
    dbRo()
      .select({ total: sql<number>`count(*)::int` })
      .from(s.request)
      .innerJoin(s.project, eq(s.project.id, s.request.projectId))
      .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
      .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
      .where(where),
  ]);
  return {
    total: counted?.total ?? 0,
    rows: rows.map((row) => ({
      key: row.key,
      parentKey: row.parentKey,
      titleEn: row.titleEn,
      titleAr: row.titleAr,
      typeEn: row.typeEn,
      typeAr: row.typeAr,
      projectKey: row.projectKey,
      requester: row.requesterType === "Person" ? (row.requesterId ?? "ext") : "ext",
      status: row.status,
      stepEn: row.stepEn ?? "",
      stepAr: row.stepAr ?? row.stepEn ?? "",
      channel: CHANNEL_LABEL[row.channel] ?? row.channel,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      dueAt: row.dueAt?.toISOString() ?? null,
    })),
  };
}

/** D388: the statuses, channels and current steps requests are in, for the Requests report's filters. */
export async function requestInquiryOptions(): Promise<RequestInquiryOptions> {
  const [statuses, channels, steps] = await Promise.all([
    dbRo().selectDistinct({ value: s.request.status }).from(s.request).orderBy(asc(s.request.status)),
    dbRo().selectDistinct({ value: s.request.channel }).from(s.request).orderBy(asc(s.request.channel)),
    dbRo()
      .selectDistinct({ en: s.transitionStep.nameEn, ar: s.transitionStep.nameAr })
      .from(s.transitionStep)
      .innerJoin(s.request, eq(s.request.currentStepId, s.transitionStep.id))
      .orderBy(asc(s.transitionStep.nameEn)),
  ]);
  return {
    statuses: statuses.map((row) => row.value),
    channels: channels.map((row) => row.value),
    steps: steps.map((row) => [row.en, row.ar ?? row.en]),
  };
}

/** D388: when the request with this key was created, or null when there is none. */
export async function requestCreatedAt(key: string): Promise<Date | null> {
  const [row] = await dbRo().select({ createdAt: s.request.createdAt }).from(s.request).where(eq(s.request.key, key)).limit(1);
  return row?.createdAt ?? null;
}
