import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, restoreColumns, testPool } from "./harness";

/**
 * S-61: a channel's inbound webhook, called as the App Router calls it.
 *
 * The decision rules are covered in `tests/channel-inbound.test.ts` and the gateway in
 * `tests/db/engage.test.ts`; this is the route in front of them, which a provider reaches
 * with no session: whether a channel exists, and what is refused before anything is read.
 *
 * The seeded Teams channel is mirrored to rooms, and a message that names no conversation
 * is recorded without touching any room, which keeps the accepted case free of side
 * effects beyond the one `channel_message` row the test removes.
 */

process.env.APP_KEK ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => null,
}));

const CHANNEL = "MicrosoftTeams";
const SECRET = "a-route-test-inbound-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const params = (channelType: string) => ({ params: Promise.resolve({ channelType }) });

function post(body: string, signature: string | null): Request {
  return new Request(`http://platform.test/api/channels/${CHANNEL}/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-awp-signature": signature } : {}) },
    body,
  });
}

describe.skipIf(!hasDatabase)("the channel inbound webhook route", () => {
  let channel: { id: string; is_enabled: boolean; inbound_secret_ref: Buffer | null; version: number; updated_at: Date };
  const sender = `route-test-${Date.now().toString(36)}@example.test`;

  beforeAll(async () => {
    const { rows } = await testPool().query<typeof channel>(
      "select id, is_enabled, inbound_secret_ref, version, updated_at from ai.channel where type = $1",
      [CHANNEL],
    );
    channel = rows[0];
    const { encrypt } = await import("@/lib/crypto");
    await testPool().query("update ai.channel set inbound_secret_ref = $2 where id = $1", [channel.id, encrypt(SECRET)]);
  });

  afterAll(async () => {
    await testPool().query("delete from ai.channel_message where sender_key = $1", [sender]);
    await restoreColumns("ai.channel", channel.id, {
      inbound_secret_ref: channel.inbound_secret_ref,
      version: channel.version,
      updated_at: channel.updated_at,
    });
    await closeTestPool();
  });

  it("UC-61.1-03 GET says whether the channel exists and is enabled, and nothing else", async () => {
    const { GET } = await import("@/app/api/channels/[channelType]/inbound/route");
    const response = await GET(new Request(`http://platform.test/api/channels/${CHANNEL}/inbound`), params(CHANNEL));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ channel: CHANNEL, enabled: channel.is_enabled });
  });

  it("UC-61.1-03 GET for a channel that is not configured is 404", async () => {
    const { GET } = await import("@/app/api/channels/[channelType]/inbound/route");
    const response = await GET(new Request("http://platform.test/api/channels/Slack/inbound"), params("Slack"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ reason: "No such channel." });
  });

  it("UC-61.1-02 a signed message is handled, and the outcome returned is the one recorded", async () => {
    const { POST } = await import("@/app/api/channels/[channelType]/inbound/route");
    const body = JSON.stringify({ from: sender, name: "Route Test", text: "hello from the route test" });

    const response = await POST(post(body, sign(body)), params(CHANNEL));
    expect(response.status).toBe(200);
    const outcome = (await response.json()) as { action: string; detail: string; replies: unknown[] };

    const { rows } = await testPool().query<{ action: string; detail: string; body_text: string; direction: string }>(
      `select m.action, m.detail, m.body_text, m.direction from ai.channel_message m
       where m.channel_id = $1 and m.sender_key = $2`,
      [channel.id, sender],
    );
    expect(rows).toHaveLength(1);
    // The seeded channel is enabled, always on and takes unknown senders, so the message is
    // processed; it names no conversation, so no room receives it.
    expect(rows[0]).toMatchObject({ direction: "Inbound", body_text: "hello from the route test", action: "Process" });
    expect(rows[0].detail).toBe("The message named no conversation to mirror.");
    expect(outcome).toEqual({ action: rows[0].action, detail: rows[0].detail, replies: [] });
  });

  it("UC-61.1-02 a POST for a channel that is not configured is 404, before the body is read", async () => {
    const { POST } = await import("@/app/api/channels/[channelType]/inbound/route");
    const body = JSON.stringify({ from: sender, text: "hello" });
    const response = await POST(post(body, sign(body)), params("Slack"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ reason: "No such channel." });
  });

  it("S-61 a message with no signature, or a wrong one, is refused with 401 and not recorded", async () => {
    const { POST } = await import("@/app/api/channels/[channelType]/inbound/route");
    const body = JSON.stringify({ from: `${sender}.unsigned`, text: "let me in" });

    const unsigned = await POST(post(body, null), params(CHANNEL));
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ reason: "The signature does not match." });

    // Signed over a different body: the signature has to cover exactly what arrived.
    const forged = await POST(post(body, sign(`${body} `)), params(CHANNEL));
    expect(forged.status).toBe(401);

    const { rowCount } = await testPool().query("select 1 from ai.channel_message where sender_key = $1", [`${sender}.unsigned`]);
    expect(rowCount).toBe(0);
  });

  it("S-61 a channel with no inbound secret accepts nothing", async () => {
    const { POST } = await import("@/app/api/channels/[channelType]/inbound/route");
    const { rows } = await testPool().query<{ inbound_secret_ref: Buffer; version: number; updated_at: Date }>(
      "select inbound_secret_ref, version, updated_at from ai.channel where id = $1",
      [channel.id],
    );
    await testPool().query("update ai.channel set inbound_secret_ref = null where id = $1", [channel.id]);
    try {
      const body = JSON.stringify({ from: sender, text: "hello" });
      const response = await POST(post(body, sign(body)), params(CHANNEL));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ reason: "This channel has no inbound secret configured." });
    } finally {
      await restoreColumns("ai.channel", channel.id, rows[0]);
    }
  });

  it("S-61 a signed body that is not JSON, or lacks a sender or text, is 400", async () => {
    const { POST } = await import("@/app/api/channels/[channelType]/inbound/route");

    const notJson = "from=someone&text=hello";
    const malformed = await POST(post(notJson, sign(notJson)), params(CHANNEL));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ reason: "The body is not JSON." });

    const noText = JSON.stringify({ from: sender });
    const incomplete = await POST(post(noText, sign(noText)), params(CHANNEL));
    expect(incomplete.status).toBe(400);
    expect(await incomplete.json()).toEqual({ reason: "A message needs a sender and text." });
  });
});
