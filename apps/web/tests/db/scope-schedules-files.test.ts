import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * Schedules, project files and artifacts for a person whose role is scoped to one org unit
 * (`UC-41.2-03`, NFR-09): their permissions apply only within that unit's projects.
 *
 * The identity is a WorkLead scoped to Procurement, created here: it may write schedules and
 * files in PRC and not in CS. Each refusal is checked to have changed nothing.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/objects", () => ({
  buckets: { files: "files", artifacts: "artifacts", attachments: "attachments" },
  objectStoreConfigured: () => true,
  putObject: async (bucket: string, key: string) => `${bucket}/${key}`,
  deleteObject: async () => undefined,
  getObject: async () => null,
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("schedules and files for a person scoped to one org unit", () => {
  let ownerId = "";
  let leadId = "";
  const stamp = Date.now().toString(36);
  const schedules: string[] = [];
  const workItems: string[] = [];
  const fileNames: string[] = [];
  const artifactTitles: string[] = [];
  const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 scoped").toString("base64")}`;

  beforeAll(async () => {
    ownerId = (await testPool().query<{ id: string }>("select id from core.person where email = 'mariam@tahseel.ae'")).rows[0].id;
    const procurement = await testPool().query<{ id: string }>("select id from core.org_unit where name_en = 'Procurement'");
    const workLead = await testPool().query<{ id: string }>("select id from core.role where code = 'WorkLead'");
    const person = await testPool().query<{ id: string }>(
      `insert into core.person (email, name_en, name_ar, initials, status, org_unit_id)
       values ($1, 'Scoped Lead', 'قائد محدود النطاق', 'SL', 'Active', $2) returning id`,
      [`scoped-lead-${stamp}@tahseel.ae`, procurement.rows[0].id],
    );
    leadId = person.rows[0].id;
    await testPool().query(
      "insert into core.role_assignment (person_id, role_id, scope_type, scope_id) values ($1, $2, 'OrgUnit', $3)",
      [leadId, workLead.rows[0].id, procurement.rows[0].id],
    );
  });

  afterEach(async () => {
    if (workItems.length > 0) {
      const items = "(select id from work.work_item where key = any($1))";
      await testPool().query(`delete from work.schedule_run where created_work_item_id in ${items}`, [workItems]);
      await testPool().query(`delete from ai.inbox_item where source_type = 'WorkItem' and source_id in ${items}`, [workItems]);
      await testPool().query(`delete from work.work_item_activity where work_item_id in ${items}`, [workItems]);
      await testPool().query("delete from work.work_item where key = any($1)", [workItems]);
      workItems.length = 0;
    }
    if (schedules.length > 0) {
      await testPool().query("delete from work.schedule_run where scheduled_work_item_id = any($1)", [schedules]);
      await testPool().query("delete from work.scheduled_work_item where id = any($1)", [schedules]);
      schedules.length = 0;
    }
    if (fileNames.length > 0) {
      await testPool().query("delete from work.project_file where name = any($1)", [fileNames]);
      fileNames.length = 0;
    }
    if (artifactTitles.length > 0) {
      const artifacts = "(select id from work.artifact where name_en = any($1))";
      await testPool().query(`update work.artifact set current_version_id = null where id in ${artifacts}`, [artifactTitles]);
      await testPool().query(`delete from work.artifact_version where artifact_id in ${artifacts}`, [artifactTitles]);
      await testPool().query("delete from work.artifact where name_en = any($1)", [artifactTitles]);
      artifactTitles.length = 0;
    }
  });

  afterAll(async () => {
    for (const table of ["ai.inbox_item", "gov.mail_notification", "core.notification_preference", "core.role_assignment"]) {
      await testPool().query(`delete from ${table} where person_id = $1`, [leadId]);
    }
    await testPool().query("delete from core.person where id = $1", [leadId]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const title = (what: string) => `Scoped ${what} ${stamp}`;

  /** A schedule saved by whoever is signed in: a work item for the lead, every day. */
  const save = async (projectKey: string, over: Record<string, unknown> = {}) => {
    const { saveSchedule } = await import("@/features/schedules/service");
    const id = await saveSchedule({
      titleEn: title("schedule"),
      titleAr: "جدول محدود النطاق",
      projectKey,
      createsWorkItemType: "Task",
      audienceType: "Person",
      audience: leadId,
      repeats: "Daily",
      startDate: new Date().toISOString().slice(0, 10),
      timeOfDay: "09:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: false,
      ...over,
    } as Parameters<typeof saveSchedule>[0]);
    if (!schedules.includes(id)) schedules.push(id);
    return id;
  };

  const scheduleRow = async (id: string) =>
    (
      await testPool().query<{ title_en: string; status: string; version: number; created_by: string; project: string }>(
        `select s.title_en, s.status, s.version, s.created_by, p.key as project
         from work.scheduled_work_item s join work.project p on p.id = s.project_id where s.id = $1`,
        [id],
      )
    ).rows[0];

  it("creating, editing, pausing, deleting and running now a schedule outside the unit are refused and change nothing", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const service = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const outside = await save("CS");

    signedInAs = leadId;
    await expect(save("CS", { titleEn: title("created outside") })).rejects.toBeInstanceOf(NotPermitted);
    expect(
      (await testPool().query("select 1 from work.scheduled_work_item where title_en = $1", [title("created outside")])).rows,
    ).toHaveLength(0);

    await expect(save("CS", { id: outside, titleEn: title("edited outside") })).rejects.toBeInstanceOf(NotPermitted);
    const { version } = await scheduleRow(outside);
    await expect(service.setScheduleActive({ id: outside, active: false, version })).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.deleteSchedule(outside)).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.runNow(outside)).rejects.toBeInstanceOf(NotPermitted);

    expect(await scheduleRow(outside)).toMatchObject({ title_en: title("schedule"), status: "Active", created_by: ownerId });
    expect((await testPool().query("select 1 from work.schedule_run where scheduled_work_item_id = $1", [outside])).rows).toHaveLength(0);
  });

  it("a schedule inside the unit cannot be moved to a project outside it", async () => {
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = leadId;
    const inside = await save("PRC");

    await expect(save("CS", { id: inside })).rejects.toBeInstanceOf(NotPermitted);
    expect(await scheduleRow(inside)).toMatchObject({ project: "PRC" });
  });

  it("inside the unit the lead creates, pauses, runs now and deletes a schedule", async () => {
    const service = await import("@/features/schedules/service");
    signedInAs = leadId;
    const inside = await save("PRC");

    await service.setScheduleActive({ id: inside, active: false, version: (await scheduleRow(inside)).version });
    expect(await scheduleRow(inside)).toMatchObject({ status: "Paused" });

    const fired = await service.runNow(inside);
    if (fired.createdKey) workItems.push(fired.createdKey);
    expect(fired).toMatchObject({ outcome: "Created" });

    await service.deleteSchedule(inside);
    expect(await scheduleRow(inside)).toBeUndefined();
  });

  it("editing somebody else's schedule makes the editor its owner, whom the timer then acts as", async () => {
    signedInAs = ownerId;
    const inside = await save("PRC");
    expect(await scheduleRow(inside)).toMatchObject({ created_by: ownerId });

    signedInAs = leadId;
    await save("PRC", { id: inside, titleEn: title("edited by the lead") });
    expect(await scheduleRow(inside)).toMatchObject({ title_en: title("edited by the lead"), created_by: leadId });
  });

  it("a person scoped to one unit cannot pause every schedule", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { setAllActive } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const outside = await save("CS");

    signedInAs = leadId;
    await expect(setAllActive(false)).rejects.toBeInstanceOf(NotPermitted);
    expect(await scheduleRow(outside)).toMatchObject({ status: "Active" });
  });

  it("the schedules list shows only the schedules of projects the person may read", async () => {
    const { loadSchedules } = await import("@/features/schedules/service");
    signedInAs = ownerId;
    const outside = await save("CS");
    const inside = await save("PRC");

    signedInAs = leadId;
    const ids = (await loadSchedules()).map((schedule) => schedule.id);
    expect(ids).toContain(inside);
    expect(ids).not.toContain(outside);
  });

  /** A project file placed directly, uploaded by the owner and readable by the project. */
  const place = async (projectKey: string, name: string) => {
    fileNames.push(name);
    await testPool().query(
      `insert into work.project_file (project_id, name, content_ref, size, mime_type, scope_of_use, uploaded_by, status)
       select id, $2, 'files/scoped', 10, 'application/pdf', 'AllProject', $3, 'Active' from work.project where key = $1`,
      [projectKey, name, ownerId],
    );
  };

  const fileStatus = async (name: string) =>
    (await testPool().query<{ status: string }>("select status from work.project_file where name = $1", [name])).rows[0]?.status;

  it("uploading, deactivating and deleting a file outside the unit are refused and change nothing", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { deleteItem, setFileStatus, uploadFile } = await import("@/features/files/service");
    const outside = `scoped-outside-${stamp}.pdf`;
    await place("CS", outside);

    signedInAs = leadId;
    const uploaded = `scoped-upload-${stamp}.pdf`;
    fileNames.push(uploaded);
    await expect(uploadFile({ projectKey: "CS", name: uploaded, dataUrl: pdf, scope: "AllProject", grants: [] })).rejects.toBeInstanceOf(
      NotPermitted,
    );
    expect(await fileStatus(uploaded)).toBeUndefined();

    await expect(setFileStatus({ name: outside, kind: "file", active: false })).rejects.toBeInstanceOf(NotPermitted);
    await expect(deleteItem({ name: outside, kind: "file", active: false })).rejects.toBeInstanceOf(NotPermitted);
    expect(await fileStatus(outside)).toBe("Active");

    // Inside the unit the same three succeed.
    await uploadFile({ projectKey: "PRC", name: uploaded, dataUrl: pdf, scope: "AllProject", grants: [] });
    expect(await fileStatus(uploaded)).toBe("Active");
    await setFileStatus({ name: uploaded, kind: "file", active: false });
    expect(await fileStatus(uploaded)).toBe("Inactive");
    await deleteItem({ name: uploaded, kind: "file", active: false });
    expect(await fileStatus(uploaded)).toBeUndefined();
  });

  const artifactCount = async (titleEn: string) =>
    (await testPool().query("select 1 from work.artifact where name_en = $1", [titleEn])).rows.length;

  it("creating an artifact outside the unit, or linked to a record the person may not read, is refused", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { createArtifact } = await import("@/features/files/service");
    const { createWorkItem } = await import("@/features/work-items/service");

    signedInAs = ownerId;
    const hiddenItem = await createWorkItem({ projectKey: "CS", type: "Task", titleEn: title("item"), titleAr: "بند", priority: "Medium" });
    workItems.push(hiddenItem);

    signedInAs = leadId;
    const artifact = (titleEn: string, over: Record<string, unknown>) => {
      artifactTitles.push(titleEn);
      return createArtifact({ titleEn, titleAr: titleEn, fileName: "scoped.pdf", dataUrl: pdf, ...over } as Parameters<typeof createArtifact>[0]);
    };

    await expect(artifact(title("artifact outside"), { projectKey: "CS" })).rejects.toBeInstanceOf(NotPermitted);
    expect(await artifactCount(title("artifact outside"))).toBe(0);

    // In a project the lead may write, but linked to a work item they may not read.
    await expect(
      artifact(title("artifact linked"), { projectKey: "PRC", linkedToType: "WorkItem", linkedToKey: hiddenItem }),
    ).rejects.toBeInstanceOf(NotPermitted);
    expect(await artifactCount(title("artifact linked"))).toBe(0);

    await artifact(title("artifact inside"), { projectKey: "PRC" });
    expect(await artifactCount(title("artifact inside"))).toBe(1);
  });
});
