import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, isNull, like, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db, dbRo, schema as s } from "@/db/client";
import { readMailSettings, type MailSettings } from "@/db/queries/mail";
import { outer } from "@/db/outer";
import { likeLiteral } from "@/db/search";
import { decrypt } from "@/lib/crypto";
import type { AuditRow, DocPage, LogRow, Settings } from "./types";

/** The only module in `governance` that touches Drizzle. */

/**
 * `UC-73.1-02`: the filters belong in the query, not in the browser.
 *
 * The list is the newest N entries. Filtering the page after it is fetched would answer a
 * different question — "which of the newest 200 entries were an agent's" rather than "the
 * newest 200 entries by an agent" — and on an append-only log that mostly carries one kind
 * of actor it reads as "the agents did nothing". The same applies to the period.
 */
export type AuditFilter = {
  /** `People` and `Agents` of the chips; anything else is every actor. */
  actor?: "human" | "agent";
  /** Matches the start of the action code, e.g. `settings:` for every settings change. */
  action?: string;
  /**
   * How far back to look, in days. Resolved here rather than by the caller: "now" is a
   * side effect, and a server component that computes it during render is impure.
   */
  sinceDays?: number;
  /** D388: one record's entries, by its object type and label (a request's or work item's key). */
  objectType?: string;
  objectLabel?: string;
  /** D388: entries from this moment on; a key can be reused after its record is deleted. */
  since?: Date;
  limit?: number;
  /** How many of the newest matching entries to skip: the page a screen is on. */
  offset?: number;
};

/** The audit filter as SQL conditions: actor kind, action prefix, period and record. */
function auditWhere(filter: AuditFilter): SQL[] {
  const where: SQL[] = [];
  if (filter.actor === "agent") where.push(eq(s.auditEntry.actorType, "Agent"));
  if (filter.actor === "human") where.push(ne(s.auditEntry.actorType, "Agent"));
  if (filter.action) where.push(like(s.auditEntry.action, `${likeLiteral(filter.action)}%`));
  if (filter.sinceDays) where.push(gte(s.auditEntry.at, new Date(Date.now() - filter.sinceDays * 24 * 60 * 60 * 1000)));
  if (filter.objectType) where.push(eq(s.auditEntry.objectType, filter.objectType));
  if (filter.objectLabel) where.push(eq(s.auditEntry.objectLabel, filter.objectLabel));
  if (filter.since) where.push(gte(s.auditEntry.at, filter.since));
  return where;
}

/** How many audit entries match, for the screen's pages. */
export async function countAudit(filter: AuditFilter = {}): Promise<number> {
  const where = auditWhere(filter);
  const [row] = await dbRo()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.auditEntry)
    .where(where.length ? and(...where) : undefined);
  return row?.count ?? 0;
}

/** S-73: the audit log, newest first. `audit.audit_entry` is append-only by design. */
export async function listAudit(filter: AuditFilter = {}): Promise<AuditRow[]> {
  const where = auditWhere(filter);

  const rows = await dbRo()
    .select({
      at: s.auditEntry.at,
      actorType: s.auditEntry.actorType,
      actorId: s.auditEntry.actorId,
      actorLabel: s.auditEntry.actorLabel,
      agentCode: sql<string | null>`(select a.code from ai.agent a where a.id = ${outer(s.auditEntry.actorId)})`,
      action: s.auditEntry.action,
      objectType: s.auditEntry.objectType,
      objectLabel: s.auditEntry.objectLabel,
      detail: s.auditEntry.detailJson,
      outcome: s.auditEntry.outcome,
    })
    .from(s.auditEntry)
    .where(where.length ? and(...where) : undefined)
    // The id breaks ties between entries of the same instant, so pages never overlap.
    .orderBy(desc(s.auditEntry.at), desc(s.auditEntry.id))
    .limit(filter.limit ?? 200)
    .offset(filter.offset ?? 0);

  return rows.map((row) => ({
    at: row.at.toISOString(),
    actorType: row.actorType,
    actor: (row.actorType === "Agent" ? row.agentCode : row.actorId) ?? "",
    actorLabel: row.actorLabel ?? "",
    action: row.action,
    objectType: row.objectType,
    objectLabel: row.objectLabel,
    detail: row.detail ? JSON.stringify(row.detail) : "",
    outcome: row.outcome,
  }));
}

