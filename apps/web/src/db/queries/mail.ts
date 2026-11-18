import { desc, eq, inArray } from "drizzle-orm";

import { type Database, dbRo, schema as s } from "@/db/client";
import { env } from "@/lib/env";
import { MAIL_TEMPLATE_KINDS } from "@/db/schema/enums";
import { textToHtml } from "@/lib/mail-html";

/**
 * D240: the system email notifications' shared queries. The requests and work items
 * repositories queue a notice inside the transaction that finishes the item, so a notice
 * exists exactly when the finished state does; the notifications module sends it.
 */

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** A transaction or the connection: a notice is written in whichever the caller is in. */
type Executor = Database | Tx;

/** What a notice changed: the emails to send, and the people whose Inbox gained an item. */
export type Notices = { mail: string[]; told: string[] };
export const NO_NOTICES: Notices = { mail: [], told: [] };

/**
 * One email template, in both languages, with `{{key}}`-style placeholders. The subject is
 * text; the body is HTML (D247). A template switched off sends nothing.
 */
export type MailTemplate = { enabled: boolean; subjectEn: string; bodyEn: string; subjectAr: string; bodyAr: string };

export { MAIL_TEMPLATE_KINDS };
export type MailTemplateKind = (typeof MAIL_TEMPLATE_KINDS)[number];

/** The platform's mail server and the templates, as Settings stores them. */
export type MailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  /** `tls` from the first byte, `starttls` after the greeting, `none` for a local sink. */
  security: "tls" | "starttls" | "none";
  username: string;
  /** The password as an `APP_KEK` envelope, base64; never sent back to a screen. */
  passwordCipher: string | null;
  fromAddress: string;
  fromName: string;
  templates: Record<MailTemplateKind, MailTemplate>;
};

const FINISHED_EN = '<p><strong>{{title}}</strong></p><p>{{key}} is {{outcome}}.</p><p>{{summary}}</p><p>Finished: {{completedAt}}</p><p><a href="{{link}}">Open it</a></p>';
const FINISHED_AR = '<p><strong>{{title}}</strong></p><p>{{key}}: {{outcome}}.</p><p>{{summary}}</p><p>اكتمل: {{completedAt}}</p><p><a href="{{link}}">افتحه</a></p>';

export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  enabled: false,
  host: "",
  port: 587,
  security: "starttls",
  username: "",
  passwordCipher: null,
  fromAddress: "",
  fromName: "Juman Platform",
  templates: {
    requestCreated: {
      enabled: true,
      subjectEn: "{{key}} received: {{title}}",
      bodyEn: '<p><strong>{{title}}</strong></p><p>Your request {{key}} was received and is at {{step}}.</p><p><a href="{{link}}">Open the request</a></p>',
      subjectAr: "استُلم {{key}}: {{title}}",
      bodyAr: '<p><strong>{{title}}</strong></p><p>استُلم طلبك {{key}} وهو الآن في {{step}}.</p><p><a href="{{link}}">افتح الطلب</a></p>',
    },
    requestUpdated: {
      enabled: true,
      subjectEn: "{{key}} {{outcome}}: {{title}}",
      bodyEn: '<p><strong>{{title}}</strong></p><p>{{key}} is now at {{step}} ({{outcome}}).</p><p>{{summary}}</p><p><a href="{{link}}">Open the request</a></p>',
      subjectAr: "{{key}} {{outcome}}: {{title}}",
      bodyAr: '<p><strong>{{title}}</strong></p><p>{{key}} الآن في {{step}} ({{outcome}}).</p><p>{{summary}}</p><p><a href="{{link}}">افتح الطلب</a></p>',
    },
    requestFinished: { enabled: true, subjectEn: "{{key}} {{outcome}}: {{title}}", bodyEn: FINISHED_EN, subjectAr: "{{key}} {{outcome}}: {{title}}", bodyAr: FINISHED_AR },
    workItemFinished: { enabled: true, subjectEn: "{{key}} {{outcome}}: {{title}}", bodyEn: FINISHED_EN, subjectAr: "{{key}} {{outcome}}: {{title}}", bodyAr: FINISHED_AR },
    invitation: {
      enabled: true,
      subjectEn: "{{inviter}} invited you to {{organisation}}",
      bodyEn:
        '<p>Hello {{name}},</p><p>{{inviter}} invited you to {{organisation}} on the Juman Platform as {{role}}.</p><p><a href="{{link}}">Accept the invitation</a></p><p>The link works once, until {{expiresAt}}.</p>',
      subjectAr: "دعاك {{inviter}} إلى {{organisation}}",
      bodyAr:
        '<p>مرحباً {{name}}،</p><p>دعاك {{inviter}} إلى {{organisation}} على منصة جُمان بدور {{role}}.</p><p><a href="{{link}}">قبول الدعوة</a></p><p>يعمل الرابط مرة واحدة حتى {{expiresAt}}.</p>',
    },
  },
};

