import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `POST /api/maintenance/schedules/[id]/fire`, the route a Temporal Schedule fires through
 * (flow F-06). The bearer token is the whole credential; everything after it is
 * `fireScheduled()`, so these check the token, the status each outcome answers with, and
 * that a firing reaches the schedule's own rows.
 */

const TOKEN = "a-maintenance-token-for-the-tests";
process.env.MAINTENANCE_API_TOKEN = TOKEN;
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
// Saving a schedule registers a Temporal Schedule; the cluster is not part of these cases.
vi.mock("@/lib/temporal", () => ({
  syncWorkItemSchedule: async () => null,
  setWorkItemScheduleActive: async () => undefined,
  deleteWorkItemSchedule: async () => undefined,
}));

describe.skipIf(!hasDatabase)("POST /api/maintenance/schedules/[id]/fire", () => {
  let ownerId = "";
  let projectKey = "";
  const schedules: string[] = [];

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>("select id from core.person where email = 'mariam@tahseel.ae'");
    ownerId = owner.rows[0].id;
    const project = await testPool().query<{ key: string }>(
      "select key from work.project where status not in ('Paused', 'Archived') order by key limit 1",
    );
    projectKey = project.rows[0].key;
  });

  afterEach(async () => {
    signedInAs = "";
    if (schedules.length > 0) {
      await testPool().query("delete from work.schedule_run where scheduled_work_item_id = any($1)", [schedules]);
      await testPool().query("delete from work.scheduled_work_item where id = any($1)", [schedules]);
      schedules.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const fire = async (id: string, authorization?: string) => {
    const { POST } = await import("@/app/api/maintenance/schedules/[id]/fire/route");
    return POST(
      new Request(`http://web.awp-app.svc:3000/api/maintenance/schedules/${id}/fire`, {
        method: "POST",
        headers: authorization ? { authorization } : {},
      }),
      { params: Promise.resolve({ id }) },
    );
  };

  /** A paused schedule, which the timer records as skipped and turns into no work item. */
  const pausedSchedule = async () => {
    const { saveSchedule, setScheduleActive } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const id = await saveSchedule({
      titleEn: "A scheduled work item for the route tests",
      titleAr: "بند عمل مجدول لاختبارات المسار",
      projectKey,
      createsWorkItemType: "Task",
      audienceType: "Person",
      audience: ownerId,
      repeats: "Daily",
      startDate: new Date().toISOString().slice(0, 10),
      timeOfDay: "09:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: false,
    } as Parameters<typeof saveSchedule>[0]);
    schedules.push(id);
    const { rows } = await testPool().query<{ version: number }>("select version from work.scheduled_work_item where id = $1", [id]);
    await setScheduleActive({ id, active: false, version: rows[0].version });
    signedInAs = "";
    return id;
  };

  it("flow F-06 fires the schedule as its owner and answers the outcome as JSON", async () => {
    const id = await pausedSchedule();

    const response = await fire(id, `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ outcome: "Skipped", detail: "The schedule is paused.", createdKey: null });
    const { rows } = await testPool().query<{ outcome: string; error: string; created_by: string }>(
      "select outcome, error, created_by from work.schedule_run where scheduled_work_item_id = $1",
      [id],
    );
    expect(rows).toEqual([{ outcome: "Skipped", error: "The schedule is paused.", created_by: ownerId }]);
  });

  it("refuses a missing or wrong bearer with 401 and records no firing", async () => {
    const id = await pausedSchedule();

    for (const authorization of [undefined, "Bearer not-the-token", TOKEN.slice(1)]) {
      const response = await fire(id, authorization);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "not permitted" });
    }
    const { rows } = await testPool().query<{ count: number }>(
      "select count(*)::int as count from work.schedule_run where scheduled_work_item_id = $1",
      [id],
    );
    expect(rows[0].count).toBe(0);
  });

  it("answers 404 for a schedule that does not exist", async () => {
    const response = await fire("00000000-0000-4000-8000-000000000000", `Bearer ${TOKEN}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "That scheduled work item no longer exists." });
  });

  it("answers 500 without the cause when the firing fails unexpectedly", async () => {
    // Not a uuid, so the database refuses the lookup itself.
    const response = await fire("not-a-uuid", `Bearer ${TOKEN}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "the firing could not be recorded" });
  });
});
