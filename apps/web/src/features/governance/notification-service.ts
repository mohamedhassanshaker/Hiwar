import { mailReady, readMailSettings, type MailTemplateKind } from "@/db/queries/mail";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { renderMail } from "@/lib/mail-html";
import { MailFailure, sendMail, verifyMailServer } from "@/lib/mailer";
import { requirePermission } from "@/lib/session";
import { Rejected } from "@/lib/rejection";
import { enqueueMailJobs, liveUpdatesConfigured, mailJobReader } from "@/lib/valkey";
import * as repository from "./repository";

/**
 * D240: the system email notifications. A request or work item that finishes queues a
 * notice in the transaction that finishes it (`queueFinishedNotices`); this sends it,
 * outside that transaction, so a mail server that is slow or down never holds up or
 * changes the finished item. The agent's email tool (`sendAgentEmail`) shares the queue and
 * the consumer and plays no part in deciding these.
 */

/** Tries in all, and the wait before each retry of a transient failure. */
const MAX_ATTEMPTS = 4;
const BACKOFF_MINUTES = [1, 5, 15];

const TEMPLATE_OF: Record<string, MailTemplateKind | undefined> = {
  RequestCreated: "requestCreated",
  RequestUpdated: "requestUpdated",
  RequestFinished: "requestFinished",
  WorkItemFinished: "workItemFinished",
  Invitation: "invitation",
};

const OUTCOME_AR: Record<string, string> = { Completed: "مكتمل", Rejected: "مرفوض", Closed: "مغلق", Cancelled: "ملغى", Done: "منجز" };

/** Sends one notice, if it is still this caller's to send, and records what happened. */
export async function deliver(id: string): Promise<void> {
  const facts = await repository.claimNotice(id);
  if (facts === null) return;
  if (facts === "gone") {
    await repository.markNoticeSkipped(id, "the item or the recipient no longer exists");
    return;
  }
  const settings = await readMailSettings();
  if (!mailReady(settings)) {
    await repository.markNoticeSkipped(id, "the platform mail server is not configured");
    return;
  }

  const arabic = facts.language === "ar";
  const both = (en: string, ar: string) => (arabic ? ar || en : en);
  const origin = env().APP_URL.replace(/\/$/, "");
  const when = (at: Date | null) => (at ?? new Date()).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const kind = TEMPLATE_OF[facts.kind];
  // Only what the recipient may already see: the item is theirs, and the link opens it under
  // their own permissions. An invitation's link carries its token, which is what lets them in.
  const values: Record<string, string> = facts.invitation
    ? {
        name: both(facts.invitation.nameEn, facts.invitation.nameAr),
        inviter: both(facts.invitation.inviterEn, facts.invitation.inviterAr),
        role: both(facts.invitation.roleEn, facts.invitation.roleAr),
        organisation: both(facts.invitation.organisationEn, facts.invitation.organisationAr),
        link: `${origin}/invite/${encodeURIComponent(facts.invitation.token)}`,
        expiresAt: when(facts.invitation.expiresAt),
      }
    : {
        key: facts.key,
        title: both(facts.titleEn, facts.titleAr),
        outcome: arabic ? (OUTCOME_AR[facts.outcome] ?? facts.outcome) : facts.outcome,
        summary: both(facts.summaryEn, facts.summaryAr),
        step: both(facts.stepEn, facts.stepAr),
        completedAt: when(facts.finishedAt),
        at: when(facts.finishedAt),
        link: `${origin}${facts.path}`,
      };
  const template = kind ? settings.templates[kind] : null;

  try {
    if (facts.message) await sendMail(settings, { to: facts.recipient, ...facts.message });
    else if (template) {
      const email = renderMail({ subject: arabic ? template.subjectAr : template.subjectEn, body: arabic ? template.bodyAr : template.bodyEn }, values);
      await sendMail(settings, { to: facts.recipient, ...email });
    } else {
      await repository.markNoticeSkipped(id, `no template for ${facts.kind}`);
      return;
    }
    await repository.markNoticeSent(id);
    if (facts.invitation) await repository.clearInvitationToken(facts.invitation.id);
    logger().info({ notification: id, kind: facts.kind, key: facts.key }, "a notification email was sent");
  } catch (problem) {
    const failure = problem instanceof MailFailure ? problem : new MailFailure(String(problem), false);
    const attempt = facts.attempts;
    if (failure.transient && attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)];
      await repository.markNoticeRetry(id, failure.message, wait);
      logger().warn({ notification: id, attempt, problem: failure.message }, "a notification email will be tried again");
    } else {
      await repository.markNoticeFailed(id, failure.message);
      logger().warn({ notification: id, attempt, problem: failure.message }, "a notification email failed");
    }
  }
}

const started = globalThis as { awpMailConsumer?: boolean };