/** The mail settings of the latest settings version, over the defaults. */
export async function readMailSettings(): Promise<MailSettings> {
  const [latest] = await dbRo()
    .select({ settings: s.settingsVersion.settingsJson })
    .from(s.settingsVersion)
    .orderBy(desc(s.settingsVersion.versionNumber))
    .limit(1);
  const stored = ((latest?.settings ?? {}) as { mail?: Partial<MailSettings> }).mail ?? {};
  const templates = (stored.templates ?? {}) as Partial<Record<MailTemplateKind, Partial<MailTemplate>>>;
  return {
    ...DEFAULT_MAIL_SETTINGS,
    ...stored,
    templates: Object.fromEntries(
      MAIL_TEMPLATE_KINDS.map((kind) => {
        const template = { ...DEFAULT_MAIL_SETTINGS.templates[kind], ...(templates[kind] ?? {}) };
        // A body saved before bodies were HTML is plain text.
        return [kind, { ...template, bodyEn: textToHtml(template.bodyEn), bodyAr: textToHtml(template.bodyAr) }];
      }),
    ) as Record<MailTemplateKind, MailTemplate>,
  };
}

/** Whether the mail server is switched on and named; a notice is skipped otherwise. */
export function mailReady(settings: MailSettings): boolean {
  return settings.enabled && settings.host.trim() !== "" && settings.fromAddress.trim() !== "";
}

const REQUEST_FINAL = ["Completed", "Rejected", "Closed", "Cancelled"];
const WORK_ITEM_FINAL = ["Done", "Cancelled"];

/** Whether this status ends the item, so finishing it is what a notice is about. */
export function finalStatus(subject: "Request" | "WorkItem", status: string): boolean {
  return (subject === "Request" ? REQUEST_FINAL : WORK_ITEM_FINAL).includes(status);
}

/**
 * Queues the notices of one finished request or work item, inside the transaction that
 * finished it, and returns the ids of those to send. One row per person the item is for:
 * Queued when they can be emailed, Skipped with the reason when they cannot, so every
 * decision is observable. The key is the event and the person, so the same event retried
 * writes nothing twice (D240).
 */
export async function queueFinishedNotices(
  tx: Tx,
  input: {
    subjectType: "Request" | "WorkItem";
    subjectId: string;
    outcome: string;
    /** The event row that recorded the finish, which makes the key unique to it. */
    eventId: string;
    /** People to leave out: whoever finished it themselves already knows. */
    except: string[];
    actorId: string;
  },
): Promise<Notices> {
  return queueNotices(tx, { ...input, kind: input.subjectType === "Request" ? "RequestFinished" : "WorkItemFinished" });
}

/**
 * D247: a request's requester is told when it is created (a receipt) and when it moves to
 * another step or is returned; the same rules as a finished request otherwise.
 */
export async function queueRequestNotices(
  tx: Tx,
  input: { kind: "RequestCreated" | "RequestUpdated"; requestId: string; outcome: string; eventId: string; except: string[]; actorId: string },
): Promise<Notices> {
  return queueNotices(tx, { kind: input.kind, subjectType: "Request", subjectId: input.requestId, outcome: input.outcome, eventId: input.eventId, except: input.except, actorId: input.actorId });
}

type NoticeKind = "RequestCreated" | "RequestUpdated" | "RequestFinished" | "WorkItemFinished";

const TEMPLATE_OF: Record<NoticeKind, MailTemplateKind> = {
  RequestCreated: "requestCreated",
  RequestUpdated: "requestUpdated",
  RequestFinished: "requestFinished",
  WorkItemFinished: "workItemFinished",
};

const UPDATE_LABEL: Record<NoticeKind, [string, string]> = {
  RequestCreated: ["Request submitted", "تم تقديم الطلب"],
  RequestUpdated: ["Request updated", "تحديث الطلب"],
  RequestFinished: ["Request finished", "اكتمل الطلب"],
  WorkItemFinished: ["Work item finished", "اكتمل بند العمل"],
};

