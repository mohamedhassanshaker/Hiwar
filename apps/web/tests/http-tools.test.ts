import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, pool, schema } from "@/db";
import { updateHttpTool } from "@/server/agents";
import { openText, sealText } from "@/server/crypto";
import { business, healthAlerts } from "@/server/ops";
import { recordWidgetLoadError } from "@/server/widget";
import { conversation, world } from "./fixtures";

afterAll(async () => {
  await pool.end();
});

const input = (secretValue: string, name = "Look up an order") => ({
  name,
  description: "Finds an order by number",
  access: "read",
  endpoint: "https://api.example.test/orders",
  method: "POST",
  headers: {},
  inputSchema: { type: "object", properties: {} },
  secrets: { Authorization: secretValue },
});

async function toolWithSecret(w: Awaited<ReturnType<typeof world>>, value: string) {
  const [tool] = await db
    .insert(schema.httpTools)
    .values({
      orgId: w.org.id,
      name: "Look up an order",
      description: "Finds an order by number",
      access: "read",
      config: { endpoint: "https://api.example.test/orders", method: "POST", headers: {}, inputSchema: { type: "object", properties: {} } },
      secrets: sealText(JSON.stringify({ Authorization: value })),
    })
    .returning();
  return tool;
}

const entries = (orgId: string) => db.query.auditEntries.findMany({ where: and(eq(schema.auditEntries.orgId, orgId), eq(schema.auditEntries.area, "Tools")) });

describe("ORG-003 changing an HTTP tool", () => {
  it("AC-ORG-003-07: a new secret is logged as 'value rotated · not shown' and no value reaches the log", async () => {
    const w = await world(["owner"]);
    const tool = await toolWithSecret(w, "sk-first-value");
    await updateHttpTool(w.members[0], tool.id, input("sk-second-value"));
    const log = await entries(w.org.id);
    expect(log.map((e) => e.change)).toEqual(["value rotated · not shown"]);
    expect(JSON.stringify(log)).not.toMatch(/sk-(first|second)-value/);
    const stored = await db.query.httpTools.findFirst({ where: eq(schema.httpTools.id, tool.id) });
    expect(JSON.parse(openText(stored!.secrets!))).toEqual({ Authorization: "sk-second-value" });
  });

  it("an empty secret value keeps the stored one, and other changes are named", async () => {
    const w = await world(["owner"]);
    const tool = await toolWithSecret(w, "sk-kept-value");
    await updateHttpTool(w.members[0], tool.id, input("", "Find an order"));
    expect((await entries(w.org.id)).map((e) => e.change)).toEqual(["name changed"]);
    const stored = await db.query.httpTools.findFirst({ where: eq(schema.httpTools.id, tool.id) });
    expect(JSON.parse(openText(stored!.secrets!))).toEqual({ Authorization: "sk-kept-value" });
  });

  it("refuses a tool of another organization", async () => {
    const mine = await world(["owner"]);
    const theirs = await world(["owner"]);
    const tool = await toolWithSecret(theirs, "sk-other-value");
    await expect(updateHttpTool(mine.members[0], tool.id, input("sk-x"))).rejects.toThrow("This tool does not exist.");
  });
});

describe("OPS-004 widget load errors", () => {
  it("AC-OPS-004-04: Cost and health counts the widget load errors of the last 24 hours", async () => {
    const w = await world(["owner"]);
    const before = (await business(7)).health?.widget_load_errors ?? 0;
    await recordWidgetLoadError({ orgId: w.org.id, deploymentId: w.deployment.id, reason: "origin_not_allowed", origin: "https://not-listed.example" });
    await recordWidgetLoadError({ orgId: null, deploymentId: null, reason: "unknown_key", origin: null });
    expect((await business(7)).health?.widget_load_errors).toBe(before + 2);
  });

  it("AC-OPS-004-05: model errors above 2% of the last 5 minutes alert Platform admins", async () => {
    const w = await world(["owner"]);
    const c = await conversation(w);
    for (let i = 0; i < 5; i += 1) {
      await db.insert(schema.messages).values({ orgId: w.org.id, conversationId: c.id, kind: "event", text: "The AI could not reply. The visitor was offered a person." });
    }
    expect(await healthAlerts()).toContain("Model error rate is above 2%.");
  });
});
