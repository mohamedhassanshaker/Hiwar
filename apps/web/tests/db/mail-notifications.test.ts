import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * D240: the system email notifications. A finished work item or request is told to the
 * people it is for by the platform itself, through the configured mail server, whatever the
 * agent did; a person who cannot be emailed, or a platform with no mail server, is skipped
 * with the reason; and the mail server's failures never reach the finished item.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

let signedInAs = "";
// The mail server: what was handed to it, and how it answers the next send.
const smtp = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[], fail: null as null | { code?: string; responseCode?: number; message: string } }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { to: string; subject: string; text: string }) => {
        if (smtp.fail) throw Object.assign(new Error(smtp.fail.message), smtp.fail);
        smtp.sent.push(message);
        return {};
      },
      close: () => undefined,
    }),
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("D240 system email notifications", () => {
  let ownerId = "";
  let memberId = "";
  let memberEmail = "";
  let projectKey = "";
  let settingsBefore = 0;
  const created: string[] = [];

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>("select id from core.person where email = 'mariam@tahseel.ae'");
    ownerId = owner.rows[0].id;
    const member = await testPool().query<{ id: string; email: string }>("select id, email from core.person where email = 'layla@tahseel.ae'");
    memberId = member.rows[0].id;
    memberEmail = member.rows[0].email;
    projectKey = (await testPool().query<{ key: string }>("select key from work.project order by key limit 1")).rows[0].key;
    settingsBefore = (await testPool().query<{ n: number }>("select coalesce(max(version_number), 0) as n from gov.settings_version")).rows[0].n;
  });

  afterEach(async () => {
    smtp.sent.length = 0;
    smtp.fail = null;
    if (created.length > 0) {
      await testPool().query("delete from gov.mail_notification where subject_id in (select id from work.work_item where key = any($1))", [created]);
      await testPool().query("delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = any($1))", [created]);
      await testPool().query("delete from work.work_item where key = any($1)", [created]);
      created.length = 0;
    }
    await testPool().query("delete from gov.mail_notification where kind = 'Test'");
    await testPool().query("delete from gov.settings_version where version_number > $1", [settingsBefore]);
    await testPool().query("update core.notification_preference set work_item_finished_email = true where person_id = $1", [memberId]);
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const configureMail = async (enabled = true) => {
    const { saveMailSettings } = await import("@/features/governance/service");
    const { DEFAULT_MAIL_SETTINGS } = await import("@/db/queries/mail");
    signedInAs = ownerId;
    await saveMailSettings({ ...DEFAULT_MAIL_SETTINGS, enabled, host: "smtp.test", port: 25, security: "none", fromAddress: "platform@tahseel.test" });
  };

  /** A work item Mariam created and gave to Layla, then finished by Mariam. */
  const finished = async () => {
    const { createWorkItem } = await import("@/features/work-items/service");
    const repository = await import("@/features/work-items/repository");
    signedInAs = ownerId;
    const key = await createWorkItem({ projectKey, type: "Task", titleEn: "Reconcile the ledger", titleAr: "مطابقة الدفتر", priority: "Medium" } as Parameters<typeof createWorkItem>[0]);
    created.push(key);
    await repository.assign(key, { type: "Person", id: memberId }, (await repository.readVersion(key)) as number, ownerId);
    await repository.changeStatus(key, "Done", (await repository.readVersion(key)) as number, ownerId);
    return key;
  };

  const noticesOf = async (key: string) =>
    (
      await testPool().query<{ id: string; person_id: string; status: string; reason: string | null; attempts: number; outcome: string; next_attempt_at: Date }>(
        `select n.id, n.person_id, n.status, n.reason, n.attempts, n.outcome, n.next_attempt_at from gov.mail_notification n
         join work.work_item w on w.id = n.subject_id where w.key = $1 order by n.created_at`,
        [key],
      )
    ).rows;

  it("a finished work item tells the people it is for, once, and not whoever finished it", async () => {
    await configureMail();
    const key = await finished();
    const notices = await noticesOf(key);
    expect(notices.map((notice) => [notice.person_id, notice.status, notice.outcome])).toEqual([[memberId, "Queued", "Done"]]);

    // Moving within its end is not finishing it again.
    const repository = await import("@/features/work-items/repository");
    await repository.changeStatus(key, "Cancelled", (await repository.readVersion(key)) as number, ownerId);
    expect(await noticesOf(key)).toHaveLength(1);

    const { deliver } = await import("@/features/governance/notification-service");
    await deliver(notices[0].id);
    expect(smtp.sent).toHaveLength(1);
    expect(smtp.sent[0].to).toBe(memberEmail);
    expect(smtp.sent[0].subject).toContain(key);
    expect(smtp.sent[0].text).toContain(`/work-items?open=${key}`);
    expect((await noticesOf(key))[0].status).toBe("Sent");

    // A second delivery of the same notice, a retried job, sends nothing.
    await deliver(notices[0].id);
    expect(smtp.sent).toHaveLength(1);
  });

  it("a person who turned the email off, and a platform with no mail server, are skipped with the reason", async () => {
    await configureMail();
    await testPool().query(
      `insert into core.notification_preference (person_id, work_item_finished_email) values ($1, false)
       on conflict (person_id) do update set work_item_finished_email = false`,
      [memberId],
    );
    const off = await finished();
    expect((await noticesOf(off)).map((notice) => [notice.status, notice.reason])).toEqual([["Skipped", "the person turned these emails off"]]);

    await testPool().query("update core.notification_preference set work_item_finished_email = true where person_id = $1", [memberId]);
    await configureMail(false);
    const unconfigured = await finished();
    expect((await noticesOf(unconfigured)).map((notice) => [notice.status, notice.reason])).toEqual([["Skipped", "the platform mail server is not configured"]]);
  });

  it("a transient mail failure is tried again later, a permanent one fails, and the work item stays finished", async () => {
    await configureMail();
    const { deliver } = await import("@/features/governance/notification-service");
    const key = await finished();
    const [notice] = await noticesOf(key);

    smtp.fail = { code: "ECONNREFUSED", message: "connect ECONNREFUSED" };
    await deliver(notice.id);
    const retried = (await noticesOf(key))[0];
    expect([retried.status, retried.attempts, retried.reason]).toEqual(["Queued", 1, "connect ECONNREFUSED"]);
    expect(retried.next_attempt_at.getTime()).toBeGreaterThan(Date.now());

    // Due again, and refused for good this time.
    await testPool().query("update gov.mail_notification set next_attempt_at = now() where id = $1", [notice.id]);
    smtp.fail = { responseCode: 550, message: "550 mailbox unavailable" };
    await deliver(notice.id);
    expect((await noticesOf(key))[0].status).toBe("Failed");

    const item = await testPool().query<{ status: string }>("select status from work.work_item where key = $1", [key]);
    expect(item.rows[0].status).toBe("Done");
  });

  it("a transient failure that keeps happening stops after the configured tries", async () => {
    await configureMail();
    const { deliver } = await import("@/features/governance/notification-service");
    const key = await finished();
    const [notice] = await noticesOf(key);
    smtp.fail = { code: "ETIMEDOUT", message: "timed out" };
    for (let attempt = 0; attempt < 4; attempt++) {
      await testPool().query("update gov.mail_notification set next_attempt_at = now() where id = $1", [notice.id]);
      await deliver(notice.id);
    }
    expect((await noticesOf(key))[0]).toMatchObject({ status: "Failed", attempts: 4 });
  });

  it("D242 an agent's email goes only to active people, once per call, signed with the agent and the person", async () => {
    const { GOVERNANCE_TOOLS } = await import("@/features/governance/tools");
    const { deliver } = await import("@/features/governance/notification-service");
    const { runAs } = await import("@/lib/session");
    const email = GOVERNANCE_TOOLS.find((one) => one.name === "email_create")!;
    expect(email.tier).toBe("T2");
    const send = email.run as (input: unknown) => Promise<unknown>;
    const runId = crypto.randomUUID();
    const asAgent = (input: unknown) => runAs(ownerId, { id: "00000000-0000-4000-8000-00000000a9e7", label: "pa", runId }, () => send(input));
    const message = { to: [memberEmail.toUpperCase()], subject: "Ledger reconciled", body: "The ledger is reconciled." };
    const rows = async () =>
      (await testPool().query<{ id: string; recipient: string; status: string }>("select id, recipient, status from gov.mail_notification where run_id = $1", [runId])).rows;

    try {
      // No mail server: refused, nothing queued.
      await configureMail(false);
      await expect(asAgent(message)).rejects.toThrow("The platform mail server is not configured.");

      await configureMail();
      // Somebody outside the platform is refused whole, with the address named.
      await expect(asAgent({ ...message, to: [memberEmail, "someone@outside.example"] })).rejects.toThrow("not: someone@outside.example");
      expect(await rows()).toEqual([]);
      // A person's own call, not a run, is refused.
      signedInAs = ownerId;
      await expect(send(message)).rejects.toThrow("Only an agent run sends email this way.");

      expect(await asAgent(message)).toEqual({ queued: [memberEmail] });
      // A retried tool call queues nothing new.
      await asAgent(message);
      const [queued, ...more] = await rows();
      expect(more).toEqual([]);
      expect(queued).toMatchObject({ recipient: memberEmail, status: "Queued" });

      await deliver(queued.id);
      expect(smtp.sent).toHaveLength(1);
      expect(smtp.sent[0]).toMatchObject({ to: memberEmail, subject: "Ledger reconciled" });
      expect(smtp.sent[0].text).toMatch(/^The ledger is reconciled\.[\s\S]*Written by the agent pa for /);
      expect((await rows())[0].status).toBe("Sent");
    } finally {
      await testPool().query("delete from gov.mail_notification where run_id = $1", [runId]);
    }
  });

  it("D248 an invitation emails a link that makes the invited person active once, and only them", async () => {
    const { invitePeople, resendInvitation, invitationForToken } = await import("@/features/organisation/service");
    const { deliver } = await import("@/features/governance/notification-service");
    const { acceptInvitation } = await import("@/db/queries/identity");
    const role = (await testPool().query<{ code: string }>("select code from core.role order by code limit 1")).rows[0].code;
    const address = `invitee-${crypto.randomUUID().slice(0, 8)}@tahseel.test`;
    const person = async () =>
      (await testPool().query<{ id: string; status: string }>("select id, status from core.person where email = $1", [address])).rows[0];
    const notice = async (personId: string) =>
      (await testPool().query<{ id: string; status: string; reason: string | null }>("select id, status, reason from gov.mail_notification where kind = 'Invitation' and person_id = $1 order by created_at desc limit 1", [personId])).rows[0];
    const tokenOf = (text: string) => decodeURIComponent(/\/invite\/([^\s)]+)/.exec(text)?.[1] ?? "");

    try {
      // With no mail server the person is invited and told why no link went.
      await configureMail(false);
      expect(await invitePeople({ emails: [address], roleCode: role, orgUnitId: null })).toEqual([
        { email: address, invited: true, noEmail: "the platform mail server is not configured" },
      ]);
      const invitee = await person();
      expect(invitee.status).toBe("Invited");

      await configureMail();
      expect(await resendInvitation(invitee.id)).toEqual({ noEmail: null });
      const first = await notice(invitee.id);
      await deliver(first.id);
      expect(smtp.sent).toHaveLength(1);
      expect(smtp.sent[0].to).toBe(address);
      const firstToken = tokenOf(smtp.sent[0].text);
      expect(firstToken.length).toBeGreaterThan(30);
      // Sent, so the token is kept nowhere but in the email.
      const kept = await testPool().query<{ token_cipher: string | null }>("select token_cipher from core.person_invitation where person_id = $1 and revoked_at is null", [invitee.id]);
      expect(kept.rows).toEqual([{ token_cipher: null }]);
      expect((await invitationForToken(firstToken))?.state).toBe("Open");

      // A resend replaces the link: the first one stops working.
      await resendInvitation(invitee.id);
      await deliver((await notice(invitee.id)).id);
      const secondToken = tokenOf(smtp.sent[1].text);
      expect((await invitationForToken(firstToken))?.state).toBe("Withdrawn");
      expect(await acceptInvitation(invitee.id, firstToken)).toBe(false);

      // Another person cannot spend it, a wrong token does nothing, and it works once.
      expect(await acceptInvitation(memberId, secondToken)).toBe(false);
      expect(await acceptInvitation(invitee.id, "not-the-token")).toBe(false);
      expect((await person()).status).toBe("Invited");
      expect(await acceptInvitation(invitee.id, secondToken)).toBe(true);
      expect((await person()).status).toBe("Active");
      expect(await acceptInvitation(invitee.id, secondToken)).toBe(false);
      expect((await invitationForToken(secondToken))?.state).toBe("Accepted");
    } finally {
      const invitee = await person();
      if (invitee) {
        await testPool().query("delete from gov.mail_notification where person_id = $1", [invitee.id]);
        await testPool().query("delete from core.role_assignment where person_id = $1", [invitee.id]);
        await testPool().query("delete from core.person where id = $1", [invitee.id]);
      }
    }
  });

  it("a test email goes through the configured server and is recorded", async () => {
    const { sendTestEmail } = await import("@/features/governance/notification-service");
    signedInAs = ownerId;
    expect(await sendTestEmail("someone@tahseel.test")).toEqual({
      sent: false,
      reason: "Switch the mail server on and give it a host and a from address first.",
    });
    await configureMail();
    expect(await sendTestEmail("someone@tahseel.test")).toEqual({ sent: true });
    expect(smtp.sent.map((message) => message.to)).toEqual(["someone@tahseel.test"]);
    const recorded = await testPool().query<{ status: string }>("select status from gov.mail_notification where kind = 'Test'");
    expect(recorded.rows.map((row) => row.status)).toEqual(["Sent"]);
  });
});