/**
 * Tells each person a request or work item is for, inside the caller's transaction: a request's
 * requester when a person, or a top-level work item's creator and its person assignee and
 * reviewer, less `except`. Everyone is told in their Inbox as an Update (D394); the email is a
 * row each, Queued, or Skipped with the first reason that applies (mail server off, person not
 * active, no email, email turned off). A key already written is not written again. The Inbox
 * item does not depend on the mail server, the template or the person's email choice; the
 * emails do, and nothing is written for them while the template is switched off.
 */
async function queueNotices(
  tx: Tx,
  input: { kind: NoticeKind; subjectType: "Request" | "WorkItem"; subjectId: string; outcome: string; eventId: string; except: string[]; actorId: string },
): Promise<Notices> {
  const recipients = new Set<string>();
  let subject: { key: string; titleEn: string; titleAr: string } | undefined;
  if (input.subjectType === "Request") {
    const [row] = await tx
      .select({ type: s.request.requesterType, id: s.request.requesterId, key: s.request.key, titleEn: s.request.titleEn, titleAr: s.request.titleAr })
      .from(s.request)
      .where(eq(s.request.id, input.subjectId));
    if (row?.type === "Person") recipients.add(row.id);
    subject = row;
  } else {
    const [row] = await tx
      .select({
        key: s.workItem.key,
        titleEn: s.workItem.titleEn,
        titleAr: s.workItem.titleAr,
        createdBy: s.workItem.createdBy,
        assigneeType: s.workItem.assigneeType,
        assigneeId: s.workItem.assigneeId,
        reviewerType: s.workItem.reviewerType,
        reviewerId: s.workItem.reviewerId,
        parent: s.workItem.parentWorkItemId,
      })
      .from(s.workItem)
      .where(eq(s.workItem.id, input.subjectId));
    // A sub item is finished inside its parent; the parent's finish is the one to tell.
    if (row && !row.parent) {
      if (row.createdBy) recipients.add(row.createdBy);
      if (row.assigneeType === "Person" && row.assigneeId) recipients.add(row.assigneeId);
      if (row.reviewerType === "Person" && row.reviewerId) recipients.add(row.reviewerId);
    }
    subject = row;
  }
  for (const person of input.except) recipients.delete(person);
  if (recipients.size === 0 || !subject) return NO_NOTICES;

  const [labelEn, labelAr] = UPDATE_LABEL[input.kind];
  const told = (await insertUpdateItems(tx, {
    people: [...recipients],
    sourceType: input.subjectType === "Request" ? "RequestEvent" : "WorkItemEvent",
    sourceId: input.eventId,
    titleEn: `${labelEn}: ${subject.key} ${subject.titleEn} (${input.outcome})`,
    titleAr: `${labelAr}: ${subject.key} ${subject.titleAr || subject.titleEn} (${input.outcome})`,
    path: `${input.subjectType === "Request" ? "/requests" : "/tasks"}?open=${encodeURIComponent(subject.key)}`,
    actorId: input.actorId,
 })).map((item) => item.personId);

  const settings = await readMailSettings();
  // A template switched off is configuration, not a decision about a person: no email row is written.
  if (!settings.templates[TEMPLATE_OF[input.kind]].enabled) return { mail: [], told };

  // No preference row is the defaults: every email on.
  const preference = {
    RequestCreated: s.notificationPreference.requestCreatedEmail,
    RequestUpdated: s.notificationPreference.requestUpdatedEmail,
    RequestFinished: s.notificationPreference.requestFinishedEmail,
    WorkItemFinished: s.notificationPreference.workItemFinishedEmail,
  }[input.kind];
  const people = await tx
    .select({ id: s.person.id, email: s.person.email, status: s.person.status, wanted: preference })
    .from(s.person)
    .leftJoin(s.notificationPreference, eq(s.notificationPreference.personId, s.person.id))
    .where(inArray(s.person.id, [...recipients]));
  const ready = mailReady(settings);
  const kind = input.kind;

  const rows = people.map((person) => {
    const wanted = person.wanted ?? true;
    const reason = !ready
      ? "the platform mail server is not configured"
      : person.status !== "Active"
        ? "the person is not active"
        : !person.email.includes("@")
          ? "the person has no email address"
          : !wanted
            ? "the person turned these emails off"
            : null;
    return {
      notificationKey: `${kind}:${input.subjectId}:${input.eventId}:${person.id}`,
      kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      personId: person.id,
      recipient: person.email,
      outcome: input.outcome,
      status: reason ? "Skipped" : "Queued",
      reason,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    };
  });
  if (rows.length === 0) return { mail: [], told };
  const written = await tx
    .insert(s.mailNotification)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: s.mailNotification.id, status: s.mailNotification.status });
  return { mail: written.filter((row) => row.status === "Queued").map((row) => row.id), told };
}

