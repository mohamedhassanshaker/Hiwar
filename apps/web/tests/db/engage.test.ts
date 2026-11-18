import { createServer } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-61 to S-65 against the database.
 *
 * The channels are where a stranger reaches the platform and the widget is where one talks
 * to it, so what is checked here is what bounds both: what a channel does with a message,
 * what a deployment refuses to publish, and what a storyline actually does to a visitor.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";
process.env.AUTH_SECRET ??= "a-widget-session-secret-for-the-tests";
process.env.APP_KEK ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/**
 * A provider and a platform the checks can really reach.
 *
 * Started before anything imports the services, because `APP_URL` is read once and the
 * inbound-webhook check calls it: a channel test that cannot reach either end proves
 * nothing about the checks themselves.
 */
const received: { path: string; body: string }[] = [];
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    received.push({ path: request.url ?? "", body: Buffer.concat(chunks).toString() });
    response.writeHead(request.url === "/refuse" ? 502 : 200, { "content-type": "application/json" });
    response.end("{}");
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
process.env.APP_URL = `http://127.0.0.1:${port}`;

let signedInAs = "";

// The loader route reads the request time with `connection()`, which needs a request Next is serving.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
/**
 * A storyline Tool step calls a connector over HTTP. The call is answered here, so a test
 * decides what the connector returned, or that it failed, and sees what it was asked.
 */