/** `UC-74.1-02`: level, service and run, applied in the query for the reason above. */
export type LogFilter = {
  level?: string;
  service?: string;
  /** The run a line belongs to, which the Logs screen calls the correlation id. */
  runId?: string;
  limit?: number;
  offset?: number;
};

/** The log filter as SQL conditions: level, service and run. */
function logWhere(filter: LogFilter): SQL[] {
  const where: SQL[] = [];
  if (filter.level) where.push(eq(s.logEntry.level, filter.level));
  if (filter.service) where.push(eq(s.logEntry.service, filter.service));
  if (filter.runId) where.push(eq(s.logEntry.correlationId, filter.runId));
  return where;
}

/** How many log lines match, for the screen's pages. */
export async function countLogs(filter: LogFilter = {}): Promise<number> {
  const where = logWhere(filter);
  const [row] = await dbRo()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.logEntry)
    .where(where.length ? and(...where) : undefined);
  return row?.count ?? 0;
}

/** S-74: the service log. SD-4 keeps it in PostgreSQL for installs this size. */
export async function listLogs(filter: LogFilter = {}): Promise<LogRow[]> {
  const where = logWhere(filter);

  const rows = await dbRo()
    .select({
      at: s.logEntry.at,
      level: s.logEntry.level,
      service: s.logEntry.service,
      correlationId: s.logEntry.correlationId,
      message: s.logEntry.message,
    })
    .from(s.logEntry)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.logEntry.at), desc(s.logEntry.id))
    .limit(filter.limit ?? 200)
    .offset(filter.offset ?? 0);
  return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
}

/** The services that actually appear in the log, for the Logs screen's service filter. */
export async function listLogServices(): Promise<string[]> {
  const rows = await dbRo().selectDistinct({ service: s.logEntry.service }).from(s.logEntry).orderBy(asc(s.logEntry.service));
  return rows.map((row) => row.service);
}

/** S-75: the organisation, its branding and its feature flags. */
export async function readSettings(): Promise<Settings> {
  const [organisation] = await dbRo()
    .select({
      nameEn: s.organisation.nameEn,
      nameAr: s.organisation.nameAr,
      timeZone: s.organisation.timeZone,
      languages: s.organisation.languages,
      workingCalendarId: s.organisation.workingCalendarId,
      holidayCalendarId: s.organisation.holidayCalendarId,
    })
    .from(s.organisation)
    .limit(1);

  const calendars = await dbRo().select({ id: s.calendar.id, nameEn: s.calendar.nameEn, nameAr: s.calendar.nameAr }).from(s.calendar);

  const [version] = await dbRo()
    .select({ versionNumber: s.settingsVersion.versionNumber, settings: s.settingsVersion.settingsJson })
    .from(s.settingsVersion)
    .orderBy(desc(s.settingsVersion.versionNumber))
    .limit(1);

  const branding = await dbRo().select({ kind: s.brandingAsset.kind, contentRef: s.brandingAsset.contentRef }).from(s.brandingAsset);

  const flags = await dbRo()
    .select({ key: s.featureFlag.key, group: s.featureFlag.group, nameEn: s.featureFlag.nameEn, nameAr: s.featureFlag.nameAr, enabled: s.featureFlag.isEnabled })
    .from(s.featureFlag)
    .orderBy(asc(s.featureFlag.group), asc(s.featureFlag.nameEn));

  const working = calendars.find((calendar) => calendar.id === organisation?.workingCalendarId);
  const holidays = calendars.find((calendar) => calendar.id === organisation?.holidayCalendarId);
  const settings = (version?.settings ?? {}) as { branding?: { brandColour?: string } };

  const { passwordCipher, ...mail } = await readMailSettings();

  return {
    mail: { ...mail, hasPassword: Boolean(passwordCipher) },
    organisation: {
      nameEn: organisation?.nameEn ?? "",
      nameAr: organisation?.nameAr ?? "",
      timeZone: organisation?.timeZone ?? "Asia/Dubai",
      languages: organisation?.languages ?? [],
    },
    workingCalendarEn: working?.nameEn ?? "",
    workingCalendarAr: working?.nameAr ?? "",
    holidayCalendarEn: holidays?.nameEn ?? "",
    holidayCalendarAr: holidays?.nameAr ?? "",
    workingCalendarId: organisation?.workingCalendarId ?? null,
    holidayCalendarId: organisation?.holidayCalendarId ?? null,
    brandColour: settings.branding?.brandColour ?? "#0677FF",
    versionNumber: version?.versionNumber ?? 0,
    branding: branding.map((asset) => ({ kind: asset.kind, contentRef: asset.contentRef ?? "" })),
    flags,
  };
}

