import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, pool, schema } from "@/db";
import { Refused } from "@/server/api";
import { claim, closeByStaff, handBack, release, staffMessage, takeOver } from "@/server/inbox";
import { cancelRequest, visitorMessage } from "@/server/visitor";
import { conversation, world } from "./fixtures";

afterAll(async () => {
  await pool.end();
});

const reload = async (id: string) => (await db.query.conversations.findFirst({ where: eq(schema.conversations.id, id) }))!;

describe("INB-002 single owner", () => {
  it("AC-INB-002-01: take over sets HUMAN_ACTIVE, the user as owner and version + 1", async () => {
    const w = await world();
    const c = await conversation(w);
    await takeOver(w.members[1], c.id, c.version);
    const after = await reload(c.id);
    expect(after.state).toBe("HUMAN_ACTIVE");
    expect(after.ownerUserId).toBe(w.members[1].user.id);
    expect(after.version).toBe(c.version + 1);
  });

  it("AC-INB-002-06: of two simultaneous claims exactly one succeeds", async () => {
    const w = await world();
    const c = await conversation(w, "HANDOVER_PENDING");
    const results = await Promise.allSettled([claim(w.members[1], c.id), claim(w.members[2], c.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(Refused);
    expect((failed.reason as Refused).message).toMatch(/claimed this conversation a moment earlier\. Only one claim succeeds\./);
    expect((await reload(c.id)).version).toBe(c.version + 1);
  });

  it("SC-002: under 50 simultaneous claims exactly one succeeds", async () => {
    const roles = Array.from({ length: 50 }, () => "support_agent" as const);
    const w = await world(["owner", ...roles]);
    const c = await conversation(w, "HANDOVER_PENDING");
    const results = await Promise.allSettled(w.members.slice(1).map((m) => claim(m, c.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("AC-INB-002-04: a reply carrying a stale version is rejected", async () => {
    const w = await world();
    const c = await conversation(w);
    await takeOver(w.members[1], c.id, c.version);
    await expect(staffMessage(w.members[1], c.id, "reply", "hello", c.version)).rejects.toThrow(/changed while you were writing/);
    await staffMessage(w.members[1], c.id, "reply", "hello", c.version + 1);
    const messages = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id) });
    expect(messages.filter((m) => m.kind === "staff")).toHaveLength(1);
  });

  it("FR-014, FR-028: non-owners cannot reply but can write internal notes", async () => {
    const w = await world();
    const c = await conversation(w);
    await takeOver(w.members[1], c.id, c.version);
    await expect(staffMessage(w.members[2], c.id, "reply", "hi", c.version + 1)).rejects.toThrow(/Only the owner can reply/);
    await staffMessage(w.members[2], c.id, "note", "Offer a voucher", c.version + 1);
    const notes = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id) });
    expect(notes.some((m) => m.kind === "note" && m.text === "Offer a voucher")).toBe(true);
  });

  it("AC-INB-002-19 and FR-020: only Owner and Admin take over from a colleague", async () => {
    const w = await world(["owner", "support_agent", "support_agent"]);
    const c = await conversation(w);
    await takeOver(w.members[1], c.id, c.version);
    await expect(takeOver(w.members[2], c.id, c.version + 1)).rejects.toThrow(/Only an Owner or Admin/);
    await takeOver(w.members[0], c.id, c.version + 1);
    const after = await reload(c.id);
    expect(after.ownerUserId).toBe(w.members[0].user.id);
    expect(after.reasonCode).toBe("supervisor_takeover");
  });

  it("AC-INB-002-08, -11, -12: hand back, release and close each increase the version", async () => {
    const w = await world();
    const c = await conversation(w);
    await takeOver(w.members[1], c.id, c.version);
    await handBack(w.members[1], c.id, "Refund approved.", true);
    let after = await reload(c.id);
    expect([after.state, after.version]).toEqual(["AI_ACTIVE", c.version + 2]);
    await takeOver(w.members[1], c.id, after.version);
    await release(w.members[1], c.id);
    after = await reload(c.id);
    expect([after.state, after.ownerUserId, after.reasonCode]).toEqual(["HANDOVER_PENDING", null, "released"]);
    await closeByStaff(w.members[1], c.id);
    after = await reload(c.id);
    expect(after.state).toBe("CLOSED");
    expect(after.summary).toBeTruthy();
  });

  it("AC-INB-002-07, -16: messages while waiting or owned by a person get no AI reply", async () => {
    const w = await world();
    const c = await conversation(w, "HANDOVER_PENDING");
    const sent = await visitorMessage({ deployment: w.deployment, token: c.visitorToken, text: "Anyone there?", visitor: { language: "en" } });
    expect(sent.runAi).toBe(false);
    await claim(w.members[1], c.id);
    const again = await visitorMessage({ deployment: w.deployment, token: c.visitorToken, text: "Hello?", visitor: { language: "en" } });
    expect(again.runAi).toBe(false);
  });

  it("AC-INB-002-13: a visitor message within 24 hours reopens a closed conversation", async () => {
    const w = await world();
    const c = await conversation(w);
    await closeByStaff(w.members[1], c.id);
    const sent = await visitorMessage({ deployment: w.deployment, token: c.visitorToken, text: "One more thing", visitor: { language: "en" } });
    expect(sent.conversationId).toBe(c.id);
    expect(sent.runAi).toBe(true);
    const after = await reload(c.id);
    expect(after.state).toBe("AI_ACTIVE");
  });

  it("FR-032: the visitor's cancel returns the conversation to the AI", async () => {
    const w = await world();
    const c = await conversation(w, "HANDOVER_PENDING");
    await cancelRequest(c);
    const after = await reload(c.id);
    expect([after.state, after.reasonCode, after.version]).toEqual(["AI_ACTIVE", "visitor_cancelled", c.version + 1]);
  });
});

describe("INB-002 FR-034 auto-close", () => {
  it("AC-INB-002-14: the sweep closes an AI conversation after 30 minutes without a visitor message", async () => {
    const { sweep } = await import("@/server/visitor");
    const w = await world();
    const c = await conversation(w);
    await db.update(schema.conversations).set({ lastVisitorAt: new Date(Date.now() - 31 * 60_000) }).where(eq(schema.conversations.id, c.id));
    await sweep();
    const after = await reload(c.id);
    expect([after.state, after.closedBy]).toEqual(["CLOSED", "auto"]);
  });
});
