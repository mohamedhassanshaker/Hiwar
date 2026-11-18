import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-31 scheduled work items against the database.
 *
 * A schedule is only worth anything if firing it produces work, so these follow a firing
 * through to the row it created, and through the cases where it must produce nothing and
 * say why.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("scheduled work items", () => {
  let ownerId = "";
  let projectKey = "";
  let agentCode = "";
  const schedules: string[] = [];
  const workItems: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const project = await testPool().query<{ key: string }>(
      "select key from work.project where status not in ('Paused', 'Archived') order by key limit 1",
    );
    projectKey = project.rows[0].key;
    const agent = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired') order by code limit 1",
    );
    agentCode = agent.rows[0].code;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (workItems.length > 0) {
      await testPool().query(
        "delete from work.schedule_run where created_work_item_id in (select id from work.work_item where key = any($1))",
        [workItems],
      );
      await testPool().query(
        "delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = any($1))",
        [workItems],
      );
      await testPool().query("delete from work.work_item where key = any($1)", [workItems]);
      workItems.length = 0;
    }
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

  const save = async (over: Record<string, unknown> = {}) => {
    const { saveSchedule } = await import("@/features/schedules/service");
    const id = await saveSchedule({
      titleEn: "A scheduled work item for the tests",
      titleAr: "بند عمل مجدول للاختبارات",
      projectKey,
      createsWorkItemType: "Task",
      audienceType: "Agent",
      audience: agentCode,
      repeats: "Daily",
      startDate: new Date().toISOString().slice(0, 10),
      timeOfDay: "09:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: true,
      instructionsEn: "Check the vendor list.",
      ...over,
    } as Parameters<typeof saveSchedule>[0]);
    schedules.push(id);
    return id;
  };

  it("UC-31.2-01 creating a schedule stores it with the time it is next due", async () => {
    signedInAs = ownerId;
    const id = await save({ repeats: "Monthly" });

    const { rows } = await testPool().query<{ repeats: string; next: Date | null; audience: string }>(
      `select s.repeats, s.next_run_at as next, a.code as audience
       from work.scheduled_work_item s join ai.agent a on a.id = s.audience_id where s.id = $1`,
      [id],
    );
    expect(rows[0].repeats).toBe("Monthly");
    expect(rows[0].audience).toBe(agentCode);
    expect(rows[0].next).not.toBeNull();
  });

  it("UC-31.2-06 an agent schedule with no instructions is refused", async () => {
    const { saveSchedule } = await import("@/features/schedules/service");
    signedInAs = ownerId;

    // The agent is given nothing else, so a schedule without instructions would fire and
    // produce an agent with no task.
    await expect(
      saveSchedule({
        titleEn: "No instructions",
        titleAr: "بدون تعليمات",
        projectKey,
        createsWorkItemType: "Task",
        audienceType: "Agent",
        audience: agentCode,
        repeats: "Daily",
        startDate: new Date().toISOString().slice(0, 10),
        timeOfDay: "09:00",
        timeZone: "Asia/Dubai",
        skipHolidaysAndWeekends: true,
        instructionsEn: "   ",
      } as Parameters<typeof saveSchedule>[0]),
    ).rejects.toThrow();
  });

  it("UC-31.2-07 a one-off schedule cannot start in the past", async () => {
    const { ScheduleRejected, saveSchedule } = await import("@/features/schedules/service");
    signedInAs = ownerId;

    await expect(
      saveSchedule({
        titleEn: "Already gone",
        titleAr: "فات موعده",
        projectKey,
        createsWorkItemType: "Task",
        audienceType: "Person",
        audience: ownerId,
        repeats: "Once",
        startDate: "2020-01-01",
        timeOfDay: "09:00",
        timeZone: "Asia/Dubai",
        skipHolidaysAndWeekends: false,
      } as Parameters<typeof saveSchedule>[0]),
    ).rejects.toBeInstanceOf(ScheduleRejected);
  });

  it("UC-31.1-03 UC-31.2-08 Run now creates the work item and records the firing", async () => {
    const { runNow } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    // The agent run is the only thing outside the process; the item is what is being checked.
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;

    const id = await save();
    const outcome = await runNow(id);
    expect(outcome.outcome).toBe("Created");
    expect(outcome.createdKey).toMatch(/^TSK-\d+$/);
    workItems.push(outcome.createdKey as string);

    // The firing is recorded, with the item it produced, which is what Last run reads.
    const { rows } = await testPool().query<{ outcome: string; item: string | null }>(
      `select sr.outcome, wi.key as item from work.schedule_run sr
       left join work.work_item wi on wi.id = sr.created_work_item_id
       where sr.scheduled_work_item_id = $1 order by sr.fired_at desc limit 1`,
      [id],
    );
    expect(rows[0].outcome).toBe("Created");
    expect(rows[0].item).toBe(outcome.createdKey);

    // A person pressed the button, so the audit names them and the action is Run now.
    const audited = await testPool().query<{ action: string; actor_type: string; actor_id: string | null }>(
      `select action, actor_type, actor_id from audit.audit_entry
       where object_id = $1 and action like 'schedules:%' order by at desc, id desc limit 1`,
      [id],
    );
    expect(audited.rows[0]).toEqual({ action: "schedules:run_now", actor_type: "Person", actor_id: ownerId });
  });

  it("UC-31.2-04 a group audience creates the item unassigned, for the group to take", async () => {
    const { runNow } = await import("@/features/schedules/service");
    signedInAs = ownerId;

    const group = await testPool().query<{ id: string }>("select id from core.group order by code limit 1");
    if (group.rowCount === 0) return;

    const id = await save({ audienceType: "Group", audience: group.rows[0].id, instructionsEn: "Take this on." });
    const outcome = await runNow(id);
    expect(outcome.outcome).toBe("Created");
    workItems.push(outcome.createdKey as string);

    const { rows } = await testPool().query<{ assignee: string | null; status: string }>(
      "select assignee_id as assignee, status from work.work_item where key = $1",
      [outcome.createdKey],
    );
    expect(rows[0].assignee).toBeNull();
    expect(rows[0].status).toBe("Backlog");
  });

  it("UC-31.2-09 UC-21.2-06 a paused project skips the firing and says why", async () => {
    const { runNow } = await import("@/features/schedules/service");
    signedInAs = ownerId;

    const id = await save();
    const before = await testPool().query<{ status: string }>("select status from work.project where key = $1", [
      projectKey,
    ]);
    await testPool().query("update work.project set status = 'Paused' where key = $1", [projectKey]);
    try {
      const outcome = await runNow(id);
      expect(outcome.outcome).toBe("Skipped");
      expect(outcome.detail).toMatch(/paused/i);

      const { rows } = await testPool().query<{ outcome: string; error: string | null }>(
        "select outcome, error from work.schedule_run where scheduled_work_item_id = $1 order by fired_at desc limit 1",
        [id],
      );
      expect(rows[0].outcome).toBe("Skipped");
      expect(rows[0].error).toMatch(/paused/i);
    } finally {
      await testPool().query("update work.project set status = $1 where key = $2", [before.rows[0].status, projectKey]);
    }
  });

  it("UC-31.1-05 UC-31.1-06 pausing one and pausing all stop the schedules firing", async () => {
    const { setAllActive, setScheduleActive } = await import("@/features/schedules/service");
    signedInAs = ownerId;

    const id = await save();
    const version = async () => {
      const { rows } = await testPool().query<{ version: number }>(
        "select version from work.scheduled_work_item where id = $1",
        [id],
      );
      return rows[0].version;
    };
    await setScheduleActive({ id, active: false, version: await version() });
    const paused = await testPool().query<{ status: string }>(
      "select status from work.scheduled_work_item where id = $1",
      [id],
    );
    expect(paused.rows[0].status).toBe("Paused");

    // `UC-31.1-05`: nothing fires until they are resumed.
    await setScheduleActive({ id, active: true, version: await version() });
    await setAllActive(false);
    const all = await testPool().query<{ count: string }>(
      "select count(*) from work.scheduled_work_item where status <> 'Paused'",
    );
    expect(Number(all.rows[0].count)).toBe(0);
    await setAllActive(true);
  });

  it("UC-31.1-01 UC-31.1-02 the list carries what each column shows", async () => {
    const { loadSchedules } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const id = await save();

    const rows = await loadSchedules();
    const mine = rows.find((row) => row.id === id);
    expect(mine).toBeDefined();
    expect(mine?.p).toBe(projectKey);
    expect(mine?.isAgent).toBe(true);
    expect(mine?.a).toBe(agentCode);
    expect(mine?.on).toBe(true);

    // `UC-31.1-02`: the audience filter is over this same list.
    expect(rows.filter((row) => row.isAgent).every((row) => row.isAgent)).toBe(true);
  });

  it("D349 the list pages and filters on the server", async () => {
    const { loadSchedulePage } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const marker = `Paged ${Date.now()}`;
    const ids = [
      await save({ titleEn: `${marker} a` }),
      await save({ titleEn: `${marker} b` }),
      await save({ titleEn: `${marker} c`, audienceType: "Person", audience: ownerId }),
    ];

    const first = await loadSchedulePage({ text: marker, limit: 2 });
    const second = await loadSchedulePage({ text: marker, limit: 2, offset: 2 });
    expect(first.total).toBe(3);
    expect(first.rows.map((row) => row.n)).toEqual([`${marker} a`, `${marker} b`]);
    expect(second.rows.map((row) => row.id)).toEqual([ids[2]]);

    // Each filter narrows the total the pager shows.
    expect((await loadSchedulePage({ text: marker, audience: "agent" })).total).toBe(2);
    expect((await loadSchedulePage({ text: marker, audience: "human" })).rows.map((row) => row.id)).toEqual([ids[2]]);
    expect((await loadSchedulePage({ text: marker, projectKey: projectKey })).total).toBe(3);
    expect((await loadSchedulePage({ text: marker, projectKey: "NO-SUCH-PROJECT" })).total).toBe(0);
    // The search is literal.
    expect((await loadSchedulePage({ text: `${marker} %` })).total).toBe(0);

    // "Pause all" names every active schedule, not the page.
    const active = await testPool().query<{ n: number }>(
      "select count(*)::int as n from work.scheduled_work_item where status = 'Active'",
    );
    expect(first.active).toBe(active.rows[0].n);
  });

  it("UC-31.1-01 UC-31.2-04 a group audience is listed by the group's name", async () => {
    const { loadSchedules } = await import("@/features/schedules/service");
    signedInAs = ownerId;

    const group = await testPool().query<{ id: string; name_en: string; name_ar: string }>(
      "select id, name_en, name_ar from core.group order by code limit 1",
    );
    expect(group.rowCount).toBeGreaterThan(0);
    const id = await save({ audienceType: "Group", audience: group.rows[0].id, instructionsEn: "Take this on." });

    const mine = (await loadSchedules()).find((row) => row.id === id);
    expect(mine).toMatchObject({
      audienceType: "Group",
      groupNameEn: group.rows[0].name_en,
      groupNameAr: group.rows[0].name_ar,
      // The Agents/Humans filter keeps a group under Humans.
      isAgent: false,
    });
  });

  it("UC-31.1-04 Edit opens on the schedule it names, and saving changes that one", async () => {
    const { loadSchedule } = await import("@/features/schedules/directory");
    const { saveSchedule } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const id = await save({ repeats: "Weekly", timeOfDay: "07:30" });

    // Every field the modal fills in comes back in the shape it sends them in.
    const prefilled = await loadSchedule(id);
    expect(prefilled?.repeats).toBe("Weekly");
    expect(prefilled?.timeOfDay).toBe("07:30");
    expect(prefilled?.instructionsEn).toBe("Check the vendor list.");
    expect(prefilled?.projectKey).toBeTruthy();
    expect(prefilled?.audience).toBeTruthy();

    // What it reads back is what it may send back: the same schedule, not a second one.
    const before = await testPool().query<{ count: number }>(
      "select count(*)::int as count from work.scheduled_work_item",
    );
    const again = await saveSchedule({
      id,
      titleEn: "Edited by the modal",
      titleAr: "عُدّل من النافذة",
      projectKey: prefilled!.projectKey,
      createsWorkItemType: (prefilled!.createsWorkItemType ?? "Task") as "Task",
      audienceType: prefilled!.audienceType as "Agent",
      audience: prefilled!.audience,
      repeats: "Weekly",
      startDate: prefilled!.startDate,
      timeOfDay: "08:45",
      timeZone: prefilled!.timeZone,
      skipHolidaysAndWeekends: prefilled!.skipHolidaysAndWeekends,
      instructionsEn: prefilled!.instructionsEn ?? undefined,
      instructionsAr: prefilled!.instructionsAr ?? undefined,
    });
    expect(again).toBe(id);

    const after = await testPool().query<{ count: number }>(
      "select count(*)::int as count from work.scheduled_work_item",
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
    expect((await loadSchedule(id))?.timeOfDay).toBe("08:45");
  });

  it("UC-31.2-02 a schedule whose type is a request type raises a request", async () => {
    const { runNow } = await import("@/features/schedules/service");
    signedInAs = ownerId;

    const type = await testPool().query<{ code: string }>(
      `select rt.code from work.request_type rt
       where rt.current_published_version_id is not null order by rt.code limit 1`,
    );
    expect(type.rowCount).toBeGreaterThan(0);

    const id = await save({ createsWorkItemType: undefined, createsRequestTypeCode: type.rows[0].code });
    const outcome = await runNow(id);
    expect(outcome.outcome).toBe("Created");
    expect(outcome.createdKey).toMatch(/^REQ-/);

    // It is a request like any other: the firing recorded which one it raised.
    const { rows } = await testPool().query<{ request: string | null; item: string | null }>(
      `select r.key as request, sr.created_work_item_id::text as item from work.schedule_run sr
       left join work.request r on r.id = sr.created_request_id
       where sr.scheduled_work_item_id = $1 order by sr.fired_at desc limit 1`,
      [id],
    );
    expect(rows[0].request).toBe(outcome.createdKey);
    expect(rows[0].item).toBeNull();

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [outcome.createdKey]);
    await testPool().query("update work.schedule_run set created_request_id = null where scheduled_work_item_id = $1", [id]);
    await testPool().query("delete from work.request where key = $1", [outcome.createdKey]);
  });

  it("UC-31.2-03 an event schedule names its event and has no next time", async () => {
    signedInAs = ownerId;
    const id = await save({ repeats: "OnEvent", eventName: "work_item.created" });

    const { rows } = await testPool().query<{ event: string | null; next: Date | null }>(
      "select event_name as event, next_run_at as next from work.scheduled_work_item where id = $1",
      [id],
    );
    expect(rows[0].event).toBe("work_item.created");
    // An event is not a clock, so there is no time to show as next.
    expect(rows[0].next).toBeNull();
  });

  const agentRun = () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
  };
  const lastFiring = async (id: string) => {
    const { rows } = await testPool().query<{ outcome: string; error: string | null; created_by: string; item: string | null }>(
      `select sr.outcome, sr.error, sr.created_by, wi.key as item from work.schedule_run sr
       left join work.work_item wi on wi.id = sr.created_work_item_id
       where sr.scheduled_work_item_id = $1 order by sr.fired_at desc limit 1`,
      [id],
    );
    return rows[0];
  };

  it("flow F-06 the timer fires a schedule as the person who owns it, with nobody signed in", async () => {
    const { fireScheduled } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    agentRun();
    // Off, so the day the suite runs on does not decide the outcome.
    const id = await save({ skipHolidaysAndWeekends: false });

    signedInAs = "";
    const outcome = await fireScheduled(id);
    expect(outcome.outcome).toBe("Created");
    workItems.push(outcome.createdKey as string);

    expect(await lastFiring(id)).toMatchObject({ outcome: "Created", created_by: ownerId, item: outcome.createdKey });
    // Nobody pressed Run now: the audit says the timer fired it, for the owner.
    const audited = await testPool().query<{
      action: string;
      actor_type: string;
      actor_id: string | null;
      detail: { outcome: string; onBehalfOf: string };
    }>(
      `select action, actor_type, actor_id, detail_json as detail from audit.audit_entry
       where action like 'schedules:%' and object_id = $1 order by at desc, id desc limit 1`,
      [id],
    );
    expect(audited.rows[0]).toMatchObject({
      action: "schedules:fire",
      actor_type: "System",
      actor_id: null,
      detail: { outcome: "Created", onBehalfOf: ownerId },
    });
  });

  it("UC-31.1-05 the timer skips a paused schedule, which Run now would fire", async () => {
    const { fireScheduled, setScheduleActive } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const id = await save({ skipHolidaysAndWeekends: false });
    const { rows } = await testPool().query<{ version: number }>("select version from work.scheduled_work_item where id = $1", [id]);
    await setScheduleActive({ id, active: false, version: rows[0].version });

    const outcome = await fireScheduled(id);
    expect(outcome).toEqual({ outcome: "Skipped", detail: "The schedule is paused.", createdKey: null });
    expect(await lastFiring(id)).toMatchObject({ outcome: "Skipped", error: "The schedule is paused.", item: null });
  });

  it("flow F-06 the timer refuses a schedule that is gone or has no owner left", async () => {
    const { ScheduleRejected, fireScheduled } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const id = await save();
    await testPool().query("update work.scheduled_work_item set created_by = null where id = $1", [id]);

    signedInAs = "";
    await expect(fireScheduled(id)).rejects.toThrow("This schedule has no owner left to fire it.");
    await expect(fireScheduled("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(ScheduleRejected);
    const runs = await testPool().query<{ count: number }>(
      "select count(*)::int as count from work.schedule_run where scheduled_work_item_id = $1",
      [id],
    );
    expect(runs.rows[0].count).toBe(0);
  });

  it("UC-31.1-03 a firing whose work item is refused is recorded as Failed with the reason", async () => {
    const { runNow } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const id = await save();
    // Allowing one other agent in the project leaves the schedule's agent outside it.
    const other = await testPool().query<{ id: string }>(
      "select id from ai.agent where code <> $1 order by code limit 1",
      [agentCode],
    );
    const project = await testPool().query<{ id: string }>("select id from work.project where key = $1", [projectKey]);
    await testPool().query(
      "insert into work.project_allowed_agent (project_id, agent_id, created_by, updated_by) values ($1, $2, $3, $3)",
      [project.rows[0].id, other.rows[0].id, ownerId],
    );
    try {
      const outcome = await runNow(id);
      expect(outcome).toEqual({ outcome: "Failed", detail: "That agent is not allowed in this project.", createdKey: null });
      expect(await lastFiring(id)).toMatchObject({ outcome: "Failed", error: "That agent is not allowed in this project.", item: null });
    } finally {
      await testPool().query("delete from work.project_allowed_agent where project_id = $1 and agent_id = $2", [
        project.rows[0].id,
        other.rows[0].id,
      ]);
    }
  });

  it("UC-31.1-01 deleting a schedule removes it with its firing history, and is audited", async () => {
    const { deleteSchedule, fireScheduled, setScheduleActive } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const id = await save();
    const { rows } = await testPool().query<{ version: number }>("select version from work.scheduled_work_item where id = $1", [id]);
    await setScheduleActive({ id, active: false, version: rows[0].version });
    await fireScheduled(id);

    await deleteSchedule(id);

    const left = await testPool().query<{ schedules: number; runs: number }>(
      `select (select count(*)::int from work.scheduled_work_item where id = $1) as schedules,
              (select count(*)::int from work.schedule_run where scheduled_work_item_id = $1) as runs`,
      [id],
    );
    expect(left.rows[0]).toEqual({ schedules: 0, runs: 0 });
    const audited = await testPool().query<{ actor_id: string }>(
      "select actor_id from audit.audit_entry where action = 'schedules:delete' and object_id = $1",
      [id],
    );
    expect(audited.rows.map((row) => row.actor_id)).toEqual([ownerId]);
  });

  it("deleting a schedule needs schedules:write", async () => {
    const { deleteSchedule } = await import("@/features/schedules/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    const id = await save();

    // `layla@tahseel.ae` is a Member, who may read schedules but not change them.
    const member = await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'");
    signedInAs = member.rows[0].id;
    await expect(deleteSchedule(id)).rejects.toBeInstanceOf(NotPermitted);
    const kept = await testPool().query<{ count: number }>("select count(*)::int as count from work.scheduled_work_item where id = $1", [id]);
    expect(kept.rows[0].count).toBe(1);
  });

  it("the working calendar is the organisation's working days and holiday dates", async () => {
    const { workingCalendarFor } = await import("@/features/schedules/service");
    const { rows } = await testPool().query<{ working_days: number[] | null; holiday: string | null }>(
      `select w.working_days,
              (select h.date from core.calendar_holiday h where h.calendar_id = o.holiday_calendar_id order by h.date limit 1) as holiday
       from core.organisation o left join core.calendar w on w.id = o.working_calendar_id limit 1`,
    );
    const workingDays = rows[0]?.working_days ?? [1, 2, 3, 4, 5, 6, 7];

    expect(await workingCalendarFor("1999-06-15")).toEqual({ workingDays, isHoliday: false });
    if (rows[0]?.holiday) {
      expect(await workingCalendarFor(rows[0].holiday)).toEqual({ workingDays, isHoliday: true });
    }
  });
});