/** S-78: whether agents are paused, and how much work is in flight. */
export async function readSystemState() {
  const [state] = await dbRo()
    .select({ agentsPaused: s.systemState.agentsPaused, pausedAt: s.systemState.pausedAt })
    .from(s.systemState)
    .limit(1);
  const [runs] = await dbRo()
    .select({
      active: sql<number>`count(*) filter (where ${s.run.status} in ('Running', 'Waiting'))::int`,
      queued: sql<number>`count(*) filter (where ${s.run.status} = 'Queued')::int`,
    })
    .from(s.run);
  const [rooms] = await dbRo()
    .select({ active: sql<number>`count(*) filter (where ${s.discussionRoom.status} = 'Active')::int` })
    .from(s.discussionRoom);
  return {
    agentsPaused: state?.agentsPaused ?? false,
    pausedAt: state?.pausedAt?.toISOString() ?? null,
    activeRuns: runs?.active ?? 0,
    queueDepth: runs?.queued ?? 0,
    activeRooms: rooms?.active ?? 0,
  };
}

/**
 * `UC-78.1-02` and `-03`: pause or resume every agent.
 *
 * The flag is the whole state, for agents and runs alike. The screens derive each agent's
 * shown status from it, and a paused agent starts no run. A run already going is drained:
 * its workflow finishes and keeps its own status, so a resume has nothing to put back and
 * cannot mistake a run that was Queued before the pause for one the pause stopped.
 */
export async function setAgentsPaused(paused: boolean, personId: string): Promise<void> {
  await db()
    .update(s.systemState)
    .set({ agentsPaused: paused, pausedBy: paused ? personId : null, pausedAt: paused ? new Date() : null, updatedAt: new Date(), updatedBy: personId });
}

/** S-79: the documentation pages. */
export async function listDocPages(): Promise<DocPage[]> {
  return dbRo()
    .select({ slug: s.docPage.slug, titleEn: s.docPage.titleEn, titleAr: s.docPage.titleAr, bodyEn: s.docPage.bodyEn, bodyAr: s.docPage.bodyAr })
    .from(s.docPage)
    .orderBy(asc(s.docPage.sortOrder))
    .then((rows) => rows.map((row) => ({ ...row, bodyEn: row.bodyEn ?? "", bodyAr: row.bodyAr ?? "" })));
}

/** `UC-75.2-04`: an accepted brand colour is written as a new settings version. */
export async function saveBrandColour(colour: string, personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [current] = await tx
      .select({ versionNumber: s.settingsVersion.versionNumber, settings: s.settingsVersion.settingsJson })
      .from(s.settingsVersion)
      .orderBy(desc(s.settingsVersion.versionNumber))
      .limit(1);
    const settings = (current?.settings ?? {}) as Record<string, unknown>;
    const branding = { ...((settings.branding ?? {}) as Record<string, unknown>), brandColour: colour };
    await tx.insert(s.settingsVersion).values({
      versionNumber: (current?.versionNumber ?? 0) + 1,
      settingsJson: { ...settings, branding },
      changedBy: personId,
      changedAt: new Date(),
      createdBy: personId,
      updatedBy: personId,
    });
  });
}

