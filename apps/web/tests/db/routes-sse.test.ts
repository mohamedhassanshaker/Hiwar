import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * The four live streams under `/api/sse`, called as the App Router calls them.
 *
 * Valkey is the external boundary and is answered here: a test decides whether live updates
 * are configured, hands a message to the subscription the route opened, and sees which
 * channel or run offset was asked for. The session, the room lookup and the stream framing
 * are the real ones.
 */

let signedInAs = "";
let live = true;

type Subscription = { channel: string; onMessage: (payload: string) => void; signal: AbortSignal };
const subscriptions: Subscription[] = [];
const runReads: { runId: string; after: string }[] = [];
let runEvents: { offset: string; payload: string }[] = [];
let readersOpened = 0;
let readersClosed = 0;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));
vi.mock(import("@/lib/valkey"), async (importOriginal) => ({
  ...(await importOriginal()),
  liveUpdatesConfigured: () => live,
  subscribe: (channel: string, onMessage: (payload: string) => void, signal: AbortSignal) => {
    subscriptions.push({ channel, onMessage, signal });
  },
  // The first read returns what the test queued; later reads wait briefly and find
  // nothing, as a blocking XREAD on a quiet stream does.
  runEventReader: () => {
    readersOpened += 1;
    return {
      read: async (runId: string, after: string) => {
        runReads.push({ runId, after });
        const queued = runEvents;
        runEvents = [];
        if (queued.length > 0) return queued;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [];
      },
      close: () => {
        readersClosed += 1;
      },
    };
  },
}));

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
};

