import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * D342: the Conversations screen against the database. The list's filters, and a person taking
 * a visitor conversation over from its agent: the agent stops answering, the person writes to
 * the visitor, hands it back or ends it, and only holders of the channel permissions may.
 */

process.env.AUTH_SECRET ??= "a-widget-session-secret-for-the-tests";
process.env.APP_KEK ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("D342 the Conversations screen", () => {
  let adminId = "";
  let colleagueId = "";
  let outsiderId = "";
  let configurerId = "";
  let roleId = "";
  const code = `test-cv-${Date.now().toString(36)}`;
  const HOST = "https://host.example.test";

  /** A visitor's session on the test deployment, and the claims its turns are taken with. */
  const visitor = async () => {
    const { startSession } = await import("@/features/engage/widget-session");
    const view = await startSession({ deploymentCode: code, lang: "en", page: null, host: HOST, visitorKey: `cv-${Math.random().toString(36).slice(2, 12)}`, previewBy: null });
    const row = await testPool().query<{ visitor_key: string }>("select visitor_key from ai.deployment_conversation where id = $1", [view.sessionId]);
    return { conversationId: view.sessionId, deploymentCode: code, visitorKey: row.rows[0].visitor_key, lang: "en" as const, page: null, preview: false };
  };
  const lines = async (id: string) =>
    (await testPool().query<{ role: string; text: string | null }>("select role, text_en as text from ai.conversation_message where conversation_id = $1 order by sort_order", [id])).rows;

  beforeAll(async () => {
    const holds = (permission: string) => `exists (
      select 1 from core.role_assignment ra join core.role_permission rp on rp.role_id = ra.role_id
      join core.permission perm on perm.id = rp.permission_id
      where ra.person_id = p.id and perm.code = '${permission}' and rp.effect = 'Allow')`;
    const somebody = async (where: string) =>
      (await testPool().query<{ id: string }>(`select p.id from core.person p where p.status = 'Active' and ${where} order by p.id limit 1`)).rows[0]?.id;
    adminId = (await somebody(`${holds("conversations:answer")} and ${holds("channels:write")}`))!;
    colleagueId = (await somebody(`${holds("conversations:answer")} and p.id <> '${adminId}'`))!;
    outsiderId = (await somebody(`not ${holds("conversations:read")}`))!;
    // D343: somebody who configures deployments is not thereby somebody who reads what visitors
    // said. A role with the channel permissions alone makes another person exactly that.
    configurerId = (await somebody(`not ${holds("conversations:read")} and p.id <> '${outsiderId}'`))!;
    const role = await testPool().query<{ id: string }>(
      "insert into core.role (code, name_en, name_ar) values ($1, 'Channel configurer', 'مُعِدّ القنوات') returning id",
      [`${code}-configurer`],
    );
    roleId = role.rows[0].id;
    await testPool().query(
      "insert into core.role_permission (role_id, permission_id, effect) select $1, id, 'Allow' from core.permission where code in ('channels:read', 'channels:write')",
      [roleId],
    );
    await testPool().query("insert into core.role_assignment (person_id, role_id, scope_type) values ($1, $2, 'Organisation')", [configurerId, roleId]);
    signedInAs = adminId;

    const engage = await import("@/features/engage/service");
    const agent = await testPool().query<{ code: string }>("select code from ai.agent where is_system = false limit 1");
    await engage.createDeployment({ code, nameEn: "Conversations test", nameAr: "اختبار المحادثات", defaultAgentCode: agent.rows[0].code, surfaces: ["Widget"] });
    const version = (await engage.loadDeployments()).deployments.find((one) => one.id === code)?.version ?? 1;
    await engage.saveDeployment({
      code,
      nameEn: "Conversations test",
      nameAr: "اختبار المحادثات",
      defaultAgentCode: agent.rows[0].code,
      status: "Enabled",
      surfaces: ["Widget"],
      allowedOrigins: [HOST],
      visitorIdentity: "AnonymousOtpStepUp",
      visitorJwtFallback: "Anonymous",
      handoffQueue: null,
      rateLimitPerVisitor: 100,
      widgetTitleEn: "Conversations test",
      widgetTitleAr: "اختبار المحادثات",
      welcomeEn: "Hello!",
      welcomeAr: "مرحباً!",
      accentColour: "#12034B",
      quickActions: [],
      version,
    });
  });

  afterAll(async () => {
    await testPool().query("delete from core.role_assignment where role_id = $1", [roleId]);
    await testPool().query("delete from core.role_permission where role_id = $1", [roleId]);
    await testPool().query("delete from core.role where id = $1", [roleId]);
    await testPool().query("delete from ai.embedded_deployment where code = $1", [code]);
    await closeTestPool();
  });

  it("lists conversations newest first, filtered by deployment, what was said and status", async () => {
    const { sendMessage } = await import("@/features/engage/widget-session");
    const { loadConversations } = await import("@/features/engage/service");
    const first = await visitor();
    await sendMessage(first, "Where is my parking fine?", null);
    const second = await visitor();
    await sendMessage(second, "What are your opening hours?", null);

    const all = await loadConversations({ deploymentCode: code }, { limit: 50, offset: 0 });
    expect(all.rows.map((row) => row.id).slice(0, 2)).toEqual([second.conversationId, first.conversationId]);
    expect(all.rows[0]).toMatchObject({ deploymentCode: code, status: "Live", firstText: "What are your opening hours?" });

    const found = await loadConversations({ deploymentCode: code, text: "parking" }, { limit: 50, offset: 0 });
    expect(found.rows.map((row) => row.id)).toEqual([first.conversationId]);
    expect(found.total).toBe(1);
    // A search term is matched literally, so `%` matches only a percent sign.
    expect((await loadConversations({ deploymentCode: code, text: "%" }, { limit: 50, offset: 0 })).total).toBe(0);
    expect((await loadConversations({ deploymentCode: code, status: "Ended" }, { limit: 50, offset: 0 })).total).toBe(0);
    expect((await loadConversations({ deploymentCode: code, from: new Date(Date.now() + 86_400_000) }, { limit: 50, offset: 0 })).total).toBe(0);
  });

  it("a person takes the conversation over: the agent stops answering, the person writes, hands it back, then ends it", async () => {
    const { sendMessage, sessionView } = await import("@/features/engage/widget-session");
    const conversations = { ...(await import("@/features/engage/conversations-service")), ...(await import("@/features/engage/service")) };
    const { postVisitorReply } = await import("@/features/engage/visitor-agent");
    const claims = await visitor();

    // Not taken over, nobody may write to the visitor.
    await expect(conversations.sendToVisitor({ id: claims.conversationId, text: "Hi" })).rejects.toBeInstanceOf(conversations.ConversationRejected);

    await conversations.takeOver({ id: claims.conversationId });
    expect((await conversations.loadConversation(claims.conversationId))?.summary).toMatchObject({ status: "AgentPaused", pausedBy: expect.any(String) });
    await expect(conversations.takeOver({ id: claims.conversationId })).rejects.toBeInstanceOf(conversations.ConversationRejected);

    // The visitor's message is kept; neither the agent nor its "not set up" notice answers it,
    // and a reply a run was already writing is dropped.
    const before = (await lines(claims.conversationId)).length;
    await sendMessage(claims, "Can a person help me?", null);
    await postVisitorReply({ conversationId: claims.conversationId, status: "Succeeded", text: "An answer nobody asked for." });
    expect((await lines(claims.conversationId)).slice(before)).toEqual([{ role: "Visitor", text: "Can a person help me?" }]);

    await conversations.sendToVisitor({ id: claims.conversationId, text: "Yes, I am here." });
    const seen = await sessionView(claims);
    expect(seen.messages.at(-1)).toMatchObject({ role: "human_agent", blocks: [{ type: "text", text: "Yes, I am here." }] });

    await conversations.resumeAgent({ id: claims.conversationId });
    expect((await conversations.loadConversation(claims.conversationId))?.summary.status).toBe("Live");
    await sendMessage(claims, "Thanks, and the opening hours?", null);
    // The agent answers again; this deployment has nobody to answer as, and says so.
    expect((await lines(claims.conversationId)).at(-1)?.text).toContain("not set up to answer");

    await conversations.endByPerson({ id: claims.conversationId });
    const ended = await conversations.loadConversation(claims.conversationId);
    expect(ended?.summary).toMatchObject({ status: "Ended", outcome: "Completed" });
    expect((await sessionView(claims)).state.ended).toBe(true);
    await expect(conversations.takeOver({ id: claims.conversationId })).rejects.toBeInstanceOf(conversations.ConversationRejected);

    const audited = await testPool().query<{ action: string }>(
      "select action from audit.audit_entry where object_id = $1 order by at",
      [claims.conversationId],
    );
    expect(audited.rows.map((row) => row.action)).toEqual(["conversations:takeover", "conversations:resume", "conversations:end"]);
  });

  it("D343 refuses a person without the conversation permissions, a channel configurer included", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const conversations = { ...(await import("@/features/engage/conversations-service")), ...(await import("@/features/engage/service")) };
    const claims = await visitor();
    for (const person of [outsiderId, configurerId]) {
      signedInAs = person;
      try {
        await expect(conversations.loadConversations({}, { limit: 50, offset: 0 })).rejects.toBeInstanceOf(NotPermitted);
        await expect(conversations.loadConversation(claims.conversationId)).rejects.toBeInstanceOf(NotPermitted);
        await expect(conversations.takeOver({ id: claims.conversationId })).rejects.toBeInstanceOf(NotPermitted);
      } finally {
        signedInAs = adminId;
      }
    }
    expect((await conversations.loadConversation(claims.conversationId))?.summary.status).toBe("Live");
  });

  it("D344 the open-conversations panel shows the agent's and mine, never a colleague's, an ended one or an idle one", async () => {
    const { sendMessage } = await import("@/features/engage/widget-session");
    const conversations = { ...(await import("@/features/engage/conversations-service")), ...(await import("@/features/engage/service")) };
    const withAgent = await visitor();
    await sendMessage(withAgent, "Is anyone there?", null);
    const withMe = await visitor();
    await conversations.takeOver({ id: withMe.conversationId });
    const withColleague = await visitor();
    signedInAs = colleagueId;
    try {
      await conversations.takeOver({ id: withColleague.conversationId });
    } finally {
      signedInAs = adminId;
    }
    // A widget that opened and was never written in is not a conversation to watch.
    const untouched = await visitor();
    const ended = await visitor();
    await conversations.endByPerson({ id: ended.conversationId });
    // A visitor gone longer than the deployment's idle timeout (30 minutes) has left.
    const idle = await visitor();
    await testPool().query("update ai.deployment_conversation set started_at = now() - interval '2 hours' where id = $1", [idle.conversationId]);
    await testPool().query("update ai.conversation_message set created_at = now() - interval '2 hours' where conversation_id = $1", [idle.conversationId]);

    const panel = await conversations.loadActiveConversations();
    const ids = panel.map((item) => item.id);
    expect(panel.find((item) => item.id === withAgent.conversationId)).toMatchObject({ mine: false, lastText: "Is anyone there?" });
    expect(panel.find((item) => item.id === withMe.conversationId)).toMatchObject({ mine: true });
    expect(ids).not.toContain(withColleague.conversationId);
    expect(ids).not.toContain(ended.conversationId);
    expect(ids).not.toContain(idle.conversationId);
    expect(ids).not.toContain(untouched.conversationId);
  });
});