/**
 * D394: puts an Update in each person's Inbox, with its own title and link, once per source
 * (a key already there is left alone). Returns the items written.
 */
export async function insertUpdateItems(
  db: Executor,
  input: { people: string[]; sourceType: string; sourceId: string; titleEn: string; titleAr: string; path: string; actorId: string },
): Promise<{ id: string; personId: string }[]> {
  if (input.people.length === 0) return [];
  return db
    .insert(s.inboxItem)
    .values(
      input.people.map((personId) => ({
        personId,
        kind: "Update",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        linkPath: input.path,
        status: "Open",
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: s.inboxItem.id, personId: s.inboxItem.personId });
}

/** The notification preference that turns each Inbox kind's email off; Review and Update have none. */
const ALERT_PREFERENCE = {
  Approval: s.notificationPreference.approvals,
  Question: s.notificationPreference.approvals,
  Mention: s.notificationPreference.mentions,
  SlaWarning: s.notificationPreference.slaWarnings,
} as const;

export type AlertKind = "Approval" | "Question" | "Mention" | "SlaWarning" | "Review" | "Update";

/**
 * D394: the email of an Inbox item, a row for each person who gained one. It is written with its
 * own subject and text in the person's language (an `Alert`), so it needs no template, and is
 * Queued or Skipped for the same reasons as any notice. Returns the ids of the Queued rows.
 */
export async function queueAlertEmails(
  db: Executor,
  input: { items: { id: string; personId: string }[]; kind: AlertKind; titleEn: string; titleAr: string; path: string; actorId: string },
): Promise<string[]> {
  if (input.items.length === 0) return [];
  const settings = await readMailSettings();
  const wantedColumn = ALERT_PREFERENCE[input.kind as keyof typeof ALERT_PREFERENCE] as typeof s.notificationPreference.approvals | undefined;
  const people = await db
    .select({
      id: s.person.id,
      email: s.person.email,
      status: s.person.status,
      language: s.person.preferredLanguage,
      wanted: wantedColumn ?? s.notificationPreference.approvals,
    })
    .from(s.person)
    .leftJoin(s.notificationPreference, eq(s.notificationPreference.personId, s.person.id))
    .where(inArray(s.person.id, input.items.map((item) => item.personId)));
  const link = new URL(input.path, env().APP_URL).toString();
  const ready = mailReady(settings);
  const rows = input.items.flatMap((item) => {
    const person = people.find((candidate) => candidate.id === item.personId);
    if (!person) return [];
    const arabic = person.language === "ar";
    const reason = !ready
      ? "the platform mail server is not configured"
      : person.status !== "Active"
        ? "the person is not active"
        : !person.email.includes("@")
          ? "the person has no email address"
          : wantedColumn && person.wanted === false
            ? "the person turned these emails off"
            : null;
    return [
      {
        notificationKey: `Alert:${item.id}`,
        kind: "Alert",
        subjectType: "InboxItem",
        subjectId: item.id,
        personId: person.id,
        recipient: person.email,
        outcome: input.kind,
        status: reason ? "Skipped" : "Queued",
        reason,
        mailSubject: arabic ? input.titleAr : input.titleEn,
        mailBody: arabic ? `${input.titleAr}\n\nافتحه في المنصة: ${link}\n` : `${input.titleEn}\n\nOpen it in the platform: ${link}\n`,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    ];
  });
  if (rows.length === 0) return [];
  const written = await db
    .insert(s.mailNotification)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: s.mailNotification.id, status: s.mailNotification.status });
  return written.filter((row) => row.status === "Queued").map((row) => row.id);
}

/**
 * D248: the email that carries an invitation's link, queued with the invitation. Returns the
 * row and, when it will not be sent, why, so the person inviting is told.
 */
export async function queueInvitationNotice(
  tx: Tx,
  input: { invitationId: string; personId: string; email: string; actorId: string },
): Promise<{ id: string; reason: string | null }> {
  const settings = await readMailSettings();
  const reason = !mailReady(settings)
    ? "the platform mail server is not configured"
    : !settings.templates.invitation.enabled
      ? "the invitation email is switched off"
      : null;
  const [row] = await tx
    .insert(s.mailNotification)
    .values({
      notificationKey: `Invitation:${input.invitationId}`,
      kind: "Invitation",
      subjectType: "Invitation",
      subjectId: input.invitationId,
      personId: input.personId,
      recipient: input.email,
      outcome: "Invited",
      status: reason ? "Skipped" : "Queued",
      reason,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .returning({ id: s.mailNotification.id });
  return { id: row.id, reason };
}