/**
 * The background consumer, one per web process: it reads the Valkey stream, and every
 * minute sweeps the notices that are due (a retry, or a job Valkey lost), so a notice is
 * sent once the platform is back whatever happened to its job.
 */
export function startMailConsumer(): void {
  if (started.awpMailConsumer) return;
  started.awpMailConsumer = true;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Without Valkey (a `core` profile, local development) the sweep alone sends.
  if (liveUpdatesConfigured()) void (async () => {
    const reader = mailJobReader(`web-${process.pid}-${crypto.randomUUID().slice(0, 8)}`);
    for (;;) {
      try {
        for (const job of await reader.read(5_000)) {
          if (job.notification) await deliver(job.notification).catch((problem: unknown) => logger().error({ err: problem, notification: job.notification }, "a notification email could not be handled"));
          await reader.ack(job.entry);
        }
      } catch (problem) {
        logger().warn({ problem: String(problem) }, "the mail stream could not be read");
        await wait(5_000);
      }
    }
  })();

  void (async () => {
    for (;;) {
      await wait(60_000);
      try {
        for (const id of await repository.dueNoticeIds(50)) await deliver(id);
      } catch (problem) {
        logger().warn({ problem: String(problem) }, "the mail sweep did not complete");
      }
    }
  })();
}

/**
 * D242: an agent's email, `email_create`. Only to active people of the platform, and only from
 * a run, which pauses for a person's bound approval of this exact message first (T2, D49).
 * Queued like a notification, so the consumer sends it and retries a transient failure; the
 * message says which agent wrote it and for whom.
 */
export async function sendAgentEmail(input: { to: string[]; subject: string; body: string }): Promise<{ queued: string[] }> {
  const session = await requirePermission("organisation:read");
  const runId = session.actingAgent?.runId;
  if (!session.actingAgent || !runId) throw new Rejected("Only an agent run sends email this way.", "لا يرسل البريد بهذه الطريقة إلا تشغيل وكيل.");
  if (!mailReady(await readMailSettings())) {
    throw new Rejected("The platform mail server is not configured.", "خادم بريد المنصة غير مُعدّ.");
  }
  const wanted = [...new Set(input.to.map((address) => address.trim().toLowerCase()))];
  const people = await repository.activePeopleByEmail(wanted);
  const unknown = wanted.filter((address) => !people.some((person) => person.email.toLowerCase() === address));
  if (unknown.length > 0) {
    throw new Rejected(
      `Email goes only to active people of the platform; not: ${unknown.join(", ")}.`,
      `يُرسل البريد إلى موظفي المنصة النشطين فقط، وليس إلى: ${unknown.join("، ")}.`,
    );
  }
  const footer = `\n\n--\nWritten by the agent ${session.actingAgent.label} for ${session.nameEn} through the Juman Platform.\n`;
  const ids = await repository.queueAgentEmail({
    runId,
    actorId: session.personId,
    recipients: people.map((person) => ({ personId: person.id, email: person.email })),
    subject: input.subject,
    body: input.body + footer,
  });
  await enqueueMailJobs(ids);
  logger().info({ run: runId, recipients: people.length, queued: ids.length }, "an agent email was queued");
  return { queued: people.map((person) => person.email) };
}

/** Settings → Email: the latest notices, with where each got to and why. */
export async function recentNotifications() {
  await requirePermission("settings:read");
  return repository.recentNotices(50);
}

/** Settings → Email: one email to `to` through the configured server, recorded like any other. */
export async function sendTestEmail(to: string): Promise<{ sent: true } | { sent: false; reason: string }> {
  const session = await requirePermission("settings:write");
  const settings = await readMailSettings();
  if (!mailReady(settings)) return { sent: false, reason: "Switch the mail server on and give it a host and a from address first." };
  try {
    await sendMail(settings, {
      to,
      subject: "Juman Platform test email",
      text: "This is a test email from the Juman Platform. The mail server works.\n",
    });
    await repository.recordTestEmail({ recipient: to, status: "Sent", reason: null, personId: session.personId });
    return { sent: true };
  } catch (problem) {
    const reason = problem instanceof Error ? problem.message : String(problem);
    await repository.recordTestEmail({ recipient: to, status: "Failed", reason, personId: session.personId });
    return { sent: false, reason };
  }
}

/** Settings → Email: connects to the saved mail server and signs in, without sending an email. */
export async function testSavedMailSettings(): Promise<{ ok: true } | { ok: false; reason: string }> {
  await requirePermission("settings:write");
  const settings = await readMailSettings();
  if (settings.host.trim() === "") return { ok: false, reason: "Save a host first." };
  try {
    await verifyMailServer(settings);
    return { ok: true };
  } catch (problem) {
    return { ok: false, reason: problem instanceof Error ? problem.message : String(problem) };
  }
}
