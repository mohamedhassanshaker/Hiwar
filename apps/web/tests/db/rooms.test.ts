import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-22 the room list and S-23 one room, against the database.
 *
 * A room is the one place where several agents and several people act at once, so what is
 * checked here is what bounds it: who may post, who answers, and what a close leaves behind.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
/** The object store lives in the cluster; here it is a map, matching `tests/db/files.test.ts`. */
const stored = new Map<string, { bytes: Uint8Array; contentType: string }>();
vi.mock("@/lib/objects", () => ({
  buckets: { files: "files", artifacts: "artifacts", attachments: "attachments" },
  objectStoreConfigured: () => true,
  putObject: async (bucket: string, key: string, bytes: Uint8Array, contentType: string) => {
    stored.set(`${bucket}/${key}`, { bytes, contentType });
    return `${bucket}/${key}`;
  },
  deleteObject: async (reference: string) => {
    stored.delete(reference);
  },
  getObject: async (reference: string) => {
    const object = stored.get(reference);
    if (!object) return null;
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(object.bytes);
          controller.close();
        },
      }),
      contentType: object.contentType,
      size: object.bytes.byteLength,
    };
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("discussion rooms", () => {
  let ownerId = "";
  let otherId = "";
  let projectKey = "";
  let agentCode = "";
  const createdRooms: string[] = [];
  const createdItems: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const other = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'rooms:write' and rp.effect = 'Allow'
         and p.status = 'Active' and p.email <> 'mariam@tahseel.ae'
       order by ra.person_id limit 1`,
    );
    otherId = other.rows[0].id;
    const project = await testPool().query<{ key: string }>(
      "select key from work.project where status not in ('Paused', 'Archived') order by key limit 1",
    );
    projectKey = project.rows[0].key;
    const agent = await testPool().query<{ code: string }>(
      `select code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
       order by code limit 1`,
    );
    agentCode = agent.rows[0].code;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (createdItems.length > 0) {
      await testPool().query(
        "delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = any($1))",
        [createdItems],
      );
      await testPool().query("delete from work.work_item where key = any($1)", [createdItems]);
      createdItems.length = 0;
    }
    if (createdRooms.length > 0) {
      await testPool().query(
        `delete from work.context_handoff where owner_type = 'Room' and owner_id in (
           select id from work.discussion_room where key = any($1))`,
        [createdRooms],
      );
      await testPool().query(
        "delete from work.room_message where room_id in (select id from work.discussion_room where key = any($1))",
        [createdRooms],
      );
      await testPool().query(
        "delete from work.room_participant where room_id in (select id from work.discussion_room where key = any($1))",
        [createdRooms],
      );
      await testPool().query("update work.discussion_room set forked_from_room_id = null where key = any($1)", [createdRooms]);
      await testPool().query("delete from work.discussion_room where key = any($1)", [createdRooms]);
      createdRooms.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** A room of this test's own, so nothing here touches a seeded one. */
  const makeRoom = async (over: Record<string, unknown> = {}) => {
    const { createRoom } = await import("@/features/rooms/service");
    const key = await createRoom({
      projectKey,
      titleEn: "A room for the tests",
      titleAr: "اجتماع للاختبارات",
      type: "Chat",
      turnTaking: "MentionOnly",
      status: "Active",
      participants: [ownerId, otherId, agentCode],
      ...over,
    } as Parameters<typeof createRoom>[0]);
    createdRooms.push(key);
    return key;
  };

  it("UC-22.2-01 a room is created with its participants and opens active", async () => {
    signedInAs = ownerId;
    const key = await makeRoom();

    const { rows } = await testPool().query<{ status: string; turn: string; participants: string }>(
      `select r.status, r.turn_taking as turn,
              (select count(*)::text from work.room_participant p where p.room_id = r.id) as participants
       from work.discussion_room r where r.key = $1`,
      [key],
    );
    expect(rows[0].status).toBe("Active");
    expect(rows[0].turn).toBe("MentionOnly");
    expect(Number(rows[0].participants)).toBe(3);
  });

  it("UC-22.2-04 D289 a room with no agent is created under either policy, as a conversation between people", async () => {
    signedInAs = ownerId;
    const key = await makeRoom({ turnTaking: "Autonomous", participants: [ownerId, otherId] });
    const { rows } = await testPool().query<{ turn: string; agents: string }>(
      `select r.turn_taking as turn,
              (select count(*)::text from work.room_participant p where p.room_id = r.id and p.principal_type = 'Agent') as agents
       from work.discussion_room r where r.key = $1`,
      [key],
    );
    expect(rows[0]).toEqual({ turn: "Autonomous", agents: "0" });
  });

  it("UC-23.1-01 UC-23.1-02 a message is stored and the agent it names is brought in", async () => {
    const { loadRoom, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;

    const key = await makeRoom();
    const outcome = await postMessage({ roomKey: key, text: `@${agentCode} please draft the follow-up` });
    expect(outcome.started).toEqual([agentCode]);

    const detail = await loadRoom(key);
    expect(detail?.messages.map((message) => message.en)).toContain(`@${agentCode} please draft the follow-up`);

    // The run it started is the room's own, so the cap and the trace both find it.
    const { rows } = await testPool().query<{ count: string }>(
      `select count(*) from ai.run r join work.discussion_room d on d.id = r.context_id
       where d.key = $1 and r.context_type = 'Room'`,
      [key],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("an agent run started on a room carries its recent messages and an attachment's own content", async () => {
    const { postMessage } = await import("@/features/rooms/service");
    const { attachFile } = await import("@/features/files/service");
    signedInAs = ownerId;

    let runBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/documents/extract")) {
        return { ok: true, json: async () => ({ text: "Total: AED 240, approved by finance." }) } as Response;
      }
      runBody = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ run_id: "r-context" }), text: async () => "" } as Response;
    }) as typeof fetch;

    const key = await makeRoom();
    await postMessage({ roomKey: key, text: "We need to check this expense." });
    await attachFile({
      ownerType: "Room",
      ownerKey: key,
      name: "receipt.txt",
      dataUrl: `data:text/plain;base64,${Buffer.from("raw receipt bytes").toString("base64")}`,
    });
    await postMessage({ roomKey: key, text: `@${agentCode} what does the receipt say?` });

    const conversation = (runBody as unknown as { conversation: { role: string; author: string; text: string }[] }).conversation;
    expect(conversation.some((turn) => turn.text === "We need to check this expense.")).toBe(true);
    // The attachment's own content reached the run, not only its filename.
    expect(conversation.some((turn) => turn.text.includes("Total: AED 240"))).toBe(true);
    expect(conversation.some((turn) => turn.author === "attachment:receipt.txt")).toBe(true);
  });

  it("UC-23.1-07 the agent a run is still open for reads \"working\", and stops once it finishes", async () => {
    const { loadRoom, postMessage } = await import("@/features/rooms/service");
    const { finishRun } = await import("@/features/agents/run-service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;

    const key = await makeRoom();
    await postMessage({ roomKey: key, text: `@${agentCode} what is the status?` });

    // A fresh read of the room — not the tab that sent the message — sees the run in flight.
    const whileRunning = await loadRoom(key);
    expect(whileRunning?.participants.find((participant) => participant.id === agentCode)?.working).toBe(true);

    const { rows } = await testPool().query<{ id: string }>(
      `select r.id from ai.run r join work.discussion_room d on d.id = r.context_id
       where d.key = $1 and r.context_type = 'Room' order by r.started_at desc limit 1`,
      [key],
    );
    await finishRun({
      run_id: rows[0].id,
      status: "Succeeded",
      output: "Everything is on track.",
      tokens_in: 5,
      tokens_out: 5,
      tool_call_count: 0,
      estimated_cost_aed: "0",
      eval_scores: {},
      steps: [],
    });

    const afterFinishing = await loadRoom(key);
    expect(afterFinishing?.participants.find((participant) => participant.id === agentCode)?.working).toBe(false);
  });

  it("shows the lead agent's context window and the input tokens of its last reply", async () => {
    const { loadRoom, postMessage } = await import("@/features/rooms/service");
    const { finishRun } = await import("@/features/agents/run-service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;

    const key = await makeRoom();
    const before = await loadRoom(key);
    expect(before?.contextUsage).toMatchObject({ agent: agentCode, lastTokensIn: null });

    await postMessage({ roomKey: key, text: `@${agentCode} summarise the week` });
    const { rows } = await testPool().query<{ id: string }>(
      `select r.id from ai.run r join work.discussion_room d on d.id = r.context_id
       where d.key = $1 and r.context_type = 'Room' order by r.started_at desc limit 1`,
      [key],
    );
    await finishRun({
      run_id: rows[0].id,
      status: "Succeeded",
      output: "A quiet week.",
      tokens_in: 3900,
      tokens_out: 40,
      tool_call_count: 0,
      estimated_cost_aed: "0",
      eval_scores: {},
      steps: [],
    });

    // The window is the smallest any active step of the agent's route allows.
    const { rows: windows } = await testPool().query<{ window: number | null }>(
      `select min(m.context_window) as window
       from ai.agent a
       join ai.agent_version v on v.agent_id = a.id and v.is_active
       join ai.route_step rs on rs.route_id = v.primary_route_id
       join ai.model_provider p on p.id = rs.provider_id and p.is_active
       join ai.provider_connection c on c.id = rs.connection_id and c.is_active
       join ai.connection_allowed_model m on m.connection_id = rs.connection_id and m.model_name = rs.model_name
       where a.code = $1`,
      [agentCode],
    );
    const after = await loadRoom(key);
    expect(after?.contextUsage).toMatchObject({ agent: agentCode, window: windows[0]?.window ?? null, lastTokensIn: 3900 });
  });

  it("UC-23.1-10 a run that will not start is said in the room, with the agent named", async () => {
    const { loadRoom, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    const key = await makeRoom();
    const outcome = await postMessage({ roomKey: key, text: `@${agentCode} are you there?` });
    expect(outcome.started).toEqual([]);

    const detail = await loadRoom(key);
    expect(detail?.messages.some((message) => message.en.includes("could not complete"))).toBe(true);
  });

  it("UC-23.1-07 a run's reply is posted back into the room it answered", async () => {
    const { finishRun } = await import("@/features/agents/run-service");
    const { loadRoom } = await import("@/features/rooms/service");
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;

    const key = await makeRoom();
    const room = await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key]);
    const agent = await testPool().query<{ id: string; versionId: string }>(
      "select id, active_version_id as \"versionId\" from ai.agent where code = $1",
      [agentCode],
    );

    const runId = crypto.randomUUID();
    await repository.openRun({
      id: runId,
      agentId: agent.rows[0].id,
      agentVersionId: agent.rows[0].versionId,
      trigger: "Manual",
      contextType: "Room",
      contextId: room.rows[0].id,
      temporalWorkflowId: null,
      replayOfRunId: null,
      replayFromStep: null,
      grantedTools: [],
      personId: ownerId,
    });

    await finishRun({
      run_id: runId,
      status: "Succeeded",
      output: "Planned work for Tahseel G3 is tracked in three work items.",
      tokens_in: 20,
      tokens_out: 10,
      tool_call_count: 1,
      estimated_cost_aed: "0.02",
      eval_scores: {},
      steps: [],
    });

    const detail = await loadRoom(key);
    const reply = detail?.messages.find((message) => message.en.includes("Tahseel G3"));
    expect(reply).toBeTruthy();
    expect(reply?.sender).toBe(agentCode);
  });

  it("D352 a reply carries the tool calls its run made, in order, with their arguments and results", async () => {
    const { finishRun } = await import("@/features/agents/run-service");
    const { loadRoom } = await import("@/features/rooms/service");
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;

    const key = await makeRoom();
    const room = await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key]);
    const agent = await testPool().query<{ id: string; versionId: string }>(
      "select id, active_version_id as \"versionId\" from ai.agent where code = $1",
      [agentCode],
    );
    const runId = crypto.randomUUID();
    await repository.openRun({
      id: runId,
      agentId: agent.rows[0].id,
      agentVersionId: agent.rows[0].versionId,
      trigger: "Manual",
      contextType: "Room",
      contextId: room.rows[0].id,
      temporalWorkflowId: null,
      replayOfRunId: null,
      replayFromStep: null,
      grantedTools: [],
      personId: ownerId,
    });

    // The timeline `runtime_timeline.py` sends (D300): a cut result is no longer JSON.
    const at = new Date().toISOString();
    const step = (seq: number, type: string, name: string, status: string, result: string) => ({
      seq, type, name, status, result, hooks_applied: [], estimated_cost_aed: 0, started_at: at, ended_at: at,
    });
    const cut = `{"arguments": {"query": "APP"}, "result": "${"x".repeat(50)}…`;
    await finishRun({
      run_id: runId,
      status: "Succeeded",
      output: "APP last traded at 2.27.",
      tokens_in: 20,
      tokens_out: 10,
      tool_call_count: 4,
      estimated_cost_aed: "0",
      eval_scores: {},
      steps: [
        step(1, "Model", "model", "Done", "Let me read the market."),
        step(2, "Tool", "spx__quote_list", "Done", JSON.stringify({ arguments: { query: "SPX" }, result: [{ ticker: "APP", last: 2.27 }] })),
        step(3, "Tool", "work_item_create", "Refused", JSON.stringify({ arguments: { title: "Watch APP" }, result: "projectKey is required" })),
        step(4, "Tool", "ask_person", "Done", JSON.stringify({ arguments: { question: "Which?" }, result: "APP" })),
        step(5, "Tool", "spx__quote_get", "Unanswered", cut),
        step(6, "Handoff", "finish", "Succeeded", "APP last traded at 2.27."),
      ],
    });

    const detail = await loadRoom(key);
    const reply = detail?.messages.find((message) => message.en === "APP last traded at 2.27.");
    expect(reply?.steps.map(({ name, args, state, result }) => ({ name, args, state, result }))).toEqual([
      { name: "spx__quote_list", args: { query: "SPX" }, state: "done", result: JSON.stringify([{ ticker: "APP", last: 2.27 }], null, 2) },
      { name: "work_item_create", args: { title: "Watch APP" }, state: "failed", result: "projectKey is required" },
      { name: "spx__quote_get", args: {}, state: "failed", result: cut },
    ]);
    // A person's message carries none.
    expect(detail?.messages.filter((message) => message.sender !== agentCode).every((message) => message.steps.length === 0)).toBe(true);
  });

  it("D102 a room run that did not succeed is said by the room, not posted as the agent's answer", async () => {
    const { finishRun } = await import("@/features/agents/run-service");
    const { loadRoom } = await import("@/features/rooms/service");
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;

    const key = await makeRoom();
    const room = await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key]);
    const agent = await testPool().query<{ id: string; versionId: string }>(
      "select id, active_version_id as \"versionId\" from ai.agent where code = $1",
      [agentCode],
    );
    const runId = crypto.randomUUID();
    await repository.openRun({
      id: runId,
      agentId: agent.rows[0].id,
      agentVersionId: agent.rows[0].versionId,
      trigger: "Manual",
      contextType: "Room",
      contextId: room.rows[0].id,
      temporalWorkflowId: null,
      replayOfRunId: null,
      replayFromStep: null,
      grantedTools: [],
      personId: ownerId,
    });

    await finishRun({
      run_id: runId,
      status: "Failed",
      output: "The mission ended without an answer.",
      tokens_in: 0,
      tokens_out: 0,
      tool_call_count: 0,
      estimated_cost_aed: "0",
      eval_scores: {},
      steps: [],
    });

    const messages = (await loadRoom(key))?.messages ?? [];
    expect(messages.some((message) => message.sender === agentCode)).toBe(false);
    expect(messages.map((message) => message.en)).toContain(`${agentCode} failed: The mission ended without an answer.`);
  });

  it("UC-23.1-07 an artifact the run linked to the room is named on the reply that follows", async () => {
    const { finishRun } = await import("@/features/agents/run-service");
    const { createArtifact } = await import("@/features/files/service");
    const { loadRoom } = await import("@/features/rooms/service");
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;

    const key = await makeRoom();
    const room = await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key]);
    const agent = await testPool().query<{ id: string; versionId: string }>(
      "select id, active_version_id as \"versionId\" from ai.agent where code = $1",
      [agentCode],
    );

    const runId = crypto.randomUUID();
    await repository.openRun({
      id: runId,
      agentId: agent.rows[0].id,
      agentVersionId: agent.rows[0].versionId,
      trigger: "Manual",
      contextType: "Room",
      contextId: room.rows[0].id,
      temporalWorkflowId: null,
      replayOfRunId: null,
      replayFromStep: null,
      grantedTools: [],
      personId: ownerId,
    });

    // What `generate_document` + `artifact_create` leave behind while the run is going —
    // the model names the room itself, the same way the skill is written to.
    const titleEn = "Expense Policy Brief";
    await createArtifact({
      projectKey,
      titleEn,
      titleAr: titleEn,
      fileName: "expense-policy-brief.docx",
      dataUrl: "data:application/pdf;base64,dGhlIGJ5dGVz",
      linkedToType: "Room",
      linkedToKey: key,
    });

    await finishRun({
      run_id: runId,
      status: "Succeeded",
      output: "The brief is ready.",
      tokens_in: 20,
      tokens_out: 10,
      tool_call_count: 2,
      estimated_cost_aed: "0.05",
      eval_scores: {},
      steps: [],
    });

    const detail = await loadRoom(key);
    const reply = detail?.messages.find((message) => message.en.includes("The brief is ready."));
    expect(reply?.artifact?.name).toBe(titleEn);

    await testPool().query("delete from work.artifact_version where artifact_id in (select id from work.artifact where name_en = $1)", [titleEn]);
    await testPool().query("delete from work.artifact where name_en = $1", [titleEn]);
  });

  it("UC-23.1-07 a file uploaded to the room, and an artifact linked to it, both reach its board", async () => {
    const { attachFile, createArtifact } = await import("@/features/files/service");
    const { loadRoom } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();

    const fileName = "site-plan.md";
    await attachFile({
      ownerType: "Room",
      ownerKey: key,
      name: fileName,
      dataUrl: `data:text/markdown;base64,${Buffer.from("# plan").toString("base64")}`,
    });

    const titleEn = "Board Artifact";
    await createArtifact({
      projectKey,
      titleEn,
      titleAr: titleEn,
      fileName: "board-artifact.docx",
      dataUrl: "data:application/pdf;base64,dGhlIGJ5dGVz",
      linkedToType: "Room",
      linkedToKey: key,
    });

    const detail = await loadRoom(key);
    const upload = detail?.files.find((file) => file.name === fileName);
    expect(upload?.kind).toBe("attachment");
    const artifact = detail?.files.find((file) => file.name === titleEn);
    expect(artifact?.kind).toBe("artifact");

    await testPool().query("delete from work.attachment where file_name = $1", [fileName]);
    await testPool().query("delete from work.artifact_version where artifact_id in (select id from work.artifact where name_en = $1)", [titleEn]);
    await testPool().query("delete from work.artifact where name_en = $1", [titleEn]);
  });

  it("UC-23.1-11 an observer may not post, and the room says why", async () => {
    const { RoomRejected, loadRoom, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();

    await testPool().query(
      `update work.room_participant set room_role = 'Observer'
       where principal_id = $1 and room_id = (select id from work.discussion_room where key = $2)`,
      [otherId, key],
    );

    signedInAs = otherId;
    await expect(postMessage({ roomKey: key, text: "may I?" })).rejects.toBeInstanceOf(RoomRejected);
    // The screen is told why rather than being left with a dead composer.
    expect((await loadRoom(key))?.postRefusal?.en).toMatch(/Observers read/i);
  });

  it("UC-23.1-09 a room at its cost cap stops answering, and says so in the room", async () => {
    const { loadRoom, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();

    // A cap of zero is a room that has already spent everything it was allowed.
    await testPool().query("update work.discussion_room set cost_cap_aed = 0 where key = $1", [key]);

    const outcome = await postMessage({ roomKey: key, text: `@${agentCode} one more` });
    expect(outcome.started).toEqual([]);
    expect(outcome.note).toMatch(/cost cap/i);
    expect((await loadRoom(key))?.messages.some((message) => /cost cap/i.test(message.en))).toBe(true);
  });

  it("UC-23.1-05 a verdict on an agent message is stored and read back", async () => {
    const { loadRoom, recordFeedback } = await import("@/features/rooms/service");
    signedInAs = ownerId;

    const message = await testPool().query<{ id: string; key: string }>(
      `select m.id, d.key from work.room_message m
       join work.discussion_room d on d.id = m.room_id
       where m.sender_type = 'Agent' limit 1`,
    );
    if (message.rowCount === 0) return;

    await recordFeedback({ messageId: message.rows[0].id, value: "Helpful" });
    expect((await loadRoom(message.rows[0].key))?.feedback[message.rows[0].id]).toBe("Helpful");

    // The choice toggles: a second, different verdict replaces the first.
    await recordFeedback({ messageId: message.rows[0].id, value: "NotHelpful" });
    expect((await loadRoom(message.rows[0].key))?.feedback[message.rows[0].id]).toBe("NotHelpful");

    await testPool().query("delete from work.message_feedback where message_id = $1 and person_id = $2", [
      message.rows[0].id,
      ownerId,
    ]);
  });

  it("UC-23.3-04 a participant is added and removed, and loses access at once", async () => {
    const { loadRoom, setParticipant } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom({ participants: [ownerId, agentCode] });

    await setParticipant({ roomKey: key, principal: otherId, action: "Add" });
    expect((await loadRoom(key))?.participants.map((participant) => participant.id)).toContain(otherId);

    await setParticipant({ roomKey: key, principal: otherId, action: "Remove" });
    expect((await loadRoom(key))?.participants.map((participant) => participant.id)).not.toContain(otherId);
  });

  it("UC-23.1-07 an agent joining a room with no lead takes the lead, and the next agent takes it when the lead leaves", async () => {
    const { postMessage, setParticipant } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-lead" }), text: async () => "" }) as Response) as typeof fetch;
    const second = await testPool().query<{ code: string }>(
      `select code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired') and code <> $1
       order by code limit 1`,
      [agentCode],
    );
    const secondCode = second.rows[0].code;

    // Created without an agent, so every agent here joins later.
    const key = await makeRoom({ participants: [ownerId, otherId] });
    const roles = async () =>
      (
        await testPool().query<{ code: string; role: string }>(
          `select a.code, p.room_role as role from work.room_participant p
           join ai.agent a on a.id = p.principal_id
           join work.discussion_room d on d.id = p.room_id
           where d.key = $1 order by a.code`,
          [key],
        )
      ).rows.reduce<Record<string, string>>((all, row) => ({ ...all, [row.code]: row.role }), {});

    await setParticipant({ roomKey: key, principal: agentCode, action: "Add" });
    await setParticipant({ roomKey: key, principal: secondCode, action: "Add" });
    expect(await roles()).toEqual({ [agentCode]: "LeadAgent", [secondCode]: "MemberAgent" });

    // Adding the lead again does not demote it.
    await setParticipant({ roomKey: key, principal: agentCode, action: "Add" });
    expect((await roles())[agentCode]).toBe("LeadAgent");

    await setParticipant({ roomKey: key, principal: agentCode, action: "Remove" });
    expect(await roles()).toEqual({ [secondCode]: "LeadAgent" });

    // Switched to Autonomous afterwards, an unaddressed message reaches the one agent left.
    await testPool().query("update work.discussion_room set turn_taking = 'Autonomous' where key = $1", [key]);
    expect((await postMessage({ roomKey: key, text: "generate excel file with tahseel features" })).started).toEqual([secondCode]);
  });

  it("UC-22.2-01 D167 the person who creates a room owns it and is in it, whoever they picked", async () => {
    const { createRoom } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const project = (await testPool().query<{ key: string }>("select key from work.project order by key limit 1")).rows[0].key;
    const key = await createRoom({
      projectKey: project,
      titleEn: "Owned by its creator",
      titleAr: "يملكها منشئها",
      type: "Chat",
      turnTaking: "Autonomous",
      status: "Active",
      participants: [agentCode, otherId],
    });
    const { rows } = await testPool().query<{ principal_id: string; room_role: string }>(
      `select p.principal_id, p.room_role from work.room_participant p
       join work.discussion_room d on d.id = p.room_id where d.key = $1`,
      [key],
    );
    expect(rows).toContainEqual({ principal_id: ownerId, room_role: "Owner" });
    expect(rows.find((row) => row.principal_id === otherId)?.room_role).toBe("Member");
    expect(rows.filter((row) => row.room_role === "LeadAgent")).toHaveLength(1);
  });

  it("D345 a room may be created with nobody else picked: its creator is its one participant, as Owner", async () => {
    const { createRoomInput } = await import("@/features/rooms/schema");
    const { createRoom } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const project = (await testPool().query<{ key: string }>("select key from work.project order by key limit 1")).rows[0].key;
    const key = await createRoom(
      createRoomInput.parse({ projectKey: project, titleEn: "Just me", titleAr: "أنا فقط", type: "Chat", turnTaking: "MentionOnly", status: "Active", participants: [] }),
    );
    const { rows } = await testPool().query<{ principal_id: string; room_role: string }>(
      "select p.principal_id, p.room_role from work.room_participant p join work.discussion_room d on d.id = p.room_id where d.key = $1",
      [key],
    );
    expect(rows).toEqual([{ principal_id: ownerId, room_role: "Owner" }]);
  });

  it("D289 an Autonomous room gives an unaddressed message to the agent the classifier chooses, or to its lead", async () => {
    const { postMessage, setParticipant } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const second = (
      await testPool().query<{ code: string }>(
        `select code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired') and code <> $1
         order by code limit 1`,
        [agentCode],
      )
    ).rows[0].code;
    const key = await makeRoom({ turnTaking: "Autonomous" });
    await setParticipant({ roomKey: key, principal: second, action: "Add" });

    let classifier: { status: number; body: unknown } = { status: 200, body: { agent_code: second } };
    const asked: { agents: { code: string }[] }[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/classify/agent")) {
        asked.push(JSON.parse(String(init?.body)));
        return { ok: classifier.status === 200, status: classifier.status, json: async () => classifier.body } as Response;
      }
      return { ok: true, json: async () => ({ run_id: "r-chosen" }), text: async () => "" } as Response;
    }) as typeof fetch;

    // The room's agents are the only choices offered, and the chosen one answers.
    expect((await postMessage({ roomKey: key, text: "what does the guide say about expiry?" })).started).toEqual([second]);
    expect(asked[0].agents.map((agent) => agent.code).sort()).toEqual([agentCode, second].sort());

    // A choice outside the room, or no answer at all, leaves the message with the lead agent.
    classifier = { status: 200, body: { agent_code: "pa" } };
    expect((await postMessage({ roomKey: key, text: "and the other one?" })).started).toEqual([agentCode]);
    classifier = { status: 503, body: {} };
    expect((await postMessage({ roomKey: key, text: "still there?" })).started).toEqual([agentCode]);

    // A message to a person is addressed, so no agent answers and no choice is made.
    const before = asked.length;
    expect((await postMessage({ roomKey: key, text: `@${otherId} can you look?` })).started).toEqual([]);
    expect(asked).toHaveLength(before);
  });

  it("D145 an @-mention of an agent outside the room does not bring it in or start it", async () => {
    const { postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    let started = 0;
    globalThis.fetch = (async () => {
      started += 1;
      return { ok: true, json: async () => ({ run_id: "r-mention" }), text: async () => "" } as Response;
    }) as typeof fetch;

    const key = await makeRoom();
    await testPool().query(
      `delete from work.room_participant
       where room_id = (select id from work.discussion_room where key = $1) and principal_type = 'Agent'`,
      [key],
    );
    const outside = (
      await testPool().query<{ code: string }>(
        "select code from ai.agent where status not in ('Paused', 'Error', 'Retired') and code <> $1 order by code limit 1",
        [agentCode],
      )
    ).rows[0].code;

    const outcome = await postMessage({ roomKey: key, text: `@${outside} join us and draft it` });
    expect(outcome.started).toEqual([]);
    expect(started).toBe(0);
    // The room says why, and does not tell the person a mention would have added the agent.
    expect(outcome.note).toMatch(/no agent/i);
    expect(outcome.note).not.toMatch(/to add it/i);
    const agents = await testPool().query(
      `select 1 from work.room_participant
       where room_id = (select id from work.discussion_room where key = $1) and principal_type = 'Agent'`,
      [key],
    );
    expect(agents.rowCount).toBe(0);
  });

  it("D66 an agent acts only when a person addresses it, and the mission is that person's", async () => {
    const { postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-addressed" }), text: async () => "" }) as Response) as typeof fetch;

    const key = await makeRoom();

    // Nobody is named, so nothing runs: an agent in a room is not an agent on duty.
    expect((await postMessage({ roomKey: key, text: "morning all" })).started).toEqual([]);

    // Named, so it runs — and the mission belongs to the person who named it, which is
    // what every permission check, approval and cost line then points at.
    expect((await postMessage({ roomKey: key, text: `@${agentCode} please draft it` })).started).toEqual([agentCode]);
    const { rows } = await testPool().query<{ requester: string }>(
      `select r.created_by as requester from ai.run r
       join work.discussion_room d on d.id = r.context_id
       where d.key = $1 and r.context_type = 'Room'`,
      [key],
    );
    expect(rows.map((row) => row.requester)).toEqual([ownerId]);
  });

  it("D66 an agent's own post does not start another agent's mission", async () => {
    const { postAgentReply, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-noping" }), text: async () => "" }) as Response) as typeof fetch;

    // Autonomous is the widest policy there is: an agent answers a person without being
    // named. It still gives an agent's own message to nobody.
    const key = await makeRoom({ turnTaking: "Autonomous" });
    const room = await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key]);
    const agent = await testPool().query<{ id: string }>("select id from ai.agent where code = $1", [agentCode]);

    // One person's message, so there is exactly one mission in this room.
    await postMessage({ roomKey: key, text: `@${agentCode} please look at this` });
    const runs = async () =>
      Number(
        (
          await testPool().query<{ count: string }>(
            `select count(*) from ai.run r join work.discussion_room d on d.id = r.context_id
             where d.key = $1 and r.context_type = 'Room'`,
            [key],
          )
        ).rows[0].count,
      );
    expect(await runs()).toBe(1);

    const run = await testPool().query<{ id: string }>(
      `select r.id from ai.run r join work.discussion_room d on d.id = r.context_id
       where d.key = $1 and r.context_type = 'Room' order by r.started_at desc limit 1`,
      [key],
    );
    await postAgentReply({
      roomId: room.rows[0].id,
      agentId: agent.rows[0].id,
      agentCode,
      status: "Succeeded",
      text: `@${agentCode} what do you make of that?`,
      runId: run.rows[0].id,
      toolCalls: 0,
      estimatedCostAed: 0,
      actedBy: ownerId,
    });

    // The agent named an agent, in the widest policy the room has, and started nothing.
    expect(await runs()).toBe(1);

    // A person saying the same words does start one, so it is the sender that decided it.
    expect((await postMessage({ roomKey: key, text: `@${agentCode} what do you make of that?` })).started).toEqual([agentCode]);
    expect(await runs()).toBe(2);
  });

  it("D66 D73 one human message buys a bounded number of agent messages", async () => {
    const { loadRoom, postAgentReply, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-limit" }), text: async () => "" }) as Response) as typeof fetch;

    const key = await makeRoom();
    await postMessage({ roomKey: key, text: `@${agentCode} please answer` });
    // One agent message per human message, so the second reply is the one turned away.
    await testPool().query("update work.discussion_room set agent_hop_limit = 1 where key = $1", [key]);

    const room = await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key]);
    const agent = await testPool().query<{ id: string }>("select id from ai.agent where code = $1", [agentCode]);
    const run = await testPool().query<{ id: string }>(
      `select r.id from ai.run r join work.discussion_room d on d.id = r.context_id
       where d.key = $1 and r.context_type = 'Room' order by r.started_at desc limit 1`,
      [key],
    );
    const reply = (text: string) =>
      postAgentReply({
        roomId: room.rows[0].id,
        agentId: agent.rows[0].id,
        agentCode,
        status: "Succeeded",
        text,
        runId: run.rows[0].id,
        toolCalls: 0,
        estimatedCostAed: 0,
        actedBy: ownerId,
      });

    await reply("the first answer");
    await reply("the second answer");
    await reply("the third answer");

    const messages = (await loadRoom(key))?.messages ?? [];
    expect(messages.filter((message) => /^the \w+ answer$/.test(message.en)).map((message) => message.en)).toEqual(["the first answer"]);
    // Said once, on the message that reached the limit, rather than on every one after it.
    expect(messages.filter((message) => /hop limit/i.test(message.en))).toHaveLength(1);
  });

  it("D19 a room approval is decided by the requester, and other members see it awaiting", async () => {
    const { loadRoom, postMessage } = await import("@/features/rooms/service");
    const { requestApproval } = await import("@/features/agents/run-service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-approval" }), text: async () => "" }) as Response) as typeof fetch;

    const key = await makeRoom();
    await postMessage({ roomKey: key, text: `@${agentCode} please publish it` });
    const run = await testPool().query<{ id: string }>(
      `select r.id from ai.run r join work.discussion_room d on d.id = r.context_id
       where d.key = $1 and r.context_type = 'Room' order by r.started_at desc limit 1`,
      [key],
    );

    const approval = await requestApproval({
      run_id: run.rows[0].id,
      tool_name: "request_type_publish",
      call_id: "call-1",
      arguments: { key: "RT-1" },
      tier: "T2",
      reason: "Publishing a request type.",
      context_type: "Room",
      context_id: key,
    });

    try {
      // Another member of the room holding an open item for it — which is what the
      // platform's separation-of-duties routing produces today — still may not decide it
      // here: the approval belongs to the person whose mission it is.
      await testPool().query(
        `insert into ai.inbox_item (person_id, kind, source_type, source_id, status)
         values ($1, 'Approval', 'Approval', $2, 'Open')
         on conflict (person_id, kind, source_type, source_id) do update set status = 'Open'`,
        [otherId, approval.id],
      );

      signedInAs = otherId;
      const theirs = (await loadRoom(key))?.messages.find((message) => message.approval !== null)?.approval;
      expect(theirs?.key).toBe(approval.key);
      expect(theirs?.mayDecide).toBe(false);
      expect(theirs?.requester).toBeTruthy();

      signedInAs = ownerId;
      const mine = (await loadRoom(key))?.messages.find((message) => message.approval !== null)?.approval;
      const requesterName = await testPool().query<{ name_en: string }>("select name_en from core.person where id = $1", [ownerId]);
      expect(mine?.requester).toBe(requesterName.rows[0].name_en);
    } finally {
      await testPool().query("delete from ai.inbox_item where source_type = 'Approval' and source_id = $1", [approval.id]);
      await testPool().query("delete from ai.approval where id = $1", [approval.id]);
    }
  });

  it("D253 a room call that changes an agent's configuration goes to approvers other than the requester", async () => {
    const { loadRoom, postMessage } = await import("@/features/rooms/service");
    const { TOOLS_BY_NAME } = await import("@/mcp/tools");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-authorisation" }), text: async () => "" }) as Response) as typeof fetch;

    const key = await makeRoom();
    await postMessage({ roomKey: key, text: `@${agentCode} give yourself the email tool` });
    const run = await testPool().query<{ id: string }>(
      `select r.id from ai.run r join work.discussion_room d on d.id = r.context_id
       where d.key = $1 and r.context_type = 'Room' order by r.started_at desc limit 1`,
      [key],
    );

    // Through the catalogue's own `approval_create`, which reads the tool's marking.
    const approval = (await TOOLS_BY_NAME.get("approval_create")!.run({
      run_id: run.rows[0].id,
      tool_name: "agent_tool_grant_edit",
      call_id: "call-grant",
      arguments: { code: agentCode, grantPlatform: ["email_create"] },
      tier: "T2",
      reason: "Granting a tool.",
      context_type: "Room",
      context_id: key,
    } as never)) as { id: string; key: string };

    try {
      const holders = await testPool().query<{ person_id: string }>(
        "select person_id from ai.inbox_item where source_type = 'Approval' and source_id = $1",
        [approval.id],
      );
      expect(holders.rows.length).toBeGreaterThan(0);
      expect(holders.rows.map((row) => row.person_id)).not.toContain(ownerId);

      const mine = (await loadRoom(key))?.messages.find((message) => message.approval?.key === approval.key)?.approval;
      expect(mine?.mayDecide).toBe(false);
      expect(mine?.approvers).toBeTruthy();
      const requesterName = await testPool().query<{ name_en: string }>("select name_en from core.person where id = $1", [ownerId]);
      expect(mine?.approvers).not.toContain(requesterName.rows[0].name_en);
    } finally {
      await testPool().query("delete from ai.inbox_item where source_type = 'Approval' and source_id = $1", [approval.id]);
      await testPool().query("delete from ai.approval where id = $1", [approval.id]);
    }
  });

  it("spec 11(a) a read from inside a room is bounded by its least-privileged member", async () => {
    const { floorAllows, readFloorForRoom } = await import("@/features/rooms/read-floor");
    const { setParticipant } = await import("@/features/rooms/service");
    signedInAs = ownerId;

    // A read permission the room's owner holds organisation-wide and some other active
    // person does not hold at all, so the two really do differ.
    const mixed = await testPool().query<{ person: string; code: string }>(
      `select pr.id as person, m.code
       from core.person pr
       cross join lateral (
         select c.code from (
           select distinct p.code from core.role_assignment ra
           join core.role_permission rp on rp.role_id = ra.role_id
           join core.permission p on p.id = rp.permission_id
           where ra.person_id = $1 and rp.effect = 'Allow' and ra.scope_type = 'Organisation'
             and p.code like '%:read'
         ) c
         where not exists (
           select 1 from core.role_assignment ra2
           join core.role_permission rp2 on rp2.role_id = ra2.role_id
           join core.permission p2 on p2.id = rp2.permission_id
           where ra2.person_id = pr.id and rp2.effect = 'Allow' and p2.code = c.code
         )
         order by c.code limit 1
       ) m
       where pr.status = 'Active' and pr.id <> $1
       order by pr.id limit 1`,
      [ownerId],
    );
    expect(mixed.rowCount).toBe(1);
    const narrowId = mixed.rows[0].person;
    const code = mixed.rows[0].code as Parameters<typeof floorAllows>[1];

    const key = await makeRoom({ participants: [ownerId, agentCode] });
    const room = await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key]);

    // With only the requester in it, the floor is the requester, and it allows what they do.
    const alone = await readFloorForRoom(room.rows[0].id);
    expect(alone.map((principal) => principal.personId)).toEqual([ownerId]);
    expect(floorAllows(alone, code)).toBe(true);

    // Add somebody who may not see it, and the same read is refused — the agent posts to
    // everyone in the room, so it may only read what everyone in the room could read.
    await setParticipant({ roomKey: key, principal: narrowId, action: "Add" });

    const mixedFloor = await readFloorForRoom(room.rows[0].id);
    expect(new Set(mixedFloor.map((principal) => principal.personId))).toEqual(new Set([ownerId, narrowId]));
    expect(floorAllows(mixedFloor, code)).toBe(false);

    // The agent in the room is not part of the floor: a floor of agents would bound a read
    // by another agent's grant rather than by what a person in the room may see.
    expect(mixedFloor).toHaveLength(2);
  });

  it("decision (g) any agent may be removed from a room, the built-in Assistant included", async () => {
    const { loadRoom, setParticipant } = await import("@/features/rooms/service");
    const { BUILTIN_AGENT_CODE } = await import("@/features/agents/builtin");
    signedInAs = ownerId;
    const key = await makeRoom({ participants: [ownerId, agentCode] });

    await setParticipant({ roomKey: key, principal: BUILTIN_AGENT_CODE, action: "Add" });
    expect((await loadRoom(key))?.participants.map((participant) => participant.id)).toContain(BUILTIN_AGENT_CODE);

    // D65 keeps it on the platform; it says nothing about this room.
    await setParticipant({ roomKey: key, principal: BUILTIN_AGENT_CODE, action: "Remove" });
    expect((await loadRoom(key))?.participants.map((participant) => participant.id)).not.toContain(BUILTIN_AGENT_CODE);
    const { rows } = await testPool().query<{ count: string }>(
      "select count(*) from ai.agent where code = $1 and is_builtin = true",
      [BUILTIN_AGENT_CODE],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("UC-23.3-06 closing a room writes its final handoff and stops it taking messages", async () => {
    const { RoomRejected, closeRoom, loadRoom, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();
    await postMessage({ roomKey: key, text: "we agreed to ship on Friday" });

    await closeRoom({ roomKey: key, goal: "Ship on Friday", decisions: "", openQuestions: "", nextStep: "" });

    const { rows } = await testPool().query<{ status: string; goal: string | null }>(
      `select r.status, h.goal from work.discussion_room r
       left join work.context_handoff h on h.owner_type = 'Room' and h.owner_id = r.id
       where r.key = $1`,
      [key],
    );
    expect(rows[0].status).toBe("Closed");
    expect(rows[0].goal).toBe("Ship on Friday");

    // A message after the close would not be in the handoff, so it is refused.
    await expect(postMessage({ roomKey: key, text: "one more thing" })).rejects.toBeInstanceOf(RoomRejected);
    // In both languages, so the Arabic composer does not say it in English.
    expect((await loadRoom(key))?.postRefusal).toEqual({ en: "This room is closed.", ar: "هذه الغرفة مغلقة." });
  });

  it("UC-23.3-05 a fork is a new room linked to the one it came from", async () => {
    const { forkRoom, loadRoom, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();
    await postMessage({ roomKey: key, text: "the original decision" });

    const forked = await forkRoom({
      roomKey: key,
      titleEn: "A fork for the tests",
      titleAr: "تفرّع للاختبارات",
      whatShouldChange: "Try the other vendor",
    });
    createdRooms.push(forked);

    const { rows } = await testPool().query<{ linked: boolean }>(
      `select (f.forked_from_room_id = o.id) as linked
       from work.discussion_room f, work.discussion_room o where f.key = $1 and o.key = $2`,
      [forked, key],
    );
    expect(rows[0].linked).toBe(true);

    // What was carried over is the first message of the new room, so nobody has to go and
    // find the room it came from.
    const detail = await loadRoom(forked);
    expect(detail?.messages[0]?.en).toContain("the original decision");
    expect(detail?.participants.length).toBe(3);
  });

  it("UC-23.4-03 D176 a work item raised from a message has the room as its origin and is listed among its linked items", async () => {
    const { createWorkItemFromMessage, loadRoom, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();
    await postMessage({ roomKey: key, text: "somebody should check the vendor list" });

    const detail = await loadRoom(key);
    const message = detail?.messages[0];
    expect(message).toBeDefined();
    if (!message) return;

    const itemKey = await createWorkItemFromMessage({
      roomKey: key,
      messageId: message.id,
      titleEn: "Check the vendor list",
      titleAr: "مراجعة قائمة الموردين",
    });
    createdItems.push(itemKey);

    const { rows } = await testPool().query<{ linked: string | null }>(
      "select content_json->>'workItemKey' as linked from work.room_message where id = $1",
      [message.id],
    );
    expect(rows[0].linked).toBe(itemKey);

    expect((await loadRoom(key))?.linkedWorkItems.map((item) => item.key)).toContain(itemKey);
    const origin = await testPool().query<{ origin: string; room: string }>(
      `select w.origin_type as origin, d.key as room from work.work_item w
       join work.discussion_room d on d.id = w.origin_id where w.key = $1`,
      [itemKey],
    );
    expect(origin.rows[0]).toEqual({ origin: "Room", room: key });
  });

  it("UC-22.1-01 UC-22.1-05 the list carries its counters and only the rooms a person reaches", async () => {
    const { loadRooms } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();

    const { rooms, counts } = await loadRooms({ text: key });
    expect(counts.total).toBeGreaterThan(0);
    expect(counts.messages).toBeGreaterThanOrEqual(0);
    expect(rooms.map((room) => room.key)).toContain(key);

    // Somebody with no project grants sees only the rooms they are in.
    const limited = await testPool().query<{ id: string }>(
      `select p.id from core.person p
       where p.status = 'Active'
         and not exists (
           select 1 from core.role_assignment ra join core.role r on r.id = ra.role_id
           where ra.person_id = p.id and r.code in ('PlatformOwner', 'Administrator', 'Auditor')
         )
       order by p.email limit 1`,
    );
    if (limited.rowCount === 0) return;
    signedInAs = limited.rows[0].id;
    const theirs = await loadRooms();
    expect(theirs.counts.total).toBeLessThanOrEqual(counts.total);
  });

  it("D349 the room list pages and filters on the server", async () => {
    const { loadRooms } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    // A title only these rooms carry, so rooms other tests make at the same time stay out.
    const mark = `paging ${Date.now()}`;
    const made = [await makeRoom({ titleEn: mark }), await makeRoom({ titleEn: mark }), await makeRoom({ titleEn: mark })];

    const first = await loadRooms({ text: mark }, { limit: 2, offset: 0 });
    const next = await loadRooms({ text: mark }, { limit: 2, offset: 2 });
    expect(first.rooms).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(next.total).toBe(3);
    // Latest activity first, and the second page carries on from the first.
    expect(first.rooms.map((room) => room.key)).toEqual([made[2], made[1]]);
    expect(next.rooms[0].key).toBe(made[0]);

    // A filter narrows the rows and the total alike.
    const one = await loadRooms({ text: made[1] });
    expect(one.rooms.map((room) => room.key)).toEqual([made[1]]);
    expect(one.total).toBe(1);
    expect((await loadRooms({ status: "Closed", text: made[1] })).total).toBe(0);
  });

  it("UC-23.2-04 UC-23.2-05 an approval card is readable by everybody and decidable by its approvers", async () => {
    const { loadRoom } = await import("@/features/rooms/service");

    // A seeded room that carries an approval card.
    const carrying = await testPool().query<{ key: string }>(
      `select distinct d.key from work.room_message m
       join work.discussion_room d on d.id = m.room_id
       where m.content_json ? 'approval' limit 1`,
    );
    if (carrying.rowCount === 0) return;
    const key = carrying.rows[0].key;

    signedInAs = ownerId;
    const asOwner = await loadRoom(key);
    const card = asOwner?.messages.find((message) => message.approval !== null)?.approval;
    expect(card).toBeDefined();

    // `UC-23.2-04`: a participant with no open inbox item for it reads the card and is
    // offered nothing to press.
    const reader = await testPool().query<{ id: string }>(
      `select p.principal_id as id from work.room_participant p
       join work.discussion_room d on d.id = p.room_id
       where d.key = $1 and p.principal_type = 'Person'
         and not exists (
           select 1 from ai.inbox_item i
           join ai.approval a on a.id = i.source_id
           where i.person_id = p.principal_id and i.status = 'Open' and a.key = $2
         )
       limit 1`,
      [key, card?.key ?? ""],
    );
    if (reader.rowCount === 0) return;
    signedInAs = reader.rows[0].id;
    const asOther = await loadRoom(key);
    const theirs = asOther?.messages.find((message) => message.approval !== null)?.approval;
    expect(theirs).toBeDefined();
    expect(theirs?.mayDecide).toBe(false);

    // `UC-23.2-05`: the card is decided through the same inbox item the Inbox decides, so
    // the two cannot disagree about what happened.
    if (card?.inboxItemId) {
      const { rows } = await testPool().query<{ status: string }>(
        "select status from ai.inbox_item where id = $1",
        [card.inboxItemId],
      );
      expect(rows[0].status).toBe("Open");
    }
  });

  it("UC-23.4-01 D236 a room run's handoff is kept on the room when the run ends, and the room screen does not carry it", async () => {
    const { finishRun } = await import("@/features/agents/run-service");
    const { loadRoom } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();
    const room = (await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key])).rows[0];
    const agent = (
      await testPool().query<{ id: string; versionId: string }>(
        `select id, active_version_id as "versionId" from ai.agent where active_version_id is not null order by code limit 1`,
      )
    ).rows[0];
    const runId = crypto.randomUUID();
    await testPool().query(
      `insert into ai.run (id, key, agent_id, agent_version_id, trigger, context_type, context_id, status, started_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'Manual', 'Room', $5, 'Running', now(), $6, $6)`,
      [runId, `RUN-ROOM-${runId.slice(0, 8)}-T`, agent.id, agent.versionId, room.id, ownerId],
    );

    await finishRun({
      run_id: runId,
      status: "Succeeded",
      output: "Two vendors are shortlisted.",
      handoff: { goal: "Pick a vendor", decisions: ["Shortlisted two"], open_questions: [], next_step: "Compare the two quotes" },
      tokens_in: 0,
      tokens_out: 0,
      tool_call_count: 0,
      estimated_cost_aed: 0,
      eval_scores: {},
      steps: [],
    });

    const handoff = await testPool().query<{ goal: string; next_step: string }>(
      "select goal, next_step from work.context_handoff where owner_type = 'Room' and owner_id = $1",
      [room.id],
    );
    expect(handoff.rows[0]).toEqual({ goal: "Pick a vendor", next_step: "Compare the two quotes" });
    expect(await loadRoom(key)).not.toHaveProperty("handoff");
  });

  it("UC-23.1-06 a mention of a person reaches their Inbox", async () => {
    const { postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();

    await postMessage({ roomKey: key, text: `@${otherId} can you look at this?` });

    const { rows } = await testPool().query<{ count: string }>(
      `select count(*) from ai.inbox_item i
       join work.room_message m on m.id = i.source_id
       join work.discussion_room d on d.id = m.room_id
       where d.key = $1 and i.kind = 'Mention' and i.person_id = $2`,
      [key, otherId],
    );
    expect(Number(rows[0].count)).toBe(1);

    // D176: the mentioned person's Inbox names the room and opens it.
    const { loadInbox } = await import("@/features/inbox/service");
    signedInAs = otherId;
    const mention = (await loadInbox({ filter: "mention" }, { limit: 500, offset: 0 })).items.find((item) => item.roomKey === key);
    expect(mention?.t).toBe(`Mentioned you in ${key}`);
    signedInAs = ownerId;

    await testPool().query(
      `delete from ai.inbox_item where kind = 'Mention' and source_id in (
         select m.id from work.room_message m
         join work.discussion_room d on d.id = m.room_id where d.key = $1)`,
      [key],
    );
  });

  it("UC-23.2-01 UC-23.2-02 UC-23.2-03 a decision taken on the room's card is the platform's own decision", async () => {
    const { decideApproval } = await import("@/features/inbox/service");
    const { loadRoom } = await import("@/features/rooms/service");

    const carrying = await testPool().query<{ key: string; approval: string }>(
      `select d.key, m.content_json->>'approval' as approval
       from work.room_message m join work.discussion_room d on d.id = m.room_id
       where m.content_json ? 'approval' limit 1`,
    );
    if (carrying.rowCount === 0) return;
    const { key, approval } = carrying.rows[0];

    // D19: the card offers the decision to the person whose mission it is, and to nobody
    // else in the room. The platform still routes the inbox item away from them (conflict
    // C-1 in the register), so the row the decision is written against is made here.
    const requester = await testPool().query<{ person: string | null; approvalId: string; before: string }>(
      `select coalesce(a.created_by, r.created_by) as person, a.id as "approvalId", a.status as before
       from ai.approval a left join ai.run r on r.id = a.run_id
       where a.key = $1`,
      [approval],
    );
    if (!requester.rows[0]?.person) return;
    const { person, approvalId, before } = requester.rows[0] as { person: string; approvalId: string; before: string };

    const existing = await testPool().query<{ id: string }>(
      "select id from ai.inbox_item where person_id = $1 and kind = 'Approval' and source_type = 'Approval' and source_id = $2",
      [person, approvalId],
    );
    const item = await testPool().query<{ id: string }>(
      `insert into ai.inbox_item (person_id, kind, source_type, source_id, status)
       values ($1, 'Approval', 'Approval', $2, 'Open')
       on conflict (person_id, kind, source_type, source_id)
       do update set status = 'Open', resolved_at = null
       returning id`,
      [person, approvalId],
    );

    signedInAs = person;
    const card = (await loadRoom(key))?.messages.find((message) => message.approval !== null)?.approval;
    expect(card?.mayDecide).toBe(true);

    // The run is not reachable from here, which is a resume that does not happen rather
    // than a decision that was not recorded.
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    await decideApproval({ inboxItemId: item.rows[0].id, decision: "Approved", reason: "Agreed." });

    const after = await testPool().query<{ status: string }>("select status from ai.approval where key = $1", [approval]);
    expect(after.rows[0].status).toBe("Approved");

    // The card follows the approval, so the room and the Inbox cannot disagree.
    const decided = (await loadRoom(key))?.messages.find((message) => message.approval !== null)?.approval;
    expect(decided?.status).toBe("Approved");
    expect(decided?.mayDecide).toBe(false);

    await testPool().query("update ai.approval set status = $1 where key = $2", [before, approval]);
    if (existing.rowCount === 0) {
      await testPool().query("delete from ai.inbox_item where id = $1", [item.rows[0].id]);
    } else {
      await testPool().query("update ai.inbox_item set status = 'Open', resolved_at = null where id = $1", [item.rows[0].id]);
    }
    await testPool().query(
      "delete from ai.approval_decision where approval_id = (select id from ai.approval where key = $1)",
      [approval],
    );
  });

  it("converting a work item into a room posts its own detail and links back to it", async () => {
    const { createWorkItem } = await import("@/features/work-items/service");
    const { createRoomFromWorkItem } = await import("@/features/rooms/service");
    const { loadRoom } = await import("@/features/rooms/service");
    signedInAs = ownerId;

    const workItemKey = await createWorkItem({
      projectKey,
      type: "Task",
      titleEn: "Fix the broken gate",
      titleAr: "إصلاح البوابة المعطلة",
      priority: "High",
      descriptionEn: "The west gate will not close.",
    });

    const roomKey = await createRoomFromWorkItem(workItemKey);
    const detail = await loadRoom(roomKey);
    const opening = detail?.messages[0];
    expect(opening?.en).toContain(workItemKey);
    expect(opening?.en).toContain("Fix the broken gate");
    expect(opening?.en).toContain("The west gate will not close.");
    expect(detail?.linkedWorkItems.map((item) => item.key)).toContain(workItemKey);

    await testPool().query("delete from work.room_work_item_link where work_item_id in (select id from work.work_item where key = $1)", [workItemKey]);
    await testPool().query("delete from work.room_message where room_id in (select id from work.discussion_room where key = $1)", [roomKey]);
    await testPool().query("delete from work.room_participant where room_id in (select id from work.discussion_room where key = $1)", [roomKey]);
    await testPool().query("delete from work.discussion_room where key = $1", [roomKey]);
    await testPool().query("delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = $1)", [workItemKey]);
    await testPool().query("delete from work.work_item where key = $1", [workItemKey]);
  });

  it("converting a request into a room posts its own detail on the board", async () => {
    const { createRoomFromRequest } = await import("@/features/rooms/service");
    const { loadRoom } = await import("@/features/rooms/service");
    signedInAs = ownerId;

    // A request of this test's own, built directly rather than through a published request
    // type — the room conversion only ever reads the request's own row and its type's name.
    const project = await testPool().query<{ id: string }>("select id from work.project where key = $1", [projectKey]);
    const type = await testPool().query<{ id: string }>(
      "insert into work.request_type (code, name_en, name_ar, category_en) values ($1, 'Room conversion test', 'اختبار التحويل', 'General') returning id",
      [`RCT-${Date.now()}`],
    );
    const version = await testPool().query<{ id: string }>(
      `insert into work.request_type_version (request_type_id, version_number, status, entry_modes, intake_channels)
       values ($1, 1, 'Published', '{TemplateForm}', '{Console}') returning id`,
      [type.rows[0].id],
    );
    const requestKey = `REQ-TEST-${Date.now()}`;
    await testPool().query(
      `insert into work.request (key, project_id, request_type_version_id, title_en, title_ar, description_en, requester_type, requester_id, status)
       values ($1, $2, $3, 'A broken elevator', 'مصعد معطل', 'Elevator 3 is stuck on floor 5.', 'Person', $4, 'Submitted')`,
      [requestKey, project.rows[0].id, version.rows[0].id, ownerId],
    );

    const roomKey = await createRoomFromRequest(requestKey);
    const detail = await loadRoom(roomKey);
    const opening = detail?.messages[0];
    expect(opening?.en).toContain(requestKey);
    expect(opening?.en).toContain("A broken elevator");
    expect(opening?.en).toContain("Elevator 3 is stuck on floor 5.");
    expect(opening?.en).toContain("Submitted");

    await testPool().query("delete from work.room_message where room_id in (select id from work.discussion_room where key = $1)", [roomKey]);
    await testPool().query("delete from work.room_participant where room_id in (select id from work.discussion_room where key = $1)", [roomKey]);
    await testPool().query("delete from work.discussion_room where key = $1", [roomKey]);
    await testPool().query("delete from work.request where key = $1", [requestKey]);
    await testPool().query("delete from work.request_type_version where id = $1", [version.rows[0].id]);
    await testPool().query("delete from work.request_type where id = $1", [type.rows[0].id]);
  });

  it("UC-23.3-03 a moderator changes the turn-taking policy against the version they read", async () => {
    const { setTurnTaking } = await import("@/features/rooms/service");
    const { StaleWriteError } = await import("@/lib/concurrency");
    signedInAs = ownerId;
    const key = await makeRoom();
    const read = async () =>
      (
        await testPool().query<{ turn_taking: string; version: number }>(
          "select turn_taking, version from work.discussion_room where key = $1",
          [key],
        )
      ).rows[0];
    const { version } = await read();

    await setTurnTaking({ roomKey: key, turnTaking: "Autonomous", version });
    expect((await read()).turn_taking).toBe("Autonomous");

    const entry = await testPool().query<{ action: string; object_label: string }>(
      "select action, object_label from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toEqual({ action: "rooms:moderate", object_label: key });

    // A stale version is refused rather than overwriting the change somebody else made.
    await expect(setTurnTaking({ roomKey: key, turnTaking: "MentionOnly", version: version - 1 })).rejects.toBeInstanceOf(
      StaleWriteError,
    );
    expect((await read()).turn_taking).toBe("Autonomous");
  });

  it("UC-23.3-03 somebody without rooms:moderate may not change the turn-taking policy", async () => {
    const { setTurnTaking } = await import("@/features/rooms/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    const key = await makeRoom();
    const room = await testPool().query<{ turn_taking: string; version: number }>(
      "select turn_taking, version from work.discussion_room where key = $1",
      [key],
    );
    const member = await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'");

    signedInAs = member.rows[0].id;
    await expect(
      setTurnTaking({ roomKey: key, turnTaking: "Autonomous", version: room.rows[0].version }),
    ).rejects.toBeInstanceOf(NotPermitted);

    const after = await testPool().query<{ turn_taking: string }>("select turn_taking from work.discussion_room where key = $1", [key]);
    expect(after.rows[0].turn_taking).toBe(room.rows[0].turn_taking);
  });

  it("D392 an admin of a room manages its participants and turn-taking without rooms:moderate; a plain member does not", async () => {
    const { loadRoom, RoomRejected, setParticipant, setRoomAdmin, setTurnTaking } = await import("@/features/rooms/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    const key = await makeRoom();
    const member = (await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'")).rows[0].id;
    await setParticipant({ roomKey: key, principal: member, action: "Add" });
    const roleOf = async (id: string) =>
      (
        await testPool().query<{ room_role: string }>(
          `select p.room_role from work.room_participant p join work.discussion_room r on r.id = p.room_id
           where r.key = $1 and p.principal_id = $2`,
          [key, id],
        )
      ).rows[0]?.room_role;
    const versionOf = async () =>
      (await testPool().query<{ version: number }>("select version from work.discussion_room where key = $1", [key])).rows[0].version;

    signedInAs = member;
    expect((await loadRoom(key))?.mayManage).toBe(false);
    await expect(setTurnTaking({ roomKey: key, turnTaking: "Autonomous", version: await versionOf() })).rejects.toBeInstanceOf(NotPermitted);
    await expect(setParticipant({ roomKey: key, principal: otherId, action: "Remove" })).rejects.toBeInstanceOf(NotPermitted);
    await expect(setRoomAdmin({ roomKey: key, principal: member, admin: true })).rejects.toBeInstanceOf(NotPermitted);

    signedInAs = ownerId;
    await setRoomAdmin({ roomKey: key, principal: member, admin: true });
    expect(await roleOf(member)).toBe("Admin");
    // Adding them again does not turn an admin back into a member.
    await setParticipant({ roomKey: key, principal: member, action: "Add" });
    expect(await roleOf(member)).toBe("Admin");
    // The Owner is always an admin: nothing to make, and nobody removes them.
    await expect(setRoomAdmin({ roomKey: key, principal: ownerId, admin: true })).rejects.toBeInstanceOf(RoomRejected);

    signedInAs = member;
    expect((await loadRoom(key))?.mayManage).toBe(true);
    await setTurnTaking({ roomKey: key, turnTaking: "Autonomous", version: await versionOf() });
    await setParticipant({ roomKey: key, principal: otherId, action: "Remove" });
    expect(await roleOf(otherId)).toBeUndefined();
    await expect(setParticipant({ roomKey: key, principal: ownerId, action: "Remove" })).rejects.toBeInstanceOf(RoomRejected);

    signedInAs = ownerId;
    await setRoomAdmin({ roomKey: key, principal: member, admin: false });
    expect(await roleOf(member)).toBe("Member");
    // Only an admin can be stripped of it.
    await expect(setRoomAdmin({ roomKey: key, principal: member, admin: false })).rejects.toBeInstanceOf(RoomRejected);
    signedInAs = member;
    await expect(setTurnTaking({ roomKey: key, turnTaking: "MentionOnly", version: await versionOf() })).rejects.toBeInstanceOf(NotPermitted);
  });

  it("a deleted room takes its messages and participants with it, and the deletion is audited", async () => {
    const { deleteRoom, postMessage } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();
    await postMessage({ roomKey: key, text: "about to go" });
    const room = await testPool().query<{ id: string }>("select id from work.discussion_room where key = $1", [key]);

    await deleteRoom(key);

    const left = await testPool().query<{ rooms: number; messages: number; participants: number }>(
      `select (select count(*)::int from work.discussion_room where id = $1) as rooms,
              (select count(*)::int from work.room_message where room_id = $1) as messages,
              (select count(*)::int from work.room_participant where room_id = $1) as participants`,
      [room.rows[0].id],
    );
    expect(left.rows[0]).toEqual({ rooms: 0, messages: 0, participants: 0 });

    const entry = await testPool().query<{ action: string; object_label: string }>(
      "select action, object_label from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toEqual({ action: "rooms:delete", object_label: key });
  });

  it("a room another room was forked from is not deleted, and the refusal says why", async () => {
    const { RoomRejected, deleteRoom, forkRoom } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await makeRoom();
    const forked = await forkRoom({
      roomKey: key,
      titleEn: "A fork that keeps its origin",
      titleAr: "تفرّع يبقي أصله",
      whatShouldChange: "Nothing",
    });
    createdRooms.push(forked);

    const refusal = deleteRoom(key);
    await expect(refusal).rejects.toBeInstanceOf(RoomRejected);
    await expect(refusal).rejects.toThrow("This room cannot be deleted: it still has 1 rooms forked from it.");

    const still = await testPool().query("select 1 from work.discussion_room where key = $1", [key]);
    expect(still.rowCount).toBe(1);
  });

  it("somebody without rooms:moderate may not delete a room", async () => {
    const { deleteRoom } = await import("@/features/rooms/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    const key = await makeRoom();
    const member = await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'");

    signedInAs = member.rows[0].id;
    await expect(deleteRoom(key)).rejects.toBeInstanceOf(NotPermitted);

    const still = await testPool().query("select 1 from work.discussion_room where key = $1", [key]);
    expect(still.rowCount).toBe(1);
  });
});
