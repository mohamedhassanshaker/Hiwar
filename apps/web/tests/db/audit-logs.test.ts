import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-73 Audit and S-74 Logs: what the trail carries, what leaves the platform, and what a
 * log line is allowed to show.
 *
 * The audit trail is the record everything else is checked against, so the cases that
 * matter are the ones a screen cannot demonstrate: that an export is itself audited, that a
 * refusal is kept rather than dropped, and that a value which should never be displayed is
 * masked before it reaches the screen.
 */

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("audit and logs", () => {
  let ownerId = "";
  let memberId = "";

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const member = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    memberId = member.rows[0].id;
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-73.1-01 lists entries newest first with the five fields the screen shows", async () => {
    const { loadAudit } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const rows = await loadAudit({ limit: 50 });
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.at).toBeTruthy();
      expect(row.actorLabel).toBeTruthy();
      expect(row.action).toBeTruthy();
      expect(row.objectType).toBeTruthy();
      expect(["Allowed", "Denied"]).toContain(row.outcome);
    }

    // Newest first: the screen reads top-down and an auditor trusts that order.
    const times = rows.map((row) => Date.parse(row.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("pages the audit log on the server: a page is the next entries, and the total counts them all", async () => {
    const { loadAuditPage } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const first = await loadAuditPage({ limit: 3, offset: 0 });
    const second = await loadAuditPage({ limit: 3, offset: 3 });
    const both = await loadAuditPage({ limit: 6, offset: 0 });
    expect(first.total).toBeGreaterThanOrEqual(6);
    expect(second.total).toBe(first.total);
    expect([...first.rows, ...second.rows]).toEqual(both.rows);
  });

  it("pages the service log on the server", async () => {
    const { loadLogs } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const all = await loadLogs({ limit: 4, offset: 0 });
    const second = await loadLogs({ limit: 2, offset: 2 });
    expect(second.rows).toEqual(all.rows.slice(2, 4));
    expect(second.total).toBe(all.total);
  });

  it("UC-73.1-04 keeps a refused action as a Denied entry", async () => {
    const { setFeatureFlag } = await import("@/features/governance/service");
    const { loadAudit } = await import("@/features/governance/service");

    // A member may not change a setting. The refusal is the entry worth having: an audit
    // trail that only recorded what succeeded would hide every attempt.
    signedInAs = memberId;
    await expect(setFeatureFlag("page-assistant", false)).rejects.toThrow();

    signedInAs = ownerId;
    const rows = await loadAudit({ limit: 20 });
    const denied = rows.find((row) => row.outcome === "Denied");
    expect(denied).toBeDefined();
    expect(denied!.actorLabel).toBeTruthy();
  });

  it("UC-73.1-03 exports the filtered entries and audits the export itself", async () => {
    const { exportAudit, loadAudit } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const csv = await exportAudit({ limit: 10 });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("at,actorType,actorLabel,action,objectType,objectLabel,outcome");
    expect(lines.length).toBeGreaterThan(1);

    // Taking data out of the platform is an action, so it leaves its own entry.
    const after = await loadAudit({ limit: 1 });
    expect(after[0]).toMatchObject({ action: "exports:create", objectType: "AuditTrail" });

    // The entry records how much left, never what left.
    const entry = await testPool().query<{ detail_json: { rows: number } }>(
      "select detail_json from audit.audit_entry where action = 'exports:create' order by at desc, id desc limit 1",
    );
    expect(entry.rows[0].detail_json.rows).toBeGreaterThan(0);
    expect(JSON.stringify(entry.rows[0].detail_json)).not.toContain("@tahseel.ae");
  });

  it("UC-73.1-03 exports only what the filter selected", async () => {
    const { exportAudit } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const narrow = await exportAudit({ action: "settings:", limit: 500 });
    const lines = narrow.trim().split("\n").slice(1);
    // Every exported row is one the filter admits: an export that widened the filter would
    // be a different document from the one the auditor reviewed.
    for (const line of lines) expect(line).toContain("settings:");
  });

  it("UC-73.1-05 refuses an update or a delete on the trail", async () => {
    // Append-only is enforced by the database, not by the code that writes to it, so a
    // mistake or a compromised service account cannot quietly rewrite history.
    await expect(
      testPool().query("update audit.audit_entry set action = 'tampered' where true"),
    ).rejects.toThrow();
    await expect(testPool().query("delete from audit.audit_entry where true")).rejects.toThrow();
  });

  it("UC-74.1-01 lists log lines with time, level, service and message", async () => {
    const { loadLogs } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const { rows, services } = await loadLogs({ limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    expect(services.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.at).toBeTruthy();
      expect(row.level).toBeTruthy();
      expect(row.service).toBeTruthy();
      expect(typeof row.message).toBe("string");
    }
  });

  it("UC-74.1-04 refuses the log to someone without permission", async () => {
    const { loadLogs } = await import("@/features/governance/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    await expect(loadLogs()).rejects.toBeInstanceOf(NotPermitted);
  });

  it("UC-74.1-05 masks a value a log line should never display", async () => {
    const { loadLogs } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const service = await testPool().query<{ service: string }>(
      "select service from gov.log_entry limit 1",
    );
    await testPool().query(
      `insert into gov.log_entry (id, at, level, service, message)
       values (gen_random_uuid(), now(), 'Error', $1, $2)`,
      [
        service.rows[0].service,
        "delivery failed for mariam@tahseel.ae id 784-1990-1234567-1 using Bearer abcd1234efgh5678",
      ],
    );

    const { rows } = await loadLogs({ limit: 200 });
    const line = rows.find((row) => row.message.includes("delivery failed"));
    expect(line).toBeDefined();

    // The values are gone and the line still reads as the same event.
    expect(line!.message).not.toContain("mariam@tahseel.ae");
    expect(line!.message).not.toContain("784-1990-1234567-1");
    expect(line!.message).not.toContain("abcd1234efgh5678");
    expect(line!.message).toContain("[EMAIL]");
    expect(line!.message).toContain("delivery failed");

    await testPool().query("delete from gov.log_entry where message like 'delivery failed%'");
  });
});