/** D240: the mail server and the templates, written as a new settings version like the brand colour. */
export async function saveMailSettings(mail: MailSettings, personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [current] = await tx
      .select({ versionNumber: s.settingsVersion.versionNumber, settings: s.settingsVersion.settingsJson })
      .from(s.settingsVersion)
      .orderBy(desc(s.settingsVersion.versionNumber))
      .limit(1);
    const settings = (current?.settings ?? {}) as Record<string, unknown>;
    await tx.insert(s.settingsVersion).values({
      versionNumber: (current?.versionNumber ?? 0) + 1,
      settingsJson: { ...settings, mail },
      changedBy: personId,
      changedAt: new Date(),
      createdBy: personId,
      updatedBy: personId,
    });
  });
}

/** `UC-75.2-01`: one branding asset per kind, replaced on each upload. */
export async function saveBrandingAsset(kind: string, contentRef: string, personId: string): Promise<void> {
  await db()
    .insert(s.brandingAsset)
    .values({ kind, contentRef, uploadedBy: personId, createdBy: personId, updatedBy: personId })
    .onConflictDoUpdate({
      target: s.brandingAsset.kind,
      set: { contentRef, uploadedBy: personId, updatedBy: personId, updatedAt: new Date() },
    });
}

/** Removes the uploaded asset of one kind. */
export async function deleteBrandingAsset(kind: string): Promise<void> {
  await db().delete(s.brandingAsset).where(eq(s.brandingAsset.kind, kind));
}

/** Turns one feature flag on or off (data model section 20). */
export async function setFeatureFlag(key: string, enabled: boolean, personId: string): Promise<void> {
  await db().update(s.featureFlag).set({ isEnabled: enabled, updatedAt: new Date(), updatedBy: personId }).where(eq(s.featureFlag.key, key));
}

/**
 * `UC-75.1-01`: the organisation's general settings, written as a new settings version.
 *
 * The row is updated and the version appended in one transaction, so the history cannot
 * record a change the organisation did not take, or miss one it did.
 */
export async function saveGeneralSettings(
  values: {
    nameEn: string;
    nameAr: string;
    timeZone: string;
    languages: string[];
    workingCalendarId: string | null;
    holidayCalendarId: string | null;
  },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(s.organisation)
      .set({ ...values, updatedAt: new Date(), updatedBy: personId });

    const [current] = await tx
      .select({ versionNumber: s.settingsVersion.versionNumber, settings: s.settingsVersion.settingsJson })
      .from(s.settingsVersion)
      .orderBy(desc(s.settingsVersion.versionNumber))
      .limit(1);
    const settings = (current?.settings ?? {}) as Record<string, unknown>;
    await tx.insert(s.settingsVersion).values({
      versionNumber: (current?.versionNumber ?? 0) + 1,
      settingsJson: { ...settings, general: values },
      changedBy: personId,
      changedAt: new Date(),
      createdBy: personId,
      updatedBy: personId,
    });
  });
}

/** The calendars a working or holiday calendar may be set to. */
export async function calendarIds(): Promise<Set<string>> {
  const rows = await dbRo().select({ id: s.calendar.id }).from(s.calendar);
  return new Set(rows.map((row) => row.id));
}

/**
 * `UC-75.3-02`: the deployments that would stop loading if embedded deployments were
 * turned off — the enabled ones, which is what the confirmation has to list. A draft or
 * already-disabled deployment is serving nobody, so naming it would only pad the warning.
 */
