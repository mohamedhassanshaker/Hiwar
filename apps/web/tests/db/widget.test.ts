import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * The embedded widget's runtime against the database (widget specification, D231): a quick
 * action starting a scenario, typed fields refused and accepted, the OTP step, the summary,
 * the handover and the person answering, a file step, a tool's result shown as a list, and
 * the events the dashboards count.
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
/** A Tool step's connector, answered here so a test decides what it returned. */
vi.mock(import("@/lib/connector-runtime"), async (importOriginal) => ({
  ...(await importOriginal()),
  reloadConnectors: async () => undefined,
  callConnectorTool: async () => ({ content: "", structured: { flights: [{ number: "G9123", origin: "Cairo", status: "Delayed" }] } }),
}));
const stored = new Map<string, Uint8Array>();
vi.mock("@/lib/objects", () => ({
  buckets: { files: "files", artifacts: "artifacts", attachments: "attachments" },
  objectStoreConfigured: () => true,
  putObject: async (bucket: string, key: string, bytes: Uint8Array) => {
    stored.set(`${bucket}/${key}`, bytes);
    return `${bucket}/${key}`;
  },
  deleteObject: async () => undefined,
  getObject: async () => null,
}));

type Claims = { conversationId: string; deploymentCode: string; visitorKey: string; lang: "en" | "ar"; page: string | null; preview: boolean };