/** Reads what is left of a stream after the client went away, proving it ends. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return rest;
    rest += decoder.decode(value);
  }
}

function liveRequest(url: string, init: RequestInit = {}): { request: Request; leave: () => void } {
  const controller = new AbortController();
  return { request: new Request(url, { ...init, signal: controller.signal }), leave: () => controller.abort() };
}

describe.skipIf(!hasDatabase)("the live streams under /api/sse", () => {
  let personId = "";
  let room = { key: "", id: "" };
  /** A seeded run, somebody who may read agent runs, and somebody who may not. */
  let runId = "";
  let readerId = "";
  let outsiderId = "";

  beforeAll(async () => {
    const person = await testPool().query<{ id: string }>(
      `select distinct p.id from core.person p
       join core.role_assignment ra on ra.person_id = p.id
       join core.role_permission rp on rp.role_id = ra.role_id
       join core.permission perm on perm.id = rp.permission_id
       where perm.code = 'rooms:read' and rp.effect = 'Allow' and ra.scope_type = 'Organisation' and p.status = 'Active'
       order by p.id limit 1`,
    );
    personId = person.rows[0].id;
    const seeded = await testPool().query<{ key: string; id: string }>(
      "select key, id from work.discussion_room where status = 'Active' order by key limit 1",
    );
    room = seeded.rows[0];
    const run = await testPool().query<{ id: string }>("select id from ai.run order by id limit 1");
    runId = run.rows[0].id;
    const reader = await testPool().query<{ id: string }>("select id from core.person where email = 'mariam@tahseel.ae'");
    readerId = reader.rows[0].id;
    const outsider = await testPool().query<{ id: string }>(
      `select p.id from core.person p
       where p.status = 'Active' and not exists (
         select 1 from core.role_assignment ra
         join core.role_permission rp on rp.role_id = ra.role_id and rp.effect = 'Allow'
         join core.permission perm on perm.id = rp.permission_id
         where ra.person_id = p.id and perm.code = 'agents:read')
       order by p.email limit 1`,
    );
    outsiderId = outsider.rows[0].id;
  });

  afterEach(() => {
    signedInAs = "";
    live = true;
    subscriptions.length = 0;
    runReads.length = 0;
    runEvents = [];
    readersOpened = 0;
    readersClosed = 0;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("UC-10.1-02 the dashboard stream forwards the dashboard channel and ends when the browser leaves", async () => {
    const { GET } = await import("@/app/api/sse/dashboard/route");
    signedInAs = personId;
    const { request, leave } = liveRequest("http://platform.test/api/sse/dashboard");

    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(Object.keys(SSE_HEADERS).map((name) => [name, response.headers.get(name)]))).toEqual(SSE_HEADERS);
    expect(subscriptions.map((one) => one.channel)).toEqual(["dash:all"]);

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    subscriptions[0].onMessage('{"reason":"a card changed"}');
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('data: {"reason":"a card changed"}\n\n');

    leave();
    expect(await drain(reader)).toBe("");
    expect(subscriptions[0].signal.aborted).toBe(true);
  });

  it("UC-10.1-02 the dashboard stream answers 501 when live updates are not configured", async () => {
    const { GET } = await import("@/app/api/sse/dashboard/route");
    signedInAs = personId;
    live = false;

    const response = await GET(new Request("http://platform.test/api/sse/dashboard"));
    expect(response.status).toBe(501);
    expect(await response.text()).toBe("Live updates are not configured.");
    expect(subscriptions).toHaveLength(0);
  });

  it("COM-09 the dashboard stream sends a person with no session to sign in", async () => {
    const { GET } = await import("@/app/api/sse/dashboard/route");
    await expect(GET(new Request("http://platform.test/api/sse/dashboard"))).rejects.toMatchObject({
      digest: expect.stringContaining("/sign-in?next="),
    });
    expect(subscriptions).toHaveLength(0);
  });

  it("UC-01.1-06 the inbox stream forwards the signed-in person's own channel", async () => {
    const { GET } = await import("@/app/api/sse/inbox/route");
    signedInAs = personId;
    const { request, leave } = liveRequest("http://platform.test/api/sse/inbox");

    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(SSE_HEADERS["content-type"]);
    expect(subscriptions.map((one) => one.channel)).toEqual([`inbox:${personId}`]);

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    subscriptions[0].onMessage('{"open":3}');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"open":3}\n\n');
    leave();
    await drain(reader);
  });

  it("UC-01.1-06 the inbox stream answers 501, with no-store, when live updates are not configured", async () => {
    const { GET } = await import("@/app/api/sse/inbox/route");
    signedInAs = personId;
    live = false;

    const response = await GET(new Request("http://platform.test/api/sse/inbox"));
    expect(response.status).toBe(501);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(subscriptions).toHaveLength(0);
  });

  it("UC-23.1-01 a room's stream forwards that room's channel", async () => {
    const { GET } = await import("@/app/api/sse/rooms/[roomKey]/route");
    signedInAs = personId;
    const { request, leave } = liveRequest(`http://platform.test/api/sse/rooms/${room.key}`);

    const response = await GET(request, { params: Promise.resolve({ roomKey: room.key }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(SSE_HEADERS["content-type"]);
    expect(subscriptions.map((one) => one.channel)).toEqual([`room:${room.id}`]);

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    subscriptions[0].onMessage('{"changed":true}');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"changed":true}\n\n');
    leave();
    await drain(reader);
  });

  it("UC-23.1-01 a room that does not exist is refused the stream with 404", async () => {
    const { GET } = await import("@/app/api/sse/rooms/[roomKey]/route");
    signedInAs = personId;

    const response = await GET(new Request("http://platform.test/api/sse/rooms/NO-SUCH"), {
      params: Promise.resolve({ roomKey: "NO-SUCH-ROOM" }),
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("No such room.");
    expect(subscriptions).toHaveLength(0);
  });

  it("UC-23.1-01 a room's stream answers 501 when live updates are not configured", async () => {
    const { GET } = await import("@/app/api/sse/rooms/[roomKey]/route");
    signedInAs = personId;
    live = false;

    const response = await GET(new Request(`http://platform.test/api/sse/rooms/${room.key}`), {
      params: Promise.resolve({ roomKey: room.key }),
    });
    expect(response.status).toBe(501);
    expect(subscriptions).toHaveLength(0);
  });

  it("UC-52.1-04 a run's stream replays from Last-Event-ID and frames each event with its offset", async () => {
    const { GET } = await import("@/app/api/sse/runs/[runId]/route");
    signedInAs = readerId;
    runEvents = [{ offset: "1700000000000-1", payload: '{"type":"TEXT_MESSAGE_CONTENT"}' }];
    const { request, leave } = liveRequest(`http://platform.test/api/sse/runs/${runId}?after=1-0`, {
      headers: { "last-event-id": "1700000000000-0" },
    });

    const response = await GET(request, { params: Promise.resolve({ runId }) });
    expect(response.status).toBe(200);
    expect(Object.fromEntries(Object.keys(SSE_HEADERS).map((name) => [name, response.headers.get(name)]))).toEqual(SSE_HEADERS);

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('id: 1700000000000-1\ndata: {"type":"TEXT_MESSAGE_CONTENT"}\n\n');
    // The header a reconnecting EventSource sends wins over the query string.
    expect(runReads[0]).toEqual({ runId, after: "1700000000000-0" });

    leave();
    await drain(reader);
    // After the first batch the stream follows on from the last offset it sent.
    expect(runReads.slice(1).every((read) => read.after === "1700000000000-1")).toBe(true);
    // D350: the stream read on a connection of its own, and let it go when the client left.
    expect([readersOpened, readersClosed]).toEqual([1, 1]);
  });

  it("UC-52.1-04 a run's stream starts from ?after, or from the beginning when given nothing", async () => {
    const { GET } = await import("@/app/api/sse/runs/[runId]/route");
    signedInAs = readerId;

    const fromQuery = liveRequest(`http://platform.test/api/sse/runs/${runId}?after=42-0`);
    const queried = await GET(fromQuery.request, { params: Promise.resolve({ runId }) });
    const queriedReader = (queried.body as ReadableStream<Uint8Array>).getReader();
    // A quiet run sends a keepalive comment rather than nothing.
    expect(new TextDecoder().decode((await queriedReader.read()).value)).toBe(": keepalive\n\n");
    fromQuery.leave();
    await drain(queriedReader);
    expect(runReads[0]).toEqual({ runId, after: "42-0" });

    runReads.length = 0;
    const fromStart = liveRequest(`http://platform.test/api/sse/runs/${runId}`);
    const started = await GET(fromStart.request, { params: Promise.resolve({ runId }) });
    const startedReader = (started.body as ReadableStream<Uint8Array>).getReader();
    await startedReader.read();
    fromStart.leave();
    await drain(startedReader);
    expect(runReads[0]).toEqual({ runId, after: "0-0" });
  });

  it("UC-52.1-04 a run's stream answers 501 when live updates are not configured", async () => {
    const { GET } = await import("@/app/api/sse/runs/[runId]/route");
    signedInAs = readerId;
    live = false;

    const response = await GET(new Request(`http://platform.test/api/sse/runs/${runId}`), { params: Promise.resolve({ runId }) });
    expect(response.status).toBe(501);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runReads).toHaveLength(0);
  });

  it("COM-09 a run's stream sends a person with no session to sign in", async () => {
    const { GET } = await import("@/app/api/sse/runs/[runId]/route");
    await expect(
      GET(new Request(`http://platform.test/api/sse/runs/${runId}`), { params: Promise.resolve({ runId }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in?next=") });
    expect(runReads).toHaveLength(0);
  });

  it("D124 the person who started a run follows it without agents:read", async () => {
    const { GET } = await import("@/app/api/sse/runs/[runId]/route");
    await testPool().query("update ai.run set created_by = $1 where id = $2", [outsiderId, runId]);
    try {
      signedInAs = outsiderId;
      const { request, leave } = liveRequest(`http://platform.test/api/sse/runs/${runId}`);
      const response = await GET(request, { params: Promise.resolve({ runId }) });
      expect(response.status).toBe(200);
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      leave();
      await drain(reader);
      expect(runReads[0]).toEqual({ runId, after: "0-0" });
    } finally {
      await testPool().query("update ai.run set created_by = null where id = $1", [runId]);
    }
  });

  it("D124 somebody who neither started a run nor may read agent runs is refused its events", async () => {
    const { GET } = await import("@/app/api/sse/runs/[runId]/route");
    signedInAs = outsiderId;
    const response = await GET(new Request(`http://platform.test/api/sse/runs/${runId}`), { params: Promise.resolve({ runId }) });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("You may not follow this run.");
    expect(runReads).toHaveLength(0);
    const denied = await testPool().query<{ action: string; outcome: string }>(
      "select action, outcome from audit.audit_entry where actor_id = $1 order by at desc, id desc limit 1",
      [outsiderId],
    );
    expect(denied.rows[0]).toEqual({ action: "agents:read", outcome: "Denied" });
  });

  it("D161 somebody who may read the room a run works in follows its reply as it is written", async () => {
    const { GET } = await import("@/app/api/sse/runs/[runId]/route");
    const before = (
      await testPool().query<{ context_type: string; context_id: string | null }>("select context_type, context_id from ai.run where id = $1", [runId])
    ).rows[0];
    await testPool().query("update ai.run set context_type = 'Room', context_id = $1 where id = $2", [room.id, runId]);
    const joined = await testPool().query(
      `insert into work.room_participant (room_id, principal_type, principal_id, room_role)
       values ($1, 'Person', $2, 'Member') on conflict do nothing`,
      [room.id, outsiderId],
    );
    try {
      signedInAs = outsiderId;
      const { request, leave } = liveRequest(`http://platform.test/api/sse/runs/${runId}`);
      const response = await GET(request, { params: Promise.resolve({ runId }) });
      expect(response.status).toBe(200);
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      leave();
      await drain(reader);
      expect(runReads[0]).toEqual({ runId, after: "0-0" });
    } finally {
      await testPool().query("update ai.run set context_type = $1, context_id = $2 where id = $3", [before.context_type, before.context_id, runId]);
      if (joined.rowCount) {
        await testPool().query("delete from work.room_participant where room_id = $1 and principal_id = $2", [room.id, outsiderId]);
      }
    }
  });

  it("D124 a run that does not exist, or an id that names no run, answers 404 without reading", async () => {
    const { GET } = await import("@/app/api/sse/runs/[runId]/route");
    signedInAs = readerId;
    for (const missing of [randomUUID(), "RUN-1042"]) {
      const response = await GET(new Request(`http://platform.test/api/sse/runs/${missing}`), {
        params: Promise.resolve({ runId: missing }),
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("No such run.");
    }
    expect(runReads).toHaveLength(0);
  });
});