export async function liveDeployments(): Promise<{ key: string; name: string }[]> {
  return dbRo()
    .select({ key: s.embeddedDeployment.code, name: s.embeddedDeployment.nameEn })
    .from(s.embeddedDeployment)
    .where(eq(s.embeddedDeployment.status, "Enabled"))
    .orderBy(asc(s.embeddedDeployment.code));
}

/**
 * `UC-75.2-01` and `UC-75.2-03`: the branding the console actually renders.
 *
 * Read on its own rather than through `readSettings`, because the shell needs it on every
 * console page and `settings:read` is a permission most people do not hold — the branding
 * is what they see, not something they administer.
 */
export async function readBranding(): Promise<{
  logoLight: string | null;
  logoDark: string | null;
  favicon: string | null;
  brandColour: string | null;
}> {
  const [assets, [version]] = await Promise.all([
    dbRo().select({ kind: s.brandingAsset.kind, contentRef: s.brandingAsset.contentRef }).from(s.brandingAsset),
    dbRo()
      .select({ settings: s.settingsVersion.settingsJson })
      .from(s.settingsVersion)
      .orderBy(desc(s.settingsVersion.versionNumber))
      .limit(1),
  ]);
  const byKind = new Map(assets.map((asset) => [asset.kind, asset.contentRef]));
  const settings = (version?.settings ?? {}) as { branding?: { brandColour?: string } };
  return {
    logoLight: byKind.get("LogoLight") ?? null,
    logoDark: byKind.get("LogoDark") ?? null,
    favicon: byKind.get("Favicon") ?? null,
    brandColour: settings.branding?.brandColour ?? null,
  };
}

/**
 * Whether a platform feature is switched on (`UC-75.3-01`).
 *
 * Read from the row on each request rather than cached per session, because the scenario
 * says a toggle changes what people see "for all users" — including the ones already
 * signed in. An unknown key is off: nothing may be enabled by absence.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ enabled: s.featureFlag.isEnabled })
    .from(s.featureFlag)
    .where(eq(s.featureFlag.key, key))
    .limit(1);
  return row?.enabled ?? false;
}

/* ---------------------------------- D240: system email notifications */


/** What one email is about, read when it is sent so it says what is true then. */
export type NoticeFacts = {
  id: string;
  kind: string;
  /** This try, counting it. */
  attempts: number;
  recipient: string;
  language: string;
  outcome: string;
  key: string;
  titleEn: string;
  titleAr: string;
  summaryEn: string;
  summaryAr: string;
  finishedAt: Date | null;
  path: string;
  /** The step a request is at, for the created and updated emails (D247). */
  stepEn: string;
  stepAr: string;
  /** An agent's email (D242), sent as written rather than from a template. */
  message?: { subject: string; text: string };
  /** An invitation (D248): who invited whom, into which role, and the token for the link. */
  invitation?: { id: string; token: string; expiresAt: Date; nameEn: string; nameAr: string; inviterEn: string; inviterAr: string; roleEn: string; roleAr: string; organisationEn: string; organisationAr: string };
};

/**
 * Takes a queued notice for sending, so two consumers never send one twice: null when it is
 * not this caller's to send, "gone" when its item or recipient no longer exists. A notice
 * left Sending by a consumer that stopped is taken again once it is ten minutes old.
 */
