import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-65: the embedded widget's API, `/embed/v1` (widget specification section 14, D231),
 * called as the App Router calls it.
 *
 * The routes are reached with no console session: a session token is all a visitor holds.
 * The accepted cases use a seeded deployment with no storyline, which is a free conversation
 * and so performs no effects beyond the conversation rows the suite removes.
 */

process.env.AUTH_SECRET ??= "a-widget-session-secret-for-the-tests";
process.env.APP_URL = "http://platform.test";

// The loader route reads the request time with `connection()`, which needs a request Next is serving.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => null,
}));

type Deployment = { id: string; code: string; allowed_origins: string[]; rate_limit_per_visitor: number };
type Session = {
  sessionId: string;
  sessionToken: string;
  identityLevel: string;
  config: { deployment: string };
  messages: { id: string; role: string; blocks: { type: string; text?: string }[] }[];
  state: { ended: boolean };
};
type Refusal = { error: { code: string; message: string; retryAfter: number | null } };

const KEY = "route-test";
const id = (sessionId: string) => ({ params: Promise.resolve({ id: sessionId }) });

function post(path: string, body: unknown, token?: string): Request {
  return new Request(`http://platform.test/embed/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe.skipIf(!hasDatabase)("the embedded widget API", () => {
  let deployment: Deployment;
  let host = "";
  let draftCode = "";

  const start = async (body: Record<string, unknown> = {}) => {
    const { POST } = await import("@/app/embed/v1/sessions/route");
    return POST(post("/sessions", { deployment: deployment.code, host, visitorKey: `${KEY}-${Math.random().toString(36).slice(2, 10)}`, ...body }));
  };

  beforeAll(async () => {
    // A deployment of the suite's own: enabled on the web, no storyline, so a free conversation.
    const created = await testPool().query<Deployment>(
      `insert into ai.embedded_deployment (code, name_en, name_ar, status, allowed_origins, rate_limit_per_visitor)
       values ('route-test-dep', 'Route test', 'اختبار المسار', 'Enabled', array['https://host.example.test'], 5)
       on conflict (code) do update set status = 'Enabled'
       returning id, code, allowed_origins, rate_limit_per_visitor`,
    );
    deployment = created.rows[0];
    await testPool().query(
      "insert into ai.deployment_surface (deployment_id, surface) values ($1, 'Widget') on conflict do nothing",
      [deployment.id],
    );
    host = deployment.allowed_origins[0];
    const draft = await testPool().query<{ code: string }>(
      `insert into ai.embedded_deployment (code, name_en, name_ar, status, allowed_origins)
       values ('route-test-draft', 'Route draft', 'مسودة', 'Draft', array['https://host.example.test'])
       on conflict (code) do update set status = 'Draft' returning code`,
    );
    draftCode = draft.rows[0].code;
  });

  afterAll(async () => {
    // Conversations, messages and events go with their deployment.
    await testPool().query("delete from ai.embedded_deployment where code in ('route-test-dep', 'route-test-draft')");
    await closeTestPool();
  });

  it("D231 a session starts from an allowed page, with a token, the greeting and the widget's settings", async () => {
    const answer = await start();
    expect(answer.status).toBe(201);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    const session = (await answer.json()) as Session;
    expect(session.sessionToken.split(".")).toHaveLength(3);
    expect(session.identityLevel).toBe("anonymous");
    expect(session.config.deployment).toBe(deployment.code);
    expect(session.state.ended).toBe(false);
  });

  it("D231 the same visitor key picks the earlier session back up", async () => {
    const visitorKey = `${KEY}-again-${Date.now().toString(36)}`;
    const first = (await (await start({ visitorKey })).json()) as Session;
    const second = (await (await start({ visitorKey })).json()) as Session;
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("UC-65.1-10 a page the deployment does not list is refused, and no conversation is opened", async () => {
    const before = await testPool().query<{ n: number }>("select count(*)::int as n from ai.deployment_conversation where deployment_id = $1", [deployment.id]);
    const answer = await start({ host: "https://not-allowed.example" });
    expect(answer.status).toBe(403);
    expect(((await answer.json()) as Refusal).error.code).toBe("ORIGIN_NOT_ALLOWED");
    const after = await testPool().query<{ n: number }>("select count(*)::int as n from ai.deployment_conversation where deployment_id = $1", [deployment.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("S-65 a deployment that is not enabled, or does not exist, is refused as disabled", async () => {
    for (const code of [draftCode, "no-such-deployment"]) {
      const answer = await start({ deployment: code });
      expect(answer.status).toBe(403);
      expect(((await answer.json()) as Refusal).error.code).toBe("DEPLOYMENT_DISABLED");
    }
  });

  it("S-65 a body that is not JSON is refused as a bad request", async () => {
    const { POST } = await import("@/app/embed/v1/sessions/route");
    const answer = await POST(post("/sessions", "{not json"));
    expect(answer.status).toBe(400);
    expect(((await answer.json()) as Refusal).error.code).toBe("BAD_REQUEST");
  });

  it("D231 a message needs the session's token, and a token works only for its own session", async () => {
    const { POST } = await import("@/app/embed/v1/sessions/[id]/messages/route");
    const session = (await (await start()).json()) as Session;
    const other = (await (await start()).json()) as Session;

    const unsigned = await POST(post(`/sessions/${session.sessionId}/messages`, { text: "hello" }), id(session.sessionId));
    expect(unsigned.status).toBe(401);
    expect(((await unsigned.json()) as Refusal).error.code).toBe("SESSION_EXPIRED");

    const crossed = await POST(post(`/sessions/${session.sessionId}/messages`, { text: "hello" }, other.sessionToken), id(session.sessionId));
    expect(crossed.status).toBe(403);

    const answered = await POST(post(`/sessions/${session.sessionId}/messages`, { text: "hello there" }, session.sessionToken), id(session.sessionId));
    expect(answered.status).toBe(200);
    const view = (await answered.json()) as Session;
    expect(view.messages.filter((message) => message.role === "user").map((message) => message.blocks[0]?.text)).toContain("hello there");
  });

  it("D231 a message sent twice with the same client id is taken once", async () => {
    const { POST } = await import("@/app/embed/v1/sessions/[id]/messages/route");
    const session = (await (await start()).json()) as Session;
    const send = () =>
      POST(post(`/sessions/${session.sessionId}/messages`, { text: "only once", clientMessageId: "c-1" }, session.sessionToken), id(session.sessionId));
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const stored = await testPool().query<{ n: number }>(
      "select count(*)::int as n from ai.conversation_message where conversation_id = $1 and role = 'Visitor' and text_en = 'only once'",
      [session.sessionId],
    );
    expect(stored.rows[0].n).toBe(1);
  });

  it("UC-65.1-12 a visitor over the per-visitor limit is refused with 429 and how long to wait", async () => {
    const { POST } = await import("@/app/embed/v1/sessions/[id]/messages/route");
    const session = (await (await start()).json()) as Session;
    let last: Response | null = null;
    for (let turn = 0; turn <= deployment.rate_limit_per_visitor; turn += 1) {
      last = await POST(post(`/sessions/${session.sessionId}/messages`, { text: `message ${turn}` }, session.sessionToken), id(session.sessionId));
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBe("60");
    expect(((await last!.json()) as Refusal).error.code).toBe("RATE_LIMITED");
  });

  it("D231 an action from a step the conversation has left is refused as stale", async () => {
    const { POST } = await import("@/app/embed/v1/sessions/[id]/actions/route");
    const session = (await (await start()).json()) as Session;
    const answer = await POST(post(`/sessions/${session.sessionId}/actions`, { type: "confirm", step: "some_old_step" }, session.sessionToken), id(session.sessionId));
    expect(answer.status).toBe(409);
    expect(((await answer.json()) as Refusal).error.code).toBe("STALE_ACTION");
  });

  it("D231 a quick action naming a storyline the deployment does not have is refused", async () => {
    const { POST } = await import("@/app/embed/v1/sessions/[id]/actions/route");
    const session = (await (await start()).json()) as Session;
    const answer = await POST(post(`/sessions/${session.sessionId}/actions`, { type: "start_scenario", scenario: "no_such_scenario" }, session.sessionToken), id(session.sessionId));
    expect(answer.status).toBe(404);
  });

  it("UC-65.1-14 the rating is 1 to 5, and a thumbs needs a message that exists", async () => {
    const { POST } = await import("@/app/embed/v1/sessions/[id]/feedback/route");
    const session = (await (await start()).json()) as Session;
    const rate = (body: unknown) => POST(post(`/sessions/${session.sessionId}/feedback`, body, session.sessionToken), id(session.sessionId));
    expect((await rate({ rating: 6 })).status).toBe(400);
    expect((await rate({ rating: 4 })).status).toBe(200);
    const stored = await testPool().query<{ rating: number }>("select rating from ai.deployment_conversation where id = $1", [session.sessionId]);
    expect(stored.rows[0].rating).toBe(4);
    expect((await rate({ messageId: "msg_9999", value: "up" })).status).toBe(404);
  });

  it("D231 ending the session closes the conversation", async () => {
    const { DELETE } = await import("@/app/embed/v1/sessions/[id]/route");
    const session = (await (await start()).json()) as Session;
    const answer = await DELETE(
      new Request(`http://platform.test/embed/v1/sessions/${session.sessionId}`, { method: "DELETE", headers: { authorization: `Bearer ${session.sessionToken}` } }),
      id(session.sessionId),
    );
    expect(answer.status).toBe(204);
    const stored = await testPool().query<{ outcome: string | null }>("select outcome from ai.deployment_conversation where id = $1", [session.sessionId]);
    expect(stored.rows[0].outcome).not.toBeNull();
  });

  it("UC-63.1-02 the loader is public, uncached and points at the platform", async () => {
    const { GET } = await import("@/app/embed/v1/widget.js/route");
    const answer = await GET();
    expect(answer.headers.get("content-type")).toContain("javascript");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
    const script = await answer.text();
    expect(script).toContain('"http://platform.test"');
    expect(script).toContain("/embed/v1/frame/");
    expect(script).toContain("AnyPlatformAssistant");
  });

  it("D273 the loader names a page opened as a file by the origin browsers send for it, null", async () => {
    const { GET } = await import("@/app/embed/v1/widget.js/route");
    const script = await (await GET()).text();
    /** Runs the loader on a page at `location` and returns the configuration URL it asks for. */
    const asked = (location: { protocol: string; origin: string }) => {
      const urls: string[] = [];
      const attributes: Record<string, string> = { "data-deployment": "shj3", "data-lang": "en" };
      const window: Record<string, unknown> = { addEventListener: () => undefined };
      runInNewContext(script, {
        window,
        location,
        navigator: { language: "en" },
        console,
        document: {
          currentScript: { getAttribute: (name: string) => attributes[name] ?? null },
          documentElement: { getAttribute: () => null },
          addEventListener: () => undefined,
        },
        fetch: (url: string) => {
          urls.push(url);
          return new Promise(() => undefined);
        },
      });
      return urls[0];
    };
    expect(asked({ protocol: "file:", origin: "file://" })).toBe("http://platform.test/embed/v1/config/shj3?host=null");
    expect(asked({ protocol: "https:", origin: "https://shop.example" })).toBe(
      `http://platform.test/embed/v1/config/shj3?host=${encodeURIComponent("https://shop.example")}`,
    );
  });

  it("D231 the launcher's settings are public for an enabled deployment and refused for any other", async () => {
    const { GET } = await import("@/app/embed/v1/config/[code]/route");
    const enabled = await GET(new Request("http://platform.test"), { params: Promise.resolve({ code: deployment.code }) });
    expect(enabled.status).toBe(200);
    expect(((await enabled.json()) as { deployment: string }).deployment).toBe(deployment.code);
    const draft = await GET(new Request("http://platform.test"), { params: Promise.resolve({ code: draftCode }) });
    expect(draft.status).toBe(403);
    // A page the deployment does not list gets no launcher at all.
    const elsewhere = await GET(new Request(`http://platform.test?host=${encodeURIComponent("https://not-allowed.example")}`), {
      params: Promise.resolve({ code: deployment.code }),
    });
    expect(elsewhere.status).toBe(403);
    expect(((await elsewhere.json()) as Refusal).error.code).toBe("ORIGIN_NOT_ALLOWED");
    const listed = await GET(new Request(`http://platform.test?host=${encodeURIComponent(host)}`), { params: Promise.resolve({ code: deployment.code }) });
    expect(listed.status).toBe(200);
  });
});