const connectorCalls: { connector: string; tool: string; args: Record<string, unknown> }[] = [];
let connectorAnswer: () => Promise<{ content: string; structured: unknown }> = async () => ({ content: "", structured: null });
vi.mock(import("@/lib/connector-runtime"), async (importOriginal) => ({
  ...(await importOriginal()),
  reloadConnectors: async () => undefined,
  callConnectorTool: async (connector: string, tool: string, args: Record<string, unknown>) => {
    connectorCalls.push({ connector, tool, args });
    return connectorAnswer();
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("channels, deployments and the widget", () => {
  let adminId = "";
  let deploymentCode = "";
  let storylineCode = "";
  beforeAll(async () => {
    const admin = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'channels:write' and rp.effect = 'Allow' and p.status = 'Active'
       order by ra.person_id limit 1`,
    );
    adminId = admin.rows[0].id;

    const deployment = await testPool().query<{ code: string }>(
      "select code from ai.embedded_deployment where active_storyline_version_id is not null limit 1",
    );
    deploymentCode = deployment.rows[0].code;
    const storyline = await testPool().query<{ code: string }>(
      `select sl.code from ai.storyline sl
       join ai.embedded_deployment d on d.id = sl.deployment_id
       where d.code = $1 limit 1`,
      [deploymentCode],
    );
    storylineCode = storyline.rows[0].code;
  });

  afterEach(() => {
    received.length = 0;
    signedInAs = "";
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeTestPool();
  });

  const configure = async (over: Record<string, unknown> = {}) => {
    const { configureChannel } = await import("@/features/engage/service");
    await configureChannel({
      type: "WhatsApp",
      rateLimitPerMinute: 30,
      unknownSenders: "ExternalContact",
      businessHours: "AlwaysOn",
      bindingType: "EmbeddedDeployment",
      bindingDeploymentCode: deploymentCode,
      offlineMessageEn: "We are closed.",
      offlineMessageAr: "نحن مغلقون.",
      endpointUrl: `http://127.0.0.1:${port}/send`,
      secret: "a-provider-token",
      inboundSecret: "an-inbound-secret",
      ...over,
    });
  };

  it("UC-61.1-02 a channel's configuration is saved whole and read back without its secrets", async () => {
    const { loadChannelBoard } = await import("@/features/engage/service");
    signedInAs = adminId;
    await configure();

    const { configs } = await loadChannelBoard();
    const channel = configs.WhatsApp;
    expect(channel.bindingType).toBe("EmbeddedDeployment");
    expect(channel.bindingDeploymentCode).toBe(deploymentCode);
    expect(channel.endpointUrl).toBe(`http://127.0.0.1:${port}/send`);
    // The credentials are reported as present, never returned.
    expect(channel.hasSecret).toBe(true);
    expect(channel.hasInboundSecret).toBe(true);
    expect(JSON.stringify(channel)).not.toContain("a-provider-token");
  });

  it("UC-61.1-03 UC-61.1-05 the test sends a real message, and a failing check says why", async () => {
    const { testChannel } = await import("@/features/engage/service");
    signedInAs = adminId;
    await configure();

    const passed = await testChannel({ type: "WhatsApp", sendTo: "+971500000000", message: "AWP channel test" });
    expect(passed.map((check) => check.ok)).toEqual([true, true, true]);
    expect(received.some((one) => one.path === "/send" && one.body.includes("AWP channel test"))).toBe(true);
    expect(passed[1].ms).toBeGreaterThanOrEqual(0);

    // `UC-61.1-05`: an endpoint that refuses is reported as the failing check, with its reason.
    await configure({ endpointUrl: `http://127.0.0.1:${port}/refuse` });
    const failed = await testChannel({ type: "WhatsApp", sendTo: "+971500000000", message: "AWP channel test" });
    expect(failed[1].ok).toBe(false);
    expect(failed[1].detail).toContain("502");
  });

  it("UC-61.1-06 an enabled channel whose checks failed shows as Degraded", async () => {
    const { loadChannelBoard, setChannelEnabled, testChannel } = await import("@/features/engage/service");
    signedInAs = adminId;
    await configure({ endpointUrl: `http://127.0.0.1:${port}/refuse` });

    const before = await loadChannelBoard();
    await setChannelEnabled({ type: "WhatsApp", enabled: true, version: before.configs.WhatsApp.version });
    await testChannel({ type: "WhatsApp", sendTo: "+971500000000", message: "ping" });

    const after = await loadChannelBoard();
    expect(after.configs.WhatsApp.status).toBe("Degraded");
  });

  it("UC-61.1-10 a channel the platform has not built cannot be switched on", async () => {
    const { setChannelEnabled } = await import("@/features/engage/service");
    signedInAs = adminId;
    await expect(setChannelEnabled({ type: "Slack", enabled: true, version: 1 })).rejects.toThrow(/not available yet/);
  });

  it("UC-61.1-08 UC-61.1-09 a dropped and a throttled message are both recorded with the reason", async () => {
    const { handleInbound } = await import("@/features/engage/gateway");
    signedInAs = adminId;
    await configure({ unknownSenders: "Ignore", rateLimitPerMinute: 1 });

    const dropped = await handleInbound({ channelType: "WhatsApp", senderKey: "+971509999999", senderName: "Nobody", text: "hello" });
    expect(dropped.action).toBe("Dropped");
    expect(dropped.detail).toMatch(/ignored/i);

    const { rows } = await testPool().query<{ action: string; detail: string }>(
      `select m.action, m.detail from ai.channel_message m join ai.channel c on c.id = m.channel_id
       where c.type = 'WhatsApp' and m.sender_key = $1 order by m.created_at desc limit 1`,
      ["+971509999999"],
    );
    expect(rows[0].action).toBe("Dropped");

    // `UC-61.1-09`: the second message inside the minute is throttled, with a notice back.
    await configure({ unknownSenders: "ExternalContact", rateLimitPerMinute: 1 });
    await handleInbound({ channelType: "WhatsApp", senderKey: "+971501111111", senderName: "Caller", text: "one" });
    const throttled = await handleInbound({ channelType: "WhatsApp", senderKey: "+971501111111", senderName: "Caller", text: "two" });
    expect(throttled.action).toBe("Throttled");
    expect(throttled.replies[0].en).toMatch(/faster than we can answer/);
  });

  it("UC-61.1-04 a channel that is off does not process what arrives on it", async () => {
    const { handleInbound } = await import("@/features/engage/gateway");
    const { loadChannelBoard, setChannelEnabled } = await import("@/features/engage/service");
    signedInAs = adminId;
    await configure();
    const board = await loadChannelBoard();
    await setChannelEnabled({ type: "WhatsApp", enabled: false, version: board.configs.WhatsApp.version });

    const outcome = await handleInbound({ channelType: "WhatsApp", senderKey: "+971502222222", senderName: "Caller", text: "hello" });
    expect(outcome.action).toBe("Dropped");
    expect(outcome.detail).toMatch(/turned off/);

    const after = await loadChannelBoard();
    await setChannelEnabled({ type: "WhatsApp", enabled: true, version: after.configs.WhatsApp.version });
  });

  it("UC-65.1-01 UC-65.1-02 UC-65.1-04 a visitor runs the storyline and gets a reference", async () => {
    const { openConversation, takeTurn } = await import("@/features/engage/conversation");
    signedInAs = adminId;

    const opened = await openConversation({ deploymentCode, visitorKey: `test:${Date.now()}`, origin: null, preview: true });
    expect(opened.storyline?.total).toBeGreaterThan(0);
    // The script opens with its greeting and stops where it needs the visitor.
    expect(opened.lines.some((line) => line.role === "Agent" && line.textEn)).toBe(true);
    expect(opened.awaiting).not.toBeNull();

    const visitorKey = `test:${Date.now()}:second`;
    const second = await openConversation({ deploymentCode, visitorKey, origin: null, preview: true });
    expect(second.conversationId).not.toBe(opened.conversationId);

    // The same visitor coming back gets the conversation they already had.
    const again = await openConversation({ deploymentCode, visitorKey, origin: null, preview: true });
    expect(again.conversationId).toBe(second.conversationId);

    if (second.awaiting === "Otp") {
      const verified = await takeTurn({
        conversationId: second.conversationId,
        visitorKey,
        turn: { kind: "Otp", code: second.previewOtp ?? "000000" },
        preview: true,
      });
      expect(verified.lines.some((line) => line.kind === "Verified")).toBe(true);
      expect(verified.quickReplies.length).toBeGreaterThan(0);
    }
  });

  it("UC-65.1-10 a widget loaded from an origin that is not allowed is refused", async () => {
    const { openConversation } = await import("@/features/engage/conversation");
    const { VisitorRefused } = await import("@/features/engage/conversation-view");
    signedInAs = adminId;
    await expect(
      openConversation({ deploymentCode, visitorKey: "stranger", origin: "https://not-allowed.example" }),
    ).rejects.toBeInstanceOf(VisitorRefused);
  });

  it("UC-23.1-13 a mirrored room takes a message in from the channel and sends replies back", async () => {
    const { handleInbound } = await import("@/features/engage/gateway");
    const { mirrorRoom } = await import("@/features/engage/service");
    const { postMessage } = await import("@/features/rooms/service");
    signedInAs = adminId;
    await configure({ bindingType: "RoomMirror", bindingDeploymentCode: null, unknownSenders: "ExternalContact" });

    // A room with a person in it, because a mirrored message is posted as that person.
    const room = await testPool().query<{ key: string; email: string; id: string }>(
      `select r.key, p.email, p.id from work.discussion_room r
       join work.room_participant rp on rp.room_id = r.id and rp.principal_type = 'Person'
       join core.person p on p.id = rp.principal_id
       where r.status = 'Active' order by r.key limit 1`,
    );
    const roomKey = room.rows[0].key;
    const reference = `teams-conversation-${Date.now().toString(36)}`;
    await mirrorRoom({ roomKey, channelType: "WhatsApp", externalRef: reference });

    const outcome = await handleInbound({
      channelType: "WhatsApp",
      senderKey: room.rows[0].email,
      senderName: "A colleague",
      text: "This arrived from the channel.",
      externalRef: reference,
    });
    expect(outcome.detail).toContain(roomKey);

    const mirrored = await testPool().query<{ text: string }>(
      `select m.content_json->>'en' as text from work.room_message m
       join work.discussion_room r on r.id = m.room_id where r.key = $1 order by m.seq desc limit 1`,
      [roomKey],
    );
    expect(mirrored.rows[0].text).toBe("This arrived from the channel.");

    // A reply posted in the room goes back out to the channel the room mirrors.
    signedInAs = room.rows[0].id;
    received.length = 0;
    await postMessage({ roomKey, text: "And this goes back." });
    expect(received.some((one) => one.body.includes("And this goes back."))).toBe(true);
  });

  it("UC-62.1-02 UC-63.1-03 UC-63.1-04 UC-63.1-05 a deployment is created, and two rules refuse a bad save", async () => {
    const { createDeployment, loadDeployments, saveDeployment } = await import("@/features/engage/service");
    signedInAs = adminId;
    const code = `test-dep-${Date.now().toString(36)}`;

    const agent = await testPool().query<{ code: string }>("select code from ai.agent where is_system = false limit 1");
    await createDeployment({ code, nameEn: "A test deployment", nameAr: "نشر اختباري", defaultAgentCode: agent.rows[0].code, surfaces: ["Widget"] });

    const { deployments } = await loadDeployments();
    const created = deployments.find((one) => one.id === code);
    expect(created?.st).toBe("Draft");

    const base = {
      code,
      nameEn: "A test deployment",
      nameAr: "نشر اختباري",
      defaultAgentCode: agent.rows[0].code,
      surfaces: ["Widget" as const],
      visitorIdentity: "AnonymousOtpStepUp" as const,
      visitorJwtFallback: "Anonymous" as const,
      handoffQueue: null,
      rateLimitPerVisitor: 20,
      widgetTitleEn: "Help",
      widgetTitleAr: "مساعدة",
      welcomeEn: null,
      welcomeAr: null,
      version: created?.version ?? 1,
    };

    // `UC-63.1-04`: a web widget with nowhere it may run cannot be enabled.
    await expect(
      saveDeployment({ ...base, status: "Enabled", allowedOrigins: [], accentColour: "#12034B" }),
    ).rejects.toThrow(/allowed origins/);

    // `UC-63.1-05`: an accent colour below AA is refused, with a colour that passes.
    await expect(
      saveDeployment({ ...base, status: "Draft", allowedOrigins: ["https://tahseel.ae"], accentColour: "#FFE600" }),
    ).rejects.toMatchObject({ suggestion: expect.stringMatching(/^#[0-9a-f]{6}$/i) });

    await saveDeployment({ ...base, status: "Enabled", allowedOrigins: ["https://tahseel.ae"], accentColour: "#12034B" });
    const after = await loadDeployments();
    expect(after.deployments.find((one) => one.id === code)?.st).toBe("Enabled");

    await testPool().query("delete from ai.embedded_deployment where code = $1", [code]);
  });

  it("D219 a deployment is given a storyline, published, and runs in the widget from an allowed origin", async () => {
    const { addStorylineStep, createDeployment, createStoryline, loadDeployments, publishStoryline, saveDeployment, saveStorylineStep } =
      await import("@/features/engage/service");
    const { saveDeploymentInput } = await import("@/features/engage/schema");
    const { POST } = await import("@/app/embed/v1/sessions/route");
    signedInAs = adminId;
    const code = `test-sl-${Date.now().toString(36)}`;
    const agent = await testPool().query<{ code: string }>("select code from ai.agent where is_system = false limit 1");
    await createDeployment({ code, nameEn: "Storyline test", nameAr: "اختبار السيناريو", defaultAgentCode: agent.rows[0].code, surfaces: ["Widget"] });
    const version = (await loadDeployments()).deployments.find((one) => one.id === code)?.version ?? 1;

    // An origin is a scheme and a host, with any port: no list in one entry, no path. `null`,
    // which a page opened as a file sends, only when written on its own (D220).
    const origins = saveDeploymentInput.shape.allowedOrigins;
    expect(origins.safeParse(["http://localhost:8080", "https://tahseel.ae", "null"]).success).toBe(true);
    for (const bad of ["http://localhost;null", "null;http://localhost", "https://tahseel.ae/page"]) expect(origins.safeParse([bad]).success).toBe(false);
    await saveDeployment({
      code,
      nameEn: "Storyline test",
      nameAr: "اختبار السيناريو",
      defaultAgentCode: agent.rows[0].code,
      status: "Enabled",
      surfaces: ["Widget"],
      allowedOrigins: ["http://localhost:8080", "null"],
      visitorIdentity: "AnonymousOtpStepUp",
      visitorJwtFallback: "Anonymous",
      handoffQueue: null,
      rateLimitPerVisitor: 20,
      widgetTitleEn: "Help",
      widgetTitleAr: "مساعدة",
      welcomeEn: null,
      welcomeAr: null,
      accentColour: "#12034B",
      version,
    });

    // No storyline until one is created, and only one.
    const draftOf = async () => {
      const loaded = await loadDeployments();
      return loaded.enabled ? (loaded.extras[code]?.drafts[0] ?? null) : undefined;
    };
    expect(await draftOf()).toBeNull();
    await createStoryline(code);
    await expect(createStoryline(code)).rejects.toThrow("already has a storyline");
    expect(await draftOf()).toMatchObject({ code, versionNumber: 1, status: "Draft", steps: [] });

    const step = {
      code,
      sendVerbatim: true,
      slot: null,
      maxAttempts: null,
      verifyMethod: null,
      handoffQueue: null,
      toolRefs: [],
      skillRefs: [],
      agentCode: null,
      onError: "RetryOnce" as const,
      config: {},
    };
    await addStorylineStep({ code, name: "welcome", afterName: null });
    await addStorylineStep({ code, name: "done", afterName: "welcome" });
    await saveStorylineStep({ ...step, name: "welcome", type: "Message", messageEn: "Hello from the storyline.", messageAr: "مرحباً من السيناريو.", nextStepName: "done" });
    await saveStorylineStep({ ...step, name: "done", type: "End", messageEn: null, messageAr: null, sendVerbatim: false, nextStepName: null });
    expect(await publishStoryline(code)).toBe(1);

    // A session starts for each allowed host page, a file page's `null` included because it is
    // listed (D220), and for nothing else (D231).
    const start = (host: string) =>
      POST(
        new Request("https://awp.localtest.me/embed/v1/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deployment: code, host, visitorKey: `d219-${host.length}-${Date.now().toString(36)}` }),
        }),
      );
    const opened = await start("http://localhost:8080");
    expect(opened.status).toBe(201);
    const view = (await opened.json()) as { messages: { blocks: { type: string; text?: string }[] }[] };
    expect(view.messages.flatMap((message) => message.blocks).map((block) => block.text)).toContain("Hello from the storyline.");
    expect((await start("null")).status).toBe(201);
    const refused = await start("https://elsewhere.example");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("ORIGIN_NOT_ALLOWED");

    await testPool().query("delete from ai.embedded_deployment where code = $1", [code]);
  });

  it("a step's config is refused when it names a key no step reads, and a menu built from Ask and Decide publishes", async () => {
    const { addStorylineStep, createDeployment, createStoryline, publishStoryline, publishProblemsOf } = await import("@/features/engage/service");
    const { saveStorylineStep } = await import("@/features/engage/actions");
    const { ENGAGE_TOOLS } = await import("@/features/engage/tools");
    signedInAs = adminId;
    const code = `test-menu-${Date.now().toString(36)}`;
    const agent = await testPool().query<{ code: string }>("select code from ai.agent where is_system = false limit 1");
    await createDeployment({ code, nameEn: "Menu test", nameAr: "اختبار القائمة", defaultAgentCode: agent.rows[0].code, surfaces: ["Widget"] });
    await createStoryline(code);
    for (const [name, afterName] of [["menu", null], ["route", "menu"], ["payments", "route"], ["done", "payments"]] as const) {
      await addStorylineStep({ code, name, afterName });
    }
    const step = {
      code,
      messageEn: null,
      messageAr: null,
      sendVerbatim: false,
      slot: null,
      maxAttempts: null,
      verifyMethod: null,
      handoffQueue: null,
      toolRefs: [],
      skillRefs: [],
      agentCode: null,
      nextStepName: null,
      onError: "Handoff",
      config: {},
    };

    // The shape an agent invented on the cluster: refused by the editor's save and by the tool alike, and not stored.
    const invented = { ...step, name: "route", type: "Decide", config: { options: [{ label: "Payments", targetStep: "payments" }] } };
    const saved = await saveStorylineStep(invented);
    expect(saved.ok).toBe(false);
    expect(saved.ok ? "" : saved.reason).toContain("`options`");
    const tool = ENGAGE_TOOLS.find((entry) => entry.name === "storyline_step_edit");
    const parsed = tool?.input.safeParse(invented);
    expect(parsed?.success).toBe(false);
    expect(parsed?.error?.issues.map((issue) => issue.message).join(" ")).toContain("Decide: branches, otherwise");
    const stored = await testPool().query<{ step_type: string; config_json: unknown }>(
      `select st.step_type, st.config_json from ai.storyline_step st
       join ai.storyline_version sv on sv.id = st.storyline_version_id join ai.storyline sl on sl.id = sv.storyline_id
       where sl.code = $1 and st.name = 'route'`,
      [code],
    );
    expect(stored.rows).toEqual([{ step_type: "Message", config_json: {} }]);

    // The menu as the tool describes it: an Ask step's choices, routed by a Decide step's branches.
    for (const one of [
      {
        ...step,
        name: "menu",
        type: "Ask",
        messageEn: "What do you need?",
        messageAr: "ماذا تحتاج؟",
        slot: "topic",
        nextStepName: "route",
        config: { choices: [{ value: "payments", en: "Payments", ar: "المدفوعات" }] },
      },
      { ...step, name: "route", type: "Decide", config: { branches: [{ slot: "topic", equals: "payments", goto: "payments" }], otherwise: "menu" } },
      { ...step, name: "payments", type: "Message", messageEn: "Payments.", messageAr: "المدفوعات.", nextStepName: "done" },
      { ...step, name: "done", type: "End" },
    ]) {
      expect(await saveStorylineStep(one)).toEqual({ ok: true });
    }
    expect(await publishProblemsOf(code)).toEqual([]);
    expect(await publishStoryline(code)).toBe(1);

    await testPool().query("delete from ai.embedded_deployment where code = $1", [code]);
  });

  it("D221 a visitor's free conversation is answered by the agent acting as the deployment's identity", async () => {
    const { createDeployment, loadDeployments, saveDeployment } = await import("@/features/engage/service");
    const { openConversation, takeTurn } = await import("@/features/engage/conversation");
    const { finishRun } = await import("@/features/agents/run-service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = adminId;
    const code = `test-free-${Date.now().toString(36)}`;
    const agent = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired') order by code limit 1",
    );
    await createDeployment({ code, nameEn: "Free test", nameAr: "اختبار حر", defaultAgentCode: agent.rows[0].code, surfaces: ["Widget"] });
    const save = async (runAsPersonId: string | null) =>
      saveDeployment({
        code,
        nameEn: "Free test",
        nameAr: "اختبار حر",
        defaultAgentCode: agent.rows[0].code,
        status: "Enabled",
        surfaces: ["Widget"],
        allowedOrigins: ["http://localhost:8080"],
        visitorIdentity: "AnonymousOtpStepUp",
        visitorJwtFallback: "Anonymous",
        handoffQueue: null,
        runAsPersonId,
        rateLimitPerVisitor: 20,
        widgetTitleEn: "Help",
        widgetTitleAr: "مساعدة",
        welcomeEn: null,
        welcomeAr: null,
        accentColour: "#12034B",
        version: (await loadDeployments()).deployments.find((one) => one.id === code)?.version ?? 1,
      });
    const say = async (text: string) => {
      const visitorKey = `visitor:${Date.now()}:${Math.random()}`;
      const opened = await openConversation({ deploymentCode: code, visitorKey, origin: null, preview: true });
      return takeTurn({ conversationId: opened.conversationId, visitorKey, turn: { kind: "Reply", text } });
    };

    // With no identity the agent does not answer, and the visitor is told.
    await save(null);
    const unanswered = await say("Is anyone there?");
    expect(unanswered.lines.at(-1)).toMatchObject({ role: "System", textEn: expect.stringContaining("not set up to answer") });
    expect(unanswered.pending).toBe(false);

    // Only an administrator sets who the agent acts as: a Publisher may edit the deployment
    // and is refused this one field.
    const publisher = await testPool().query<{ id: string; role: string }>(
      `select p.id, (select id from core.role where name_en = 'Publisher') as role from core.person p
       where p.status = 'Active' and p.id <> $1 and not exists (
         select 1 from core.role_assignment ra join core.role_permission rp on rp.role_id = ra.role_id
         join core.permission perm on perm.id = rp.permission_id
         where ra.person_id = p.id and perm.code = 'agents:configure') limit 1`,
      [adminId],
    );
    const assignment = await testPool().query<{ id: string }>(
      "insert into core.role_assignment (person_id, role_id, scope_type) values ($1, $2, 'Organisation') returning id",
      [publisher.rows[0].id, publisher.rows[0].role],
    );
    try {
      signedInAs = publisher.rows[0].id;
      await expect(save(adminId)).rejects.toBeInstanceOf(NotPermitted);
      await save(null);
    } finally {
      signedInAs = adminId;
      await testPool().query("delete from core.role_assignment where id = $1", [assignment.rows[0].id]);
    }
    await save(adminId);

    // The visitor's message starts the agent as that identity, about this conversation.
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
    const asked = await say("What are your opening hours?");
    expect(asked.pending).toBe(true);
    const run = await testPool().query<{ id: string; person: string; type: string }>(
      "select id, created_by::text as person, context_type as type from ai.run where context_id = $1",
      [asked.conversationId],
    );
    expect(run.rows).toEqual([expect.objectContaining({ person: adminId, type: "Deployment" })]);

    // Its answer is written into the conversation when it finishes.
    await finishRun({
      run_id: run.rows[0].id,
      status: "Succeeded",
      output: "We are open from 8 to 4.",
      tokens_in: 5,
      tokens_out: 5,
      tool_call_count: 0,
      estimated_cost_aed: "0",
      eval_scores: {},
      steps: [],
    });
    const { view } = await import("@/features/engage/conversation-view");
    const answered = await view(asked.conversationId, true);
    expect(answered.pending).toBe(false);
    expect(answered.lines.at(-1)).toMatchObject({ role: "Agent", textEn: "We are open from 8 to 4." });

    // In a published Guided storyline, what the script did not ask for goes to the agent too.
    const { addStorylineStep, createStoryline, publishStoryline, saveStorylineStep } = await import("@/features/engage/service");
    await createStoryline(code);
    const step = {
      code,
      sendVerbatim: false,
      maxAttempts: null,
      verifyMethod: null,
      toolRefs: [],
      skillRefs: [],
      agentCode: null,
      onError: "RetryOnce" as const,
    };
    await addStorylineStep({ code, name: "ask_anything", afterName: null });
    await addStorylineStep({ code, name: "handoff", afterName: "ask_anything" });
    await saveStorylineStep({
      ...step,
      name: "ask_anything",
      type: "Ask",
      messageEn: "Ask me anything, or choose Talk to a person.",
      messageAr: "اسألني أي شيء، أو اختر التحدث مع موظف.",
      slot: "choice",
      handoffQueue: null,
      nextStepName: "handoff",
      config: { choices: [{ value: "person", en: "Talk to a person", ar: "التحدث مع موظف" }] },
    });
    await saveStorylineStep({ ...step, name: "handoff", type: "Handoff", messageEn: null, messageAr: null, slot: null, handoffQueue: null, nextStepName: null, config: {} });
    await testPool().query("update ai.storyline_version sv set mode = 'Guided' from ai.storyline sl where sl.id = sv.storyline_id and sl.code = $1", [code]);
    await publishStoryline(code);
    const offScript = await say("Do you accept card payments?");
    expect(offScript.storyline?.mode).toBe("Guided");
    expect(offScript.pending).toBe(true);
    expect(offScript.lines.map((line) => line.textEn)).not.toContain("I can only help with this process here.");

    await testPool().query("delete from ai.embedded_deployment where code = $1", [code]);
  });

  it("UC-63.1-06 a deployment that expects a signed visitor checks the token", async () => {
    const { createHmac } = await import("node:crypto");
    const { verifyVisitorToken } = await import("@/features/engage/identity");

    const secret = "a-shared-secret-the-host-site-signs-with";
    const sign = (claims: Record<string, unknown>) => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
      return `${header}.${body}.${createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")}`;
    };

    expect(verifyVisitorToken(sign({ sub: "visitor-1", name: "A visitor" }), secret)?.subject).toBe("visitor-1");
    // A token signed with something else, one that has run out, and one with no subject.
    expect(verifyVisitorToken(sign({ sub: "visitor-1" }), "a-different-secret")).toBeNull();
    expect(verifyVisitorToken(sign({ sub: "visitor-1", exp: 1 }), secret)).toBeNull();
    expect(verifyVisitorToken(sign({ name: "No subject" }), secret)).toBeNull();
  });

  it("UC-63.1-07 UC-63.1-09 the thirty-day figures are read, and a paused agent is warned about", async () => {
    const { loadDeployments } = await import("@/features/engage/service");
    const { openConversation } = await import("@/features/engage/conversation");
    signedInAs = adminId;

    const loaded = await loadDeployments();
    expect(loaded.enabled).toBe(true);
    const extras = loaded.enabled ? loaded.extras[deploymentCode] : null;
    expect(extras?.activity.conversations).toBeGreaterThanOrEqual(0);

    // `UC-63.1-09`: with the default agent paused the visitor is offered a person instead.
    const before = await testPool().query<{ status: string }>(
      "select a.status from ai.agent a join ai.embedded_deployment d on d.default_agent_id = a.id where d.code = $1",
      [deploymentCode],
    );
    await testPool().query(
      `update ai.agent set status = 'Paused' where id = (select default_agent_id from ai.embedded_deployment where code = $1)`,
      [deploymentCode],
    );
    const paused = await openConversation({ deploymentCode, visitorKey: `paused:${Date.now()}`, origin: null, preview: true });
    expect(paused.agentWarning).toMatch(/ask for a person/);

    await testPool().query(
      `update ai.agent set status = $2 where id = (select default_agent_id from ai.embedded_deployment where code = $1)`,
      [deploymentCode, before.rows[0].status],
    );
  });

  it("UC-65.1-09 a wrong one-time code is re-asked, and the step gives up after its limit", async () => {
    const { openConversation, takeTurn } = await import("@/features/engage/conversation");
    signedInAs = adminId;
    const visitorKey = `otp:${Date.now()}`;

    const opened = await openConversation({ deploymentCode, visitorKey, origin: null, preview: true });
    if (opened.awaiting !== "Otp") return;

    let view = await takeTurn({ conversationId: opened.conversationId, visitorKey, turn: { kind: "Otp", code: "000000" }, preview: true });
    expect(view.lines.some((line) => line.textEn?.includes("not right"))).toBe(true);
    expect(view.awaiting).toBe("Otp");

    // Three wrong codes is the limit, and the step then follows its On error path.
    view = await takeTurn({ conversationId: opened.conversationId, visitorKey, turn: { kind: "Otp", code: "111111" }, preview: true });
    view = await takeTurn({ conversationId: opened.conversationId, visitorKey, turn: { kind: "Otp", code: "222222" }, preview: true });
    expect(view.outcome).toBe("HandedOff");
  });

  it("UC-65.1-12 a visitor over the deployment's limit is throttled", async () => {
    const { openConversation, takeTurn } = await import("@/features/engage/conversation");
    const { VisitorRefused } = await import("@/features/engage/conversation-view");
    const { loadDeployments, saveDeployment } = await import("@/features/engage/service");
    signedInAs = adminId;

    const before = (await loadDeployments()).deployments.find((one) => one.id === deploymentCode);
    if (!before) return;
    const asSaved = {
      code: deploymentCode,
      nameEn: before.n,
      nameAr: before.nAr,
      defaultAgentCode: before.a,
      status: before.st as "Enabled",
      surfaces: before.surf.split(" · ").filter(Boolean) as ("Widget" | "WhatsApp" | "Teams")[],
      allowedOrigins: before.allowedOrigins,
      visitorIdentity: before.visitorIdentity as "AnonymousOtpStepUp",
      visitorJwtFallback: before.visitorJwtFallback as "Anonymous",
      handoffQueue: before.handoffQueue,
      widgetTitleEn: before.widgetTitleEn,
      widgetTitleAr: before.widgetTitleAr,
      accentColour: before.accentColour ?? "#12034B",
      welcomeEn: before.welcomeEn,
      welcomeAr: before.welcomeAr,
    };
    await saveDeployment({ ...asSaved, rateLimitPerVisitor: 1, version: before.version });

    const visitorKey = `busy:${Date.now()}`;
    const opened = await openConversation({ deploymentCode, visitorKey, origin: null, preview: true });
    await takeTurn({ conversationId: opened.conversationId, visitorKey, turn: { kind: "Reply", text: "one" }, preview: true });
    await expect(
      takeTurn({ conversationId: opened.conversationId, visitorKey, turn: { kind: "Reply", text: "two" }, preview: true }),
    ).rejects.toBeInstanceOf(VisitorRefused);

    const after = (await loadDeployments()).deployments.find((one) => one.id === deploymentCode);
    await saveDeployment({ ...asSaved, rateLimitPerVisitor: before.rateLimitPerVisitor ?? 20, version: after?.version ?? before.version + 1 });
  });

  it("UC-64.1-05 a verbatim message is what the step says, in each language", async () => {
    const { loadDeployments } = await import("@/features/engage/service");
    const { advance, newConversation } = await import("@/features/engage/storyline");
    signedInAs = adminId;

    // Read the way the screen reads it: the editor is given the draft with the deployment.
    const loaded = await loadDeployments();
    expect(loaded.enabled).toBe(true);
    const draft = loaded.enabled ? loaded.extras[deploymentCode]?.drafts[0] : null;
    expect(draft, "the seeded deployment must carry a storyline").toBeTruthy();
    const exact = draft!.steps.find((step) => step.sendVerbatim);
    expect(exact, "a storyline must carry a verbatim step for this rule to mean anything").toBeTruthy();

    const opened = advance(
      { code: draft!.code, versionNumber: draft!.versionNumber, mode: "Strict", steps: draft!.steps },
      newConversation(),
      { kind: "Open" },
    );
    expect(opened.emissions[0]).toEqual({ kind: "Message", en: exact!.messageEn, ar: exact!.messageAr, verbatim: true });
  });

  it("UC-62.1-04 with the feature turned off the deployments screen is given nothing to show", async () => {
    const { loadDeployments } = await import("@/features/engage/service");
    const { setFeatureFlag } = await import("@/features/governance/service");
    signedInAs = adminId;

    await setFeatureFlag("embedded-deployments", false);
    expect((await loadDeployments()).enabled).toBe(false);

    await setFeatureFlag("embedded-deployments", true);
    expect((await loadDeployments()).enabled).toBe(true);
  });

  it("UC-65.1-11 the embedded widget carries its own language, and turns for Arabic", async () => {
    const { GET } = await import("@/app/embed/v1/widget.js/route");
    const script = await (await GET()).text();

    // The loader follows the page's language, flips its corner for Arabic, and lets the host
    // change the language later (widget specification 3, 13.2).
    expect(script).toContain('getAttribute("data-lang")');
    expect(script).toContain('lang === "ar"');
    expect(script).toContain("setLanguage");
  });

  it("UC-64.1-09 publishing makes a new version and keeps the one it replaced", async () => {
    const { loadDeployments, publishStoryline } = await import("@/features/engage/service");
    signedInAs = adminId;

    const loaded = await loadDeployments();
    const before = loaded.enabled ? loaded.extras[deploymentCode]?.drafts[0] : null;
    const published = await publishStoryline(storylineCode);
    expect(published).toBeGreaterThan(before?.publishedVersionNumber ?? 0);

    const { rows } = await testPool().query<{ version_number: number; status: string }>(
      `select sv.version_number, sv.status from ai.storyline_version sv
       join ai.storyline sl on sl.id = sv.storyline_id where sl.code = $1 order by sv.version_number`,
      [storylineCode],
    );
    // Exactly one published version, and the one it replaced is kept rather than deleted.
    expect(rows.filter((row) => row.status === "Published")).toHaveLength(1);
    expect(rows.some((row) => row.status === "Superseded")).toBe(true);
  });

  it("UC-64.1-10 a step with nothing to say and nowhere to go blocks the publish", async () => {
    const { addStorylineStep, deleteStorylineStep, publishProblemsOf } = await import("@/features/engage/service");
    signedInAs = adminId;
    const name = `blocker_${Date.now().toString(36)}`;

    await addStorylineStep({ code: storylineCode, name, afterName: null });
    const problems = await publishProblemsOf(storylineCode);
    expect(problems.some((problem) => problem.step === name && problem.reason === "NotConfigured")).toBe(true);
    expect(problems.some((problem) => problem.step === name && problem.reason === "NoNextStep")).toBe(true);

    await deleteStorylineStep({ code: storylineCode, name });
  });

  it("UC-64.1-08 the simulation plays the draft and reports where it ended", async () => {
    const { simulateStoryline } = await import("@/features/engage/service");
    signedInAs = adminId;

    const result = await simulateStoryline({
      code: storylineCode,
      variables: { last4: "4821" },
      turns: ["damaged", "Villa 12, Al Barsha", "yes"],
    });
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.slots.last4).toBe("4821");
  });
});

/**
 * The visitor runtime and the console's deployment and storyline actions, against a
 * deployment of their own.
 *
 * The seeded storyline stops at a one-time code, so its Classify, Tool and Create work steps
 * are never reached by a visitor. This deployment's storyline is only those steps, so each
 * effect the runtime performs is reached and its result read back from the database.
 */
describe.skipIf(!hasDatabase)("a deployment that runs every visitor effect", () => {
  const code = `test-fx-${Date.now().toString(36)}`;
  const storylineCode = `${code}-sl`;
  const origin = "https://visitor.test";
  let adminId = "";
  let memberId = "";
  let contactId = "";
  let seededDeployment = "";
  let publishedVersionId = "";
  const raised: string[] = [];

  const conversationRow = async (id: string) =>
    (
      await testPool().query<{
        outcome: string | null;
        slots_json: Record<string, string>;
        request_id: string | null;
        rating: number | null;
        visitor_key: string;
      }>("select outcome, slots_json, request_id, rating, visitor_key from ai.deployment_conversation where id = $1", [id])
    ).rows[0];

  /** Opens a conversation as a visitor on the allowed origin and answers the first question. */
  const visit = async (reply: string, options: { contact?: boolean } = {}) => {
    const { openConversation, takeTurn } = await import("@/features/engage/conversation");
    const visitorKey = `fx:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const opened = await openConversation({
      deploymentCode: code,
      visitorKey,
      origin,
      externalContactId: options.contact ? contactId : null,
    });
    const answered = await takeTurn({ conversationId: opened.conversationId, visitorKey, turn: { kind: "Reply", text: reply } });
    return { visitorKey, opened, answered };
  };

  beforeAll(async () => {
    const admin = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role_permission rp on rp.role_id = ra.role_id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'channels:write' and rp.effect = 'Allow' and p.status = 'Active'
       order by ra.person_id limit 1`,
    );
    adminId = admin.rows[0].id;
    memberId = (await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'")).rows[0].id;
    contactId = (await testPool().query<{ id: string }>("select id from core.external_contact order by created_at limit 1")).rows[0].id;
    seededDeployment = (
      await testPool().query<{ code: string }>(
        "select code from ai.embedded_deployment where active_storyline_version_id is not null and code not like 'test-%' order by code limit 1",
      )
    ).rows[0].code;

    const { createDeployment, saveDeployment } = await import("@/features/engage/service");
    signedInAs = adminId;
    const agent = await testPool().query<{ code: string }>("select code from ai.agent where is_system = false and status = 'Idle' order by code limit 1");
    await createDeployment({ code, nameEn: "Effects", nameAr: "التأثيرات", defaultAgentCode: agent.rows[0].code, surfaces: ["Widget"] });
    const version = (await testPool().query<{ version: number }>("select version from ai.embedded_deployment where code = $1", [code])).rows[0].version;
    await saveDeployment({
      code,
      nameEn: "Effects",
      nameAr: "التأثيرات",
      defaultAgentCode: agent.rows[0].code,
      status: "Enabled",
      surfaces: ["Widget"],
      allowedOrigins: [origin],
      visitorIdentity: "AnonymousOtpStepUp",
      visitorJwtFallback: "Anonymous",
      handoffQueue: null,
      rateLimitPerVisitor: 20,
      widgetTitleEn: "Effects",
      widgetTitleAr: "التأثيرات",
      accentColour: "#12034B",
      welcomeEn: null,
      welcomeAr: null,
      version,
    });

    // Ask, Classify, Tool, Create work, End: each failure hands over, as the step says.
    const deploymentId = (await testPool().query<{ id: string }>("select id from ai.embedded_deployment where code = $1", [code])).rows[0].id;
    const storylineId = (
      await testPool().query<{ id: string }>(
        "insert into ai.storyline (deployment_id, code, name_en, name_ar) values ($1, $2, 'Effects', 'التأثيرات') returning id",
        [deploymentId, storylineCode],
      )
    ).rows[0].id;
    publishedVersionId = (
      await testPool().query<{ id: string }>(
        "insert into ai.storyline_version (storyline_id, version_number, mode, status, published_at) values ($1, 1, 'Strict', 'Published', now()) returning id",
        [storylineId],
      )
    ).rows[0].id;
    const steps: [string, string, string | null, string | null, string[], Record<string, unknown>][] = [
      ["ask_topic", "Ask", "What is it about?", "topic", [], {}],
      ["classify", "Classify", null, "kind", [], { choices: [{ value: "card", en: "Card", ar: "بطاقة" }] }],
      ["lookup", "Tool", null, null, ["crm/contact.lookup"], {}],
      ["create", "CreateWork", null, null, [], { requestTypeCode: "CRD" }],
      ["done", "End", null, null, [], {}],
    ];
    for (const [index, [name, type, message, slot, tools, config]] of steps.entries()) {
      await testPool().query(
        `insert into ai.storyline_step (storyline_version_id, sort_order, name, step_type, message_en, message_ar, slot, tool_refs, on_error, config_json)
         values ($1, $2, $3, $4, $5, $5, $6, $7, 'Handoff', $8)`,
        [publishedVersionId, index, name, type, message, slot, tools, config],
      );
    }
    for (let index = 0; index < steps.length - 1; index += 1) {
      await testPool().query(
        `update ai.storyline_step s set next_step_id = n.id from ai.storyline_step n
         where s.storyline_version_id = $1 and n.storyline_version_id = $1 and s.name = $2 and n.name = $3`,
        [publishedVersionId, steps[index][0], steps[index + 1][0]],
      );
    }
    await testPool().query("update ai.embedded_deployment set active_storyline_version_id = $1 where code = $2", [publishedVersionId, code]);
  });

  afterEach(() => {
    connectorCalls.length = 0;
    connectorAnswer = async () => ({ content: "", structured: null });
    signedInAs = adminId;
  });

  afterAll(async () => {
    // The deployment takes its storyline and conversations with it; the requests it raised
    // are not its own, so they go separately, after the conversations that point at them.
    await testPool().query("delete from ai.embedded_deployment where code = $1", [code]);
    for (const key of raised) {
      await testPool().query("delete from work.request_event where request_id = (select id from work.request where key = $1)", [key]);
      await testPool().query("delete from work.request where key = $1", [key]);
    }
    signedInAs = "";
  });

  it("UC-65.1-04 a classified answer and a tool's answer fill the slots, and Create work returns the reference", async () => {
    connectorAnswer = async () => ({ content: "", structured: { customer: "C-77", tier: 2, flags: ["vip"] } });

    const { opened, answered } = await visit("CARD", { contact: true });
    expect(opened.awaiting).toBe("Reply");

    // The tool was asked with what the conversation had collected by then.
    expect(connectorCalls).toEqual([{ connector: "crm", tool: "contact.lookup", args: { topic: "CARD", kind: "card" } }]);

    const reference = answered.lines.find((line) => line.kind === "Reference")?.textEn;
    expect(reference).toBeTruthy();
    raised.push(reference!);
    expect(answered.outcome).toBe("RequestCreated");

    const row = await conversationRow(opened.conversationId);
    // Only a string or a number from the tool becomes a slot.
    expect(row.slots_json).toEqual({ topic: "CARD", kind: "card", customer: "C-77", tier: "2" });
    expect(row.outcome).toBe("RequestCreated");

    const request = await testPool().query<{ id: string; requester_type: string; requester_id: string; title_en: string }>(
      "select id, requester_type, requester_id, title_en from work.request where key = $1",
      [reference],
    );
    expect(request.rows[0]).toMatchObject({ requester_type: "ExternalContact", requester_id: contactId });
    expect(request.rows[0].title_en).toBe(`${storylineCode} from the ${code} assistant`);
    expect(row.request_id).toBe(request.rows[0].id);
  });

  it("UC-65.1-04 an answer no choice matches, a failing tool and a visitor nobody can raise for each hand over", async () => {
    // Nothing the Classify step offers: the step follows its On error.
    const unmatched = await visit("something else");
    expect(unmatched.answered.outcome).toBe("HandedOff");
    expect(connectorCalls).toHaveLength(0);
    expect((await conversationRow(unmatched.opened.conversationId)).slots_json).toEqual({ topic: "something else" });

    // The connector refuses the call.
    connectorAnswer = async () => {
      throw new Error("the connector is down");
    };
    const failing = await visit("Card", { contact: true });
    expect(failing.answered.outcome).toBe("HandedOff");
    expect(connectorCalls).toHaveLength(1);
    expect((await conversationRow(failing.opened.conversationId)).request_id).toBeNull();

    // No external contact to raise the request for, so there is no reference to give.
    connectorAnswer = async () => ({ content: "", structured: null });
    const anonymous = await visit("Card");
    expect(anonymous.answered.outcome).toBe("HandedOff");
    expect(anonymous.answered.lines.some((line) => line.kind === "Reference")).toBe(false);
    expect((await conversationRow(anonymous.opened.conversationId)).request_id).toBeNull();
  });

  it("UC-65.1-14 a visitor rates their own conversation, and nobody else's", async () => {
    const { rateConversation } = await import("@/features/engage/conversation");
    const { VisitorRefused } = await import("@/features/engage/conversation-view");
    const { opened, visitorKey } = await visit("something else");

    await rateConversation(opened.conversationId, visitorKey, 4);
    expect((await conversationRow(opened.conversationId)).rating).toBe(4);

    await expect(rateConversation(opened.conversationId, "somebody-else", 1)).rejects.toMatchObject({ reason: "NotYours" });
    await expect(rateConversation(crypto.randomUUID(), visitorKey, 1)).rejects.toBeInstanceOf(VisitorRefused);
    expect((await conversationRow(opened.conversationId)).rating).toBe(4);
  });

  it("UC-65.1-01 the widget reloads a conversation as it was written, for its own visitor only", async () => {
    const { sendMessage, sessionView, WidgetRefused } = await import("@/features/engage/widget-session");
    const { opened, visitorKey } = await visit("something else");
    const claims = { conversationId: opened.conversationId, deploymentCode: code, visitorKey, lang: "en" as const, page: null, preview: false };

    const view = await sessionView(claims);
    const stored = await testPool().query<{ role: string; text_en: string | null }>(
      "select role, text_en from ai.conversation_message where conversation_id = $1 and role = 'Visitor' order by sort_order",
      [opened.conversationId],
    );
    // Every visitor line is the visitor's own message, in order.
    expect(view.messages.filter((message) => message.role === "user").map((message) => message.blocks[0])).toEqual(
      stored.rows.map((row) => ({ type: "text", text: row.text_en })),
    );
    // A handed-over conversation stays open: the visitor goes on talking to a person.
    const outcome = (await conversationRow(opened.conversationId)).outcome;
    expect(view.state.ended).toBe(outcome !== null && outcome !== "HandedOff");
    // The public widget is never handed a one-time code.
    expect(view.previewOtp).toBeUndefined();

    await expect(sendMessage({ ...claims, visitorKey: "somebody-else" }, "hello", null)).rejects.toBeInstanceOf(WidgetRefused);
    await expect(sessionView({ ...claims, conversationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("UC-65.1-10 the widget endpoint answers with the origins the deployment allows", async () => {
    const { allowedOriginsOf } = await import("@/features/engage/conversation-view");
    const stored = await testPool().query<{ allowed_origins: string[] }>("select allowed_origins from ai.embedded_deployment where code = $1", [
      seededDeployment,
    ]);

    expect(await allowedOriginsOf(seededDeployment)).toEqual(stored.rows[0].allowed_origins);
    expect(await allowedOriginsOf(code)).toEqual([origin]);
    expect(await allowedOriginsOf("no-such-deployment")).toEqual([]);
  });

  it("UC-63.1-08 UC-65.1-15 the preview runs the deployment as the designer, under their own key", async () => {
    const { POST } = await import("@/app/embed/v1/sessions/route");
    const { sendMessage } = await import("@/features/engage/widget-session");
    const key = `p-${Date.now().toString(36)}-preview`;
    const start = () =>
      POST(
        new Request("https://awp.localtest.me/embed/v1/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deployment: code, visitorKey: key, preview: true }),
        }),
      );

    signedInAs = adminId;
    const opened = (await (await start()).json()) as { sessionId: string; state: { awaiting: string } };
    expect((await conversationRow(opened.sessionId)).visitor_key).toBe(`preview:${adminId}:${key}`);
    expect(opened.state.awaiting).toBe("Reply");

    const claims = { conversationId: opened.sessionId, deploymentCode: code, visitorKey: `preview:${adminId}:${key}`, lang: "en" as const, page: null, preview: true };
    await sendMessage(claims, "something else", null);
    expect((await conversationRow(opened.sessionId)).outcome).toBe("HandedOff");
    const sent = await testPool().query<{ text_en: string }>(
      "select text_en from ai.conversation_message where conversation_id = $1 and role = 'Visitor'",
      [opened.sessionId],
    );
    expect(sent.rows.map((row) => row.text_en)).toEqual(["something else"]);

    // Only a designer may preview: anybody else is refused before a conversation exists.
    signedInAs = memberId;
    const refused = await start();
    expect(refused.status).toBe(403);
  });

  it("UC-63.1-* the delete confirmation counts every conversation the deployment has held", async () => {
    const { deploymentConversationCount } = await import("@/features/engage/service");
    const { NotPermitted } = await import("@/lib/session");
    const stored = await testPool().query<{ n: number }>(
      "select count(*)::int as n from ai.deployment_conversation c join ai.embedded_deployment d on d.id = c.deployment_id where d.code = $1",
      [code],
    );
    expect(stored.rows[0].n).toBeGreaterThan(0);

    expect(await deploymentConversationCount(code)).toBe(stored.rows[0].n);
    expect(await deploymentConversationCount("no-such-deployment")).toBe(0);

    signedInAs = memberId;
    await expect(deploymentConversationCount(code)).rejects.toBeInstanceOf(NotPermitted);
  });

  it("a Form step's fields are copied from the request type's published attributes", async () => {
    const { requestTypeFields, StorylineRejected } = await import("@/features/engage/service");
    const stored = await testPool().query<{
      key: string;
      label_en: string;
      label_ar: string;
      data_type: string;
      required: boolean;
      enum_values: { value: string; labelEn: string; labelAr: string }[] | null;
    }>(
      `select ad.key, ad.label_en, ad.label_ar, ad.data_type, ad.required, ad.enum_values from work.attribute_definition ad
       join work.request_type rt on rt.current_published_version_id = ad.request_type_version_id
       where rt.code = 'CRD' order by ad.sort_order`,
    );
    expect(stored.rows.length).toBeGreaterThan(0);

    expect(await requestTypeFields("CRD")).toEqual(
      stored.rows.map((row) => ({
        key: row.key,
        labelEn: row.label_en,
        labelAr: row.label_ar,
        dataType: row.data_type,
        required: row.required,
        // A List attribute's choices become the field's choices (D339).
        ...(row.enum_values?.length ? { choices: row.enum_values.map((one) => ({ value: one.value, en: one.labelEn, ar: one.labelAr })) } : {}),
      })),
    );
    await expect(requestTypeFields("NO-SUCH-TYPE")).rejects.toBeInstanceOf(StorylineRejected);
  });

  it("UC-64.1-04 a saved step and a changed mode land on the draft, never the published version", async () => {
    const { saveStorylineStep, setStorylineMode, StorylineRejected } = await import("@/features/engage/service");
    const { NotPermitted } = await import("@/lib/session");
    const step = {
      code: storylineCode,
      name: "ask_topic",
      type: "Ask" as const,
      messageEn: "What can we help with?",
      messageAr: "بماذا يمكننا المساعدة؟",
      sendVerbatim: false,
      slot: "topic",
      maxAttempts: 2,
      verifyMethod: null,
      handoffQueue: null,
      toolRefs: [],
      skillRefs: [],
      agentCode: null,
      nextStepName: "classify",
      onError: "Handoff" as const,
      config: {},
    };

    await saveStorylineStep(step);
    await setStorylineMode({ code: storylineCode, mode: "Guided" });

    const versions = await testPool().query<{ status: string; mode: string; message_en: string | null; max_attempts: number | null; next: string | null }>(
      `select sv.status, sv.mode, st.message_en, st.max_attempts, n.name as next from ai.storyline_version sv
       join ai.storyline sl on sl.id = sv.storyline_id
       join ai.storyline_step st on st.storyline_version_id = sv.id and st.name = 'ask_topic'
       left join ai.storyline_step n on n.id = st.next_step_id
       where sl.code = $1 order by sv.version_number`,
      [storylineCode],
    );
    expect(versions.rows).toEqual([
      { status: "Published", mode: "Strict", message_en: "What is it about?", max_attempts: null, next: "classify" },
      { status: "Draft", mode: "Guided", message_en: "What can we help with?", max_attempts: 2, next: "classify" },
    ]);

    await expect(saveStorylineStep({ ...step, code: "no-such-storyline" })).rejects.toBeInstanceOf(StorylineRejected);
    await expect(setStorylineMode({ code: "no-such-storyline", mode: "Strict" })).rejects.toBeInstanceOf(StorylineRejected);

    signedInAs = memberId;
    await expect(saveStorylineStep(step)).rejects.toBeInstanceOf(NotPermitted);
    await expect(setStorylineMode({ code: storylineCode, mode: "Strict" })).rejects.toBeInstanceOf(NotPermitted);
  });

  it("a deployment a channel binds to cannot be deleted; otherwise it goes with its storyline and conversations", async () => {
    const { configureChannel, deleteDeployment, DeploymentRejected } = await import("@/features/engage/service");
    const { NotPermitted } = await import("@/lib/session");
    const before = await testPool().query<{ binding_type: string | null; binding_id: string | null }>(
      "select binding_type, binding_id from ai.channel where type = 'WhatsApp'",
    );
    const bindTo = async (deploymentCode: string) =>
      configureChannel({
        type: "WhatsApp",
        rateLimitPerMinute: 30,
        unknownSenders: "ExternalContact",
        businessHours: "AlwaysOn",
        bindingType: "EmbeddedDeployment",
        bindingDeploymentCode: deploymentCode,
        offlineMessageEn: "We are closed.",
        offlineMessageAr: "نحن مغلقون.",
        endpointUrl: null,
      });

    await bindTo(code);
    await expect(deleteDeployment(code)).rejects.toBeInstanceOf(DeploymentRejected);
    await expect(deleteDeployment(code)).rejects.toThrow(/WhatsApp still binds to it/);
    await bindTo(seededDeployment);
    await testPool().query("update ai.channel set binding_type = $1, binding_id = $2 where type = 'WhatsApp'", [
      before.rows[0].binding_type,
      before.rows[0].binding_id,
    ]);

    signedInAs = memberId;
    await expect(deleteDeployment(code)).rejects.toBeInstanceOf(NotPermitted);
    signedInAs = adminId;

    await deleteDeployment(code);
    const left = await testPool().query<{ deployments: number; storylines: number; conversations: number }>(
      `select (select count(*)::int from ai.embedded_deployment where code = $1) as deployments,
              (select count(*)::int from ai.storyline where code = $2) as storylines,
              (select count(*)::int from ai.deployment_conversation where storyline_version_id = $3) as conversations`,
      [code, storylineCode, publishedVersionId],
    );
    expect(left.rows[0]).toEqual({ deployments: 0, storylines: 0, conversations: 0 });
  });
});