describe.skipIf(!hasDatabase)("the embedded widget runtime", () => {
  let adminId = "";
  let projectKey = "";
  const code = `test-wg-${Date.now().toString(36)}`;
  const HOST = "https://host.example.test";

  const blank = {
    sendVerbatim: false,
    slot: null,
    maxAttempts: null,
    verifyMethod: null,
    handoffQueue: null,
    toolRefs: [] as string[],
    skillRefs: [] as string[],
    agentCode: null,
    onError: "Handoff" as const,
    config: {} as Record<string, unknown>,
    messageEn: null as string | null,
    messageAr: null as string | null,
    nextStepName: null as string | null,
  };

  beforeAll(async () => {
    const admin = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id join core.person p on p.id = ra.person_id
       where perm.code = 'channels:write' and rp.effect = 'Allow' and p.status = 'Active' order by ra.person_id limit 1`,
    );
    adminId = admin.rows[0].id;
    signedInAs = adminId;
    const project = await testPool().query<{ key: string }>("select key from work.project where status not in ('Paused', 'Archived') order by key limit 1");
    projectKey = project.rows[0].key;

    const engage = await import("@/features/engage/service");
    const agent = await testPool().query<{ code: string }>("select code from ai.agent where is_system = false limit 1");
    await engage.createDeployment({ code, nameEn: "Widget test", nameAr: "اختبار الويدجت", defaultAgentCode: agent.rows[0].code, surfaces: ["Widget"] });

    // pay_bills: a service, an account with a pattern, a verify step, a confirmation.
    await engage.createStoryline(code, { code: "pay_bills", nameEn: "Pay bills", nameAr: "دفع الفواتير" });
    const steps = [
      ["service", "account"],
      ["account", "verify"],
      ["verify", "confirm"],
      ["confirm", "done"],
      ["done", null],
    ] as const;
    let after: string | null = null;
    for (const [name] of steps) {
      await engage.addStorylineStep({ code: "pay_bills", name, afterName: after });
      after = name;
    }
    await engage.saveStorylineStep({ ...blank, code: "pay_bills", name: "service", type: "Ask", messageEn: "Which service?", messageAr: "أي خدمة؟", slot: "service", nextStepName: "account", config: { choices: [{ value: "home", en: "Home internet", ar: "الإنترنت المنزلي" }] } });
    await engage.saveStorylineStep({ ...blank, code: "pay_bills", name: "account", type: "Ask", messageEn: "Your account number?", messageAr: "رقم حسابك؟", slot: "account", maxAttempts: 3, nextStepName: "verify", config: { field: { type: "text", pattern: "^[0-9.]{6,20}$", labelEn: "account", example: "1.23456789" } } });
    await engage.saveStorylineStep({ ...blank, code: "pay_bills", name: "verify", type: "Verify", verifyMethod: "Otp", nextStepName: "confirm" });
    await engage.saveStorylineStep({ ...blank, code: "pay_bills", name: "confirm", type: "Confirm", messageEn: "Pay {{account}} for {{service}}?", messageAr: "ادفع {{account}}؟", nextStepName: "done" });
    await engage.saveStorylineStep({ ...blank, code: "pay_bills", name: "done", type: "End" });
    await engage.publishStoryline("pay_bills");

    // flights: a tool whose result is shown as a list, then a pick.
    await engage.createStoryline(code, { code: "flights", nameEn: "Flights", nameAr: "الرحلات" });
    await engage.addStorylineStep({ code: "flights", name: "search", afterName: null });
    await engage.addStorylineStep({ code: "flights", name: "pick", afterName: "search" });
    await engage.addStorylineStep({ code: "flights", name: "end", afterName: "pick" });
    await engage.saveStorylineStep({ ...blank, code: "flights", name: "search", type: "Tool", toolRefs: ["airport/search_arrivals"], nextStepName: "pick", config: { present: { as: "list", rowsAt: "flights", id: "number", title: "number", subtitle: "origin", badge: "status" } } });
    await engage.saveStorylineStep({ ...blank, code: "flights", name: "pick", type: "Ask", messageEn: "Which flight?", messageAr: "أي رحلة؟", slot: "flight", nextStepName: "end" });
    await engage.saveStorylineStep({ ...blank, code: "flights", name: "end", type: "End" });

    const version = (await engage.loadDeployments()).deployments.find((one) => one.id === code)?.version ?? 1;
    await engage.saveDeployment({
      code,
      nameEn: "Widget test",
      nameAr: "اختبار الويدجت",
      defaultAgentCode: agent.rows[0].code,
      status: "Enabled",
      surfaces: ["Widget"],
      allowedOrigins: [HOST],
      visitorIdentity: "AnonymousOtpStepUp",
      visitorJwtFallback: "Anonymous",
      handoffQueue: projectKey,
      rateLimitPerVisitor: 100,
      widgetTitleEn: "Any Platform Assistant",
      widgetTitleAr: "مساعد المنصة",
      welcomeEn: "Hello! How can I help?",
      welcomeAr: "مرحباً! كيف أساعدك؟",
      accentColour: "#12034B",
      disclaimerEn: "I'm continuously learning.",
      quickActions: [
        { id: "pay_bills", labelEn: "Pay e& Bills", labelAr: "دفع فواتير e&", storyline: "pay_bills", pages: ["*"], minIdentity: "anonymous" },
        { id: "flights", labelEn: "Flight Arrivals Today", labelAr: "الرحلات القادمة اليوم", storyline: "flights", pages: ["*"], minIdentity: "anonymous" },
      ],
      version,
    });
  });

  afterAll(async () => {
    await testPool().query("delete from work.attachment where owner_type = 'Conversation' and owner_id in (select c.id from ai.deployment_conversation c join ai.embedded_deployment d on d.id = c.deployment_id where d.code = $1)", [code]);
    await testPool().query("delete from ai.embedded_deployment where code = $1", [code]);
    await closeTestPool();
  });

  const session = async (preview = false) => {
    const { startSession } = await import("@/features/engage/widget-session");
    const view = await startSession({ deploymentCode: code, lang: "en", page: null, host: preview ? null : HOST, visitorKey: `wg-${Math.random().toString(36).slice(2, 12)}`, previewBy: preview ? adminId : null });
    const row = await testPool().query<{ visitor_key: string }>("select visitor_key from ai.deployment_conversation where id = $1", [view.sessionId]);
    const claims: Claims = { conversationId: view.sessionId, deploymentCode: code, visitorKey: row.rows[0].visitor_key, lang: "en", page: null, preview };
    return { view, claims };
  };
  const texts = (view: { messages: { blocks: { type: string; text?: string }[] }[] }) =>
    view.messages.flatMap((message) => message.blocks).filter((block) => block.type === "text").map((block) => block.text);

  it("D342 a tapped choice reads as its label in the transcript, with its value kept beside it", async () => {
    const { sendAction } = await import("@/features/engage/widget-session");
    const { claims } = await session();
    await sendAction(claims, { type: "start_scenario", scenario: "pay_bills" });
    const tapped = await sendAction(claims, { type: "postback", payload: { text: "home" }, step: "service" });
    expect(tapped.messages.filter((message) => message.role === "user").at(-1)?.blocks[0]).toEqual({ type: "text", text: "Home internet" });
    const line = await testPool().query<{ text_en: string; payload: { value?: string } }>(
      "select text_en, payload_json as payload from ai.conversation_message where conversation_id = $1 and role = 'Visitor' order by sort_order desc limit 1",
      [claims.conversationId],
    );
    expect(line.rows[0]).toEqual({ text_en: "Home internet", payload: { value: "home" } });
  });

  it("greets with the welcome and the quick actions, and a quick action starts its scenario", async () => {
    const { sendAction } = await import("@/features/engage/widget-session");
    const { view, claims } = await session();
    const greeting = view.messages[0];
    expect(greeting.blocks).toEqual([
      { type: "text", text: "Hello! How can I help?" },
      {
        type: "chips",
        persist: true,
        items: [
          { id: "pay_bills", label: "Pay e& Bills", action: { type: "start_scenario", scenario: "pay_bills" } },
          { id: "flights", label: "Flight Arrivals Today", action: { type: "start_scenario", scenario: "flights" } },
        ],
      },
    ]);
    expect(view.config.disclaimer).toEqual({ en: "I'm continuously learning.", ar: "I'm continuously learning.", dismissible: true });

    const started = await sendAction(claims, { type: "start_scenario", scenario: "pay_bills" });
    expect(texts(started)).toContain("Which service?");
    expect(started.messages.find((message) => message.role === "user")?.blocks[0]).toEqual({ type: "text", text: "Pay e& Bills" });
  });

  it("refuses a value its field does not accept, then takes several values in one message", async () => {
    const { sendAction, sendMessage } = await import("@/features/engage/widget-session");
    const { claims } = await session();
    await sendAction(claims, { type: "start_scenario", scenario: "pay_bills" });
    await sendMessage(claims, "Home internet", null);
    const wrong = await sendMessage(claims, "not a number", null);
    expect(texts(wrong).join(" ")).toContain("For example: 1.23456789");
    const last = wrong.messages.at(-1)!;
    expect(last.input).toMatchObject({ mode: "field", field: { id: "account", type: "text" } });
    expect(last.flow).toMatchObject({ scenario: "pay_bills", step: "account" });

    const right = await sendMessage(claims, "1.23456789", null);
    // The verify step asks for a code next.
    expect(right.messages.at(-1)!.input).toMatchObject({ mode: "field", field: { type: "otp" } });
    expect(right.state.awaiting).toBe("Otp");
  });

  it("verifies the visitor by OTP without the code reaching the transcript, then summarises for confirmation", async () => {
    const { sendAction, sendMessage, verifyOtp, WidgetRefused } = await import("@/features/engage/widget-session");
    const { claims } = await session(true);
    await sendAction(claims, { type: "start_scenario", scenario: "pay_bills" });
    await sendMessage(claims, "Home internet", null);
    const asked = await sendMessage(claims, "1.23456789", null);
    expect(asked.previewOtp).toMatch(/^\d{6}$/);

    const wrong = String((Number(asked.previewOtp) + 1) % 1_000_000).padStart(6, "0");
    await expect(verifyOtp(claims, wrong)).rejects.toMatchObject({ code: "OTP_INVALID" });
    const verified = await verifyOtp(claims, asked.previewOtp!);
    expect(verified.identityLevel).toBe("otp_verified");
    const summary = verified.messages.flatMap((message) => message.blocks).find((block) => block.type === "summary");
    expect(summary).toMatchObject({ rows: [{ field: "account", value: "1.23456789", editable: true }, { field: "service", value: "home", editable: true }] });

    const transcript = await testPool().query<{ text_en: string | null }>("select text_en from ai.conversation_message where conversation_id = $1", [claims.conversationId]);
    expect(transcript.rows.map((row) => row.text_en ?? "").join(" ")).not.toContain(asked.previewOtp!);

    // A button from a step the conversation has left is refused.
    await expect(sendAction(claims, { type: "confirm", step: "account" })).rejects.toBeInstanceOf(WidgetRefused);
    // Nothing in the script acts on the payment, so the agent is asked to (D339); this
    // deployment has no identity to answer as, and says so rather than claiming it is done.
    const done = await sendAction(claims, { type: "confirm", step: "confirm" });
    expect(done.state.ended).toBe(false);
    expect(JSON.stringify(done.messages.at(-1))).toContain("not set up to answer");
  });

  it("D340 a deployment with no handoff queue does not offer a person, and refuses a handoff", async () => {
    const { sendAction, WidgetRefused } = await import("@/features/engage/widget-session");
    const queue = await testPool().query<{ queue: string }>("select handoff_queue as queue from ai.embedded_deployment where code = $1", [code]);
    await testPool().query("update ai.embedded_deployment set handoff_queue = null where code = $1", [code]);
    try {
      const { view, claims } = await session();
      expect(view.config.handoff).toBe(false);
      await expect(sendAction(claims, { type: "handoff", reason: "user_request" })).rejects.toBeInstanceOf(WidgetRefused);
      const row = await testPool().query<{ outcome: string | null }>("select outcome from ai.deployment_conversation where id = $1", [claims.conversationId]);
      expect(row.rows[0].outcome).toBeNull();
    } finally {
      await testPool().query("update ai.embedded_deployment set handoff_queue = $2 where code = $1", [code, queue.rows[0].queue]);
    }
    expect((await session()).view.config.handoff).toBe(true);
  });

  it("hands over to a person: the visitor's messages reach the room and the person's reply reaches the widget", async () => {
    const { sendAction, sendMessage, sessionView } = await import("@/features/engage/widget-session");
    const { mirrorOutbound } = await import("@/features/engage/gateway");
    const { claims } = await session();
    await sendAction(claims, { type: "start_scenario", scenario: "pay_bills" });
    const handed = await sendAction(claims, { type: "handoff", reason: "user_request" });
    expect(handed.state.ended).toBe(false);
    expect(handed.state.handoff).toBe("queued");

    await sendMessage(claims, "Are you there?", null);
    const room = await testPool().query<{ id: string }>("select room_id as id from ai.deployment_conversation where id = $1", [claims.conversationId]);
    const posted = await testPool().query<{ content: { en: string } }>("select content_json as content from work.room_message where room_id = $1 order by seq", [room.rows[0].id]);
    expect(posted.rows.map((row) => row.content.en)).toContain("Visitor: Are you there?");

    await mirrorOutbound(room.rows[0].id, "Yes, I can help.", "Mariam");
    const answered = await sessionView(claims);
    expect(answered.messages.at(-1)).toMatchObject({ role: "human_agent", blocks: [{ type: "text", text: "Yes, I can help." }] });
  });

  it("shows a tool's rows as a list, whose tap answers the next step", async () => {
    const { sendAction, sendMessage } = await import("@/features/engage/widget-session");
    // The tool step has to be granted to the deployment's agent to publish; here it is run unpublished, as the engine does.
    await testPool().query(
      `update ai.storyline_version sv set status = 'Published', published_at = now()
       from ai.storyline sl where sl.id = sv.storyline_id and sl.code = 'flights'
         and sl.deployment_id = (select id from ai.embedded_deployment where code = $1)`,
      [code],
    );
    const { claims } = await session();
    const started = await sendAction(claims, { type: "start_scenario", scenario: "flights" });
    const list = started.messages.flatMap((message) => message.blocks).find((block) => block.type === "list");
    expect(list).toMatchObject({ items: [{ id: "G9123", title: "G9123", subtitle: "Cairo", badge: "Delayed", action: { type: "postback", payload: { text: "G9123" } } }] });
    // The tool acted, so the script closes as written and stays open for the agent (D339).
    const picked = await sendMessage(claims, "G9123", null);
    expect(picked.state.ended).toBe(false);
    expect(JSON.stringify(picked.messages)).not.toContain("not set up to answer");
  });

  it("counts what happened for the deployment's dashboard, without any value the visitor typed", async () => {
    const { deploymentStats } = await import("@/features/engage/repository");
    const stats = await deploymentStats(code, new Date(Date.now() - 60 * 60 * 1000));
    const payBills = stats.scenarios.find((one) => one.scenario === "pay_bills");
    expect(payBills?.started).toBeGreaterThanOrEqual(3);
    expect(payBills?.completed).toBeGreaterThanOrEqual(1);
    expect(payBills?.handedOff).toBeGreaterThanOrEqual(1);
    expect(stats.otp.verified).toBeGreaterThanOrEqual(1);
    const events = await testPool().query<{ props: string }>(
      "select props_json::text as props from ai.widget_event e join ai.embedded_deployment d on d.id = e.deployment_id where d.code = $1",
      [code],
    );
    expect(events.rows.map((row) => row.props).join(" ")).not.toContain("1.23456789");
  });

  it("the deployment's agent starts a service from what the visitor typed, only from a run answering that visitor", async () => {
    const { scenariosForCaller, startScenarioForCaller, ScenarioRejected } = await import("@/features/engage/scenario-service");
    const { sessionView } = await import("@/features/engage/widget-session");
    const { runAs } = await import("@/lib/session");
    const { claims } = await session();

    // Anybody else, a person in the console included, is refused.
    await expect(scenariosForCaller()).rejects.toBeInstanceOf(ScenarioRejected);

    const agent = await testPool().query<{ id: string; version: string }>(
      "select id, active_version_id as version from ai.agent where is_system = false and active_version_id is not null order by code limit 1",
    );
    const runId = crypto.randomUUID();
    await testPool().query(
      `insert into ai.run (id, key, agent_id, agent_version_id, trigger, context_type, context_id, status, started_at)
       values ($1, $2, $3, $4, 'Manual', 'Deployment', $5, 'Running', now())`,
      [runId, `RUN-WG-${Date.now().toString(36)}`, agent.rows[0].id, agent.rows[0].version, claims.conversationId],
    );
    const asRun = <T,>(work: () => Promise<T>) => runAs(adminId, { id: agent.rows[0].id, label: "widget agent", runId }, work);

    expect(await asRun(() => scenariosForCaller())).toContainEqual({ scenario: "pay_bills", labelEn: "Pay e& Bills", labelAr: "دفع فواتير e&" });
    await asRun(() => startScenarioForCaller({ scenario: "pay_bills", prefill: { service: "home", account: "1.23456789" } }));
    const view = await sessionView(claims);
    // Both values were given, so the scenario went straight to the code check.
    expect(view.state.awaiting).toBe("Otp");
    await expect(asRun(() => startScenarioForCaller({ scenario: "not_offered", prefill: {} }))).rejects.toBeInstanceOf(ScenarioRejected);

    await testPool().query("delete from ai.run where id = $1", [runId]);
  });

  it("a quick action can only name one of the deployment's own storylines", async () => {
    const engage = await import("@/features/engage/service");
    const deployment = (await engage.loadDeployments()).deployments.find((one) => one.id === code)!;
    await expect(
      engage.saveDeployment({
        code,
        nameEn: deployment.n,
        nameAr: deployment.nAr,
        defaultAgentCode: deployment.a,
        status: "Enabled",
        surfaces: ["Widget"],
        allowedOrigins: [HOST],
        visitorIdentity: "AnonymousOtpStepUp",
        visitorJwtFallback: "Anonymous",
        handoffQueue: projectKey,
        rateLimitPerVisitor: 100,
        widgetTitleEn: null,
        widgetTitleAr: null,
        welcomeEn: null,
        welcomeAr: null,
        accentColour: "#12034B",
        quickActions: [{ id: "elsewhere", labelEn: "Elsewhere", labelAr: "", storyline: "not_ours", pages: ["*"], minIdentity: "anonymous" }],
        version: deployment.version,
      }),
    ).rejects.toThrow("not_ours");
  });
});