export async function claimNotice(id: string): Promise<NoticeFacts | "gone" | null> {
  const [taken] = await db()
    .update(s.mailNotification)
    .set({ status: "Sending", attempts: sql`${s.mailNotification.attempts} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(s.mailNotification.id, id),
        // The database's clock, which also wrote the times compared here.
        sql`${s.mailNotification.nextAttemptAt} <= now()`,
        or(
          eq(s.mailNotification.status, "Queued"),
          and(eq(s.mailNotification.status, "Sending"), sql`${s.mailNotification.updatedAt} <= now() - interval '10 minutes'`),
        ),
      ),
    )
    .returning({
      id: s.mailNotification.id,
      kind: s.mailNotification.kind,
      subjectType: s.mailNotification.subjectType,
      subjectId: s.mailNotification.subjectId,
      personId: s.mailNotification.personId,
      recipient: s.mailNotification.recipient,
      outcome: s.mailNotification.outcome,
      attempts: s.mailNotification.attempts,
      mailSubject: s.mailNotification.mailSubject,
      mailBody: s.mailNotification.mailBody,
    });
  if (!taken) return null;
  // An agent email and an Inbox alert are written whole, with their own subject and text.
  if (taken.kind === "AgentEmail" || taken.kind === "Alert") {
    if (!taken.recipient || taken.mailSubject === null || taken.mailBody === null) return "gone";
    return {
      id: taken.id,
      kind: taken.kind,
      attempts: taken.attempts,
      recipient: taken.recipient,
      language: "en",
      outcome: taken.outcome,
      key: "",
      titleEn: "",
      titleAr: "",
      summaryEn: "",
      summaryAr: "",
      finishedAt: null,
      path: "",
      stepEn: "",
      stepAr: "",
      message: { subject: taken.mailSubject, text: taken.mailBody },
    };
  }
  if (!taken.subjectId || !taken.recipient) return "gone";
  if (taken.kind === "Invitation") return invitationFacts(taken.subjectId, { id: taken.id, kind: taken.kind, attempts: taken.attempts, recipient: taken.recipient, outcome: taken.outcome });

  const [person] = taken.personId
    ? await dbRo().select({ language: s.person.preferredLanguage }).from(s.person).where(eq(s.person.id, taken.personId))
    : [];
  const base = { id: taken.id, kind: taken.kind, attempts: taken.attempts, recipient: taken.recipient, language: person?.language ?? "en", outcome: taken.outcome };

  if (taken.subjectType === "Request") {
    const [request] = await dbRo()
      .select({
        key: s.request.key,
        titleEn: s.request.titleEn,
        titleAr: s.request.titleAr,
        finishedAt: s.request.updatedAt,
        stepEn: sql<string>`coalesce(${s.transitionStep.nameEn}, '')`,
        stepAr: sql<string>`coalesce(${s.transitionStep.nameAr}, '')`,
      })
      .from(s.request)
      .leftJoin(s.transitionStep, eq(s.transitionStep.id, s.request.currentStepId))
      .where(eq(s.request.id, taken.subjectId));
    if (!request) return "gone";
    const [last] = await dbRo()
      .select({ en: s.requestEvent.detailEn, ar: s.requestEvent.detailAr })
      .from(s.requestEvent)
      .where(eq(s.requestEvent.requestId, taken.subjectId))
      .orderBy(desc(s.requestEvent.at))
      .limit(1);
    return { ...base, ...request, summaryEn: last?.en ?? "", summaryAr: last?.ar ?? "", path: `/requests?open=${encodeURIComponent(request.key)}` };
  }

  const [item] = await dbRo()
    .select({ key: s.workItem.key, titleEn: s.workItem.titleEn, titleAr: s.workItem.titleAr, finishedAt: s.workItem.updatedAt })
    .from(s.workItem)
    .where(eq(s.workItem.id, taken.subjectId));
  if (!item) return "gone";
  const [last] = await dbRo()
    .select({ en: s.workItemActivity.detailEn, ar: s.workItemActivity.detailAr })
    .from(s.workItemActivity)
    .where(eq(s.workItemActivity.workItemId, taken.subjectId))
    .orderBy(desc(s.workItemActivity.at))
    .limit(1);
  return { ...base, ...item, stepEn: "", stepAr: "", summaryEn: last?.en ?? "", summaryAr: last?.ar ?? "", path: `/work-items?open=${encodeURIComponent(item.key)}` };
}

/**
 * D248: what an invitation email says, read when it is sent. "gone" once the invitation was
 * accepted, withdrawn, expired or its token already cleared after an earlier send.
 */
async function invitationFacts(
  invitationId: string,
  base: { id: string; kind: string; attempts: number; recipient: string; outcome: string },
): Promise<NoticeFacts | "gone"> {
  const inviter = alias(s.person, "inviter");
  const [row] = await dbRo()
    .select({
      tokenCipher: s.personInvitation.tokenCipher,
      expiresAt: s.personInvitation.expiresAt,
      personId: s.person.id,
      nameEn: s.person.nameEn,
      nameAr: s.person.nameAr,
      language: s.person.preferredLanguage,
      inviterEn: sql<string>`coalesce(${inviter.nameEn}, '')`,
      inviterAr: sql<string>`coalesce(${inviter.nameAr}, '')`,
    })
    .from(s.personInvitation)
    .innerJoin(s.person, eq(s.person.id, s.personInvitation.personId))
    .leftJoin(inviter, eq(inviter.id, s.personInvitation.createdBy))
    .where(
      and(
        eq(s.personInvitation.id, invitationId),
        isNull(s.personInvitation.acceptedAt),
        isNull(s.personInvitation.revokedAt),
        sql`${s.personInvitation.expiresAt} > now()`,
        eq(s.person.status, "Invited"),
      ),
    );
  if (!row?.tokenCipher) return "gone";
  const [role] = await dbRo()
    .select({ nameEn: s.role.nameEn, nameAr: s.role.nameAr })
    .from(s.roleAssignment)
    .innerJoin(s.role, eq(s.role.id, s.roleAssignment.roleId))
    .where(eq(s.roleAssignment.personId, row.personId))
    .limit(1);
  const [organisation] = await dbRo().select({ nameEn: s.organisation.nameEn, nameAr: s.organisation.nameAr }).from(s.organisation).limit(1);
  return {
    ...base,
    language: row.language ?? "en",
    key: "",
    titleEn: "",
    titleAr: "",
    summaryEn: "",
    summaryAr: "",
    finishedAt: null,
    path: "",
    stepEn: "",
    stepAr: "",
    invitation: {
      id: invitationId,
      token: decrypt(Buffer.from(row.tokenCipher, "base64")),
      expiresAt: row.expiresAt,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      inviterEn: row.inviterEn,
      inviterAr: row.inviterAr,
      roleEn: role?.nameEn ?? "",
      roleAr: role?.nameAr ?? "",
      organisationEn: organisation?.nameEn ?? "",
      organisationAr: organisation?.nameAr ?? "",
    },
  };
}

/** D248: once its email is sent, the token is no longer kept anywhere but in that email. */
export async function clearInvitationToken(invitationId: string): Promise<void> {
  await db().update(s.personInvitation).set({ tokenCipher: null, updatedAt: sql`now()` }).where(eq(s.personInvitation.id, invitationId));
}

/** The notice was sent: status Sent, the send time, and no reason. */
export async function markNoticeSent(id: string): Promise<void> {
  await db().update(s.mailNotification).set({ status: "Sent", sentAt: new Date(), reason: null, updatedAt: new Date() }).where(eq(s.mailNotification.id, id));
}

/** A transient failure: back in the queue, to be tried again in `minutes`. */
export async function markNoticeRetry(id: string, reason: string, minutes: number): Promise<void> {
  await db()
    .update(s.mailNotification)
    .set({ status: "Queued", reason, nextAttemptAt: sql`now() + make_interval(mins => ${minutes})`, updatedAt: sql`now()` })
    .where(eq(s.mailNotification.id, id));
}

/** A permanent failure, or a transient one past its last attempt: status Failed with the reason; not retried. */
export async function markNoticeFailed(id: string, reason: string): Promise<void> {
  await db().update(s.mailNotification).set({ status: "Failed", reason, updatedAt: new Date() }).where(eq(s.mailNotification.id, id));
}

/** A notice that can no longer be sent: its item or recipient is gone. */
export async function markNoticeSkipped(id: string, reason: string): Promise<void> {
  await db().update(s.mailNotification).set({ status: "Skipped", reason, updatedAt: new Date() }).where(eq(s.mailNotification.id, id));
}

/** The notices due now, for the sweep that covers a job Valkey lost or a retry that is due. */
export async function dueNoticeIds(limit: number): Promise<string[]> {
  const rows = await dbRo()
    .select({ id: s.mailNotification.id })
    .from(s.mailNotification)
    .where(
      and(
        inArray(s.mailNotification.status, ["Queued", "Sending"]),
        sql`${s.mailNotification.nextAttemptAt} <= now()`,
        or(eq(s.mailNotification.status, "Queued"), sql`${s.mailNotification.updatedAt} <= now() - interval '10 minutes'`),
      ),
    )
    .orderBy(s.mailNotification.nextAttemptAt)
    .limit(limit);
  return rows.map((row) => row.id);
}

/** The latest notices, for Settings → Email. */
export async function recentNotices(limit: number) {
  return dbRo()
    .select({
      id: s.mailNotification.id,
      kind: s.mailNotification.kind,
      recipient: s.mailNotification.recipient,
      outcome: s.mailNotification.outcome,
      status: s.mailNotification.status,
      reason: s.mailNotification.reason,
      attempts: s.mailNotification.attempts,
      createdAt: s.mailNotification.createdAt,
      sentAt: s.mailNotification.sentAt,
    })
    .from(s.mailNotification)
    .orderBy(desc(s.mailNotification.createdAt))
    .limit(limit);
}

/**
 * An agent's email (D242), one row per recipient. The key is the run, the message and the
 * recipient, so a retried tool call queues nothing new; returns the rows it queued.
 */
export async function queueAgentEmail(input: {
  runId: string;
  actorId: string;
  recipients: { personId: string; email: string }[];
  subject: string;
  body: string;
}): Promise<string[]> {
  const digest = createHash("sha256").update(JSON.stringify([input.subject, input.body])).digest("hex").slice(0, 32);
  const rows = await db()
    .insert(s.mailNotification)
    .values(
      input.recipients.map((recipient) => ({
        notificationKey: `AgentEmail:${input.runId}:${digest}:${recipient.personId}`,
        kind: "AgentEmail",
        subjectType: "Run",
        subjectId: input.runId,
        runId: input.runId,
        personId: recipient.personId,
        recipient: recipient.email,
        outcome: "Email",
        mailSubject: input.subject,
        mailBody: input.body,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })),
    )
    .onConflictDoNothing({ target: s.mailNotification.notificationKey })
    .returning({ id: s.mailNotification.id });
  return rows.map((row) => row.id);
}

/** Active people by e-mail address, compared without case. */
export async function activePeopleByEmail(emails: string[]): Promise<{ id: string; email: string }[]> {
  if (emails.length === 0) return [];
  return dbRo()
    .select({ id: s.person.id, email: s.person.email })
    .from(s.person)
    .where(and(eq(s.person.status, "Active"), inArray(sql`lower(${s.person.email})`, emails.map((email) => email.toLowerCase()))));
}

/** A test email's own record, written as it was sent. */
export async function recordTestEmail(input: { recipient: string; status: "Sent" | "Failed"; reason: string | null; personId: string }): Promise<void> {
  await db()
    .insert(s.mailNotification)
    .values({
      notificationKey: `Test:${crypto.randomUUID()}`,
      kind: "Test",
      subjectType: "None",
      personId: input.personId,
      recipient: input.recipient,
      outcome: "Test",
      status: input.status,
      reason: input.reason,
      attempts: 1,
      sentAt: input.status === "Sent" ? new Date() : null,
      createdBy: input.personId,
      updatedBy: input.personId,
    });
}

/** D388: the organisation's names, for the letterhead of a report. */
export async function readOrganisationName(): Promise<{ nameEn: string; nameAr: string }> {
  const [row] = await dbRo().select({ nameEn: s.organisation.nameEn, nameAr: s.organisation.nameAr }).from(s.organisation).limit(1);
  return row ?? { nameEn: "", nameAr: "" };
}
