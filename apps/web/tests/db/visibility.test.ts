import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * What a person outside a project sees of its work items and rooms (`UC-22.1-05`, `COM-07`).
 *
 * The identity is a Member scoped to the Finance org unit, created here so the case does not
 * depend on how the demo people are set up: it may read FIN and not CS. A work item is visible
 * in a project the person may read, or when they are its assignee, reviewer or creator; such an
 * item outside their projects is read-only to them.
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

describe.skipIf(!hasDatabase)("visibility of work items and rooms outside a person's projects", () => {
  let ownerId = "";
  let outsiderId = "";
  const createdItems: string[] = [];
  const createdRooms: string[] = [];
  // A word no seeded title holds, so a search or a similarity match finds only this suite's items.
  const marker = `Quillwort${Date.now().toString(36)}`;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>("select id from core.person where email = 'mariam@tahseel.ae'");
    ownerId = owner.rows[0].id;
    const finance = await testPool().query<{ id: string }>("select id from core.org_unit where name_en = 'Finance'");
    const member = await testPool().query<{ id: string }>("select id from core.role where code = 'Member'");
    const person = await testPool().query<{ id: string }>(
      `insert into core.person (email, name_en, name_ar, initials, status, org_unit_id)
       values ($1, 'Visibility Outsider', 'شخص خارجي', 'VO', 'Active', $2) returning id`,
      [`visibility-${Date.now()}@tahseel.ae`, finance.rows[0].id],
    );
    outsiderId = person.rows[0].id;
    await testPool().query(
      "insert into core.role_assignment (person_id, role_id, scope_type, scope_id) values ($1, $2, 'OrgUnit', $3)",
      [outsiderId, member.rows[0].id, finance.rows[0].id],
    );
  });

  afterEach(async () => {
    if (createdItems.length > 0) {
      await testPool().query(
        "delete from ai.inbox_item where source_type = 'WorkItem' and source_id in (select id from work.work_item where key = any($1))",
        [createdItems],
      );
      await testPool().query(
        "delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = any($1))",
        [createdItems],
      );
      await testPool().query("delete from work.work_item where key = any($1)", [createdItems]);
      createdItems.length = 0;
    }
    if (createdRooms.length > 0) {
      const rooms = "(select id from work.discussion_room where key = any($1))";
      await testPool().query(`delete from work.context_handoff where owner_type = 'Room' and owner_id in ${rooms}`, [createdRooms]);
      await testPool().query(`delete from work.room_message where room_id in ${rooms}`, [createdRooms]);
      await testPool().query(`delete from work.room_participant where room_id in ${rooms}`, [createdRooms]);
      await testPool().query("delete from work.discussion_room where key = any($1)", [createdRooms]);
      createdRooms.length = 0;
    }
  });

  afterAll(async () => {
    for (const table of ["ai.inbox_item", "gov.mail_notification", "core.notification_preference", "core.role_assignment"]) {
      await testPool().query(`delete from ${table} where person_id = $1`, [outsiderId]);
    }
    await testPool().query("delete from core.person where id = $1", [outsiderId]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** A work item the owner creates. */
  const createItem = async (projectKey: string, over: Record<string, unknown> = {}) => {
    const { createWorkItem } = await import("@/features/work-items/service");
    signedInAs = ownerId;
    const key = await createWorkItem({
      projectKey,
      type: "Task",
      titleEn: `${marker} reconcile the vendor ledger`,
      titleAr: "مطابقة دفتر الموردين",
      priority: "Medium",
      ...over,
    } as Parameters<typeof createWorkItem>[0]);
    createdItems.push(key);
    return key;
  };

  const versionOf = async (key: string) =>
    (await testPool().query<{ version: number }>("select version from work.work_item where key = $1", [key])).rows[0].version;

  it("an item in a project the person may not read is not listed, read, searched, matched or converted", async () => {
    const { loadWorkItems, searchWorkItems, similarOpenItems, loadWorkItemForRoom } = await import("@/features/work-items/service");
    const { TOOLS_BY_NAME } = await import("@/mcp/tools");
    const hidden = await createItem("CS");
    const shown = await createItem("FIN");

    signedInAs = outsiderId;
    const keys = (await loadWorkItems()).items.map((item) => item.k);
    expect(keys).toContain(shown);
    expect(keys).not.toContain(hidden);

    await expect(TOOLS_BY_NAME.get("work_item_read")!.run({ key: hidden } as never)).rejects.toThrow();
    await expect(TOOLS_BY_NAME.get("work_item_read")!.run({ key: shown } as never)).resolves.toMatchObject({ key: shown });

    expect((await searchWorkItems({ keyword: marker })).map((item) => item.k)).toEqual([shown]);

    const title = `${marker} reconcile the vendor ledger`;
    expect(await similarOpenItems("CS", title)).toEqual([]);
    expect((await similarOpenItems("FIN", title)).map((item) => item.key)).toContain(shown);

    expect(await loadWorkItemForRoom(hidden)).toBeNull();
    expect(await loadWorkItemForRoom(shown)).toMatchObject({ projectKey: "FIN" });
  });

  it("an item in a project the person may not write is refused a change by key", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { changeStatus, comment } = await import("@/features/work-items/service");
    const hidden = await createItem("CS");

    signedInAs = outsiderId;
    await expect(changeStatus({ key: hidden, status: "ToDo", version: await versionOf(hidden) })).rejects.toBeInstanceOf(NotPermitted);
    await expect(comment(hidden, "Changing what is not mine.")).rejects.toBeInstanceOf(NotPermitted);
    expect((await testPool().query<{ status: string }>("select status from work.work_item where key = $1", [hidden])).rows[0].status).toBe(
      "Backlog",
    );
  });

  it("D331 an item assigned to the person outside their projects is theirs to move and submit, and nothing else", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { loadWorkItems, changeStatus, submitForReview, updateWorkItem, deleteWorkItem } = await import("@/features/work-items/service");
    const { TOOLS_BY_NAME } = await import("@/mcp/tools");
    const theirs = await createItem("CS", { assignee: outsiderId, reviewer: ownerId });

    signedInAs = outsiderId;
    expect((await loadWorkItems()).items.map((item) => item.k)).toContain(theirs);
    await expect(TOOLS_BY_NAME.get("work_item_read")!.run({ key: theirs } as never)).resolves.toMatchObject({ key: theirs });
    await changeStatus({ key: theirs, status: "InProgress", version: await versionOf(theirs) });
    await expect(
      updateWorkItem({ key: theirs, expectedVersion: await versionOf(theirs), titleEn: `${marker} retitled` }),
    ).rejects.toBeInstanceOf(NotPermitted);
    await expect(deleteWorkItem(theirs)).rejects.toBeInstanceOf(NotPermitted);
    await submitForReview(theirs);
    const row = await testPool().query<{ status: string }>("select status from work.work_item where key = $1", [theirs]);
    expect(row.rows[0].status).toBe("InReview");
  });

  it("D331 the reviewer of an item outside their projects decides it, and does nothing else", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { approve, changeStatus, submitForReview, updateWorkItem } = await import("@/features/work-items/service");
    const reviewed = await createItem("CS", { assignee: ownerId, reviewer: outsiderId });
    signedInAs = ownerId;
    await changeStatus({ key: reviewed, status: "InProgress", version: await versionOf(reviewed) });
    await submitForReview(reviewed);

    signedInAs = outsiderId;
    await expect(
      updateWorkItem({ key: reviewed, expectedVersion: await versionOf(reviewed), priority: "High" }),
    ).rejects.toBeInstanceOf(NotPermitted);
    await approve(reviewed);
    const row = await testPool().query<{ status: string }>("select status from work.work_item where key = $1", [reviewed]);
    expect(row.rows[0].status).toBe("Done");
  });

  /** A room the owner creates, with only the owner in it. */
  const createRoom = async (projectKey: string) => {
    const rooms = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await rooms.createRoom({
      projectKey,
      titleEn: `${marker} room`,
      titleAr: "غرفة",
      type: "Chat",
      turnTaking: "MentionOnly",
      status: "Active",
      participants: [ownerId],
    } as Parameters<typeof rooms.createRoom>[0]);
    createdRooms.push(key);
    return key;
  };

  it("the room counts are of the rooms the person can see", async () => {
    const { loadRooms } = await import("@/features/rooms/service");
    await createRoom("CS");

    signedInAs = outsiderId;
    const { rooms, total, counts } = await loadRooms({}, { limit: 500, offset: 0 });
    expect(counts.total).toBe(total);
    expect(rooms).toHaveLength(total);
    expect(counts.active + counts.archived).toBeLessThanOrEqual(rooms.length);
    expect(counts.messages).toBe(rooms.reduce((sum, room) => sum + room.msgs, 0));
  });

  it("the recent rooms are the newest rooms the person can see, however many newer ones they cannot", async () => {
    const { loadRecentRooms } = await import("@/features/rooms/service");
    for (let index = 0; index < 4; index++) await createRoom("FIN");
    await createRoom("CS");

    signedInAs = outsiderId;
    const recent = await loadRecentRooms(4);
    expect(recent).toHaveLength(4);
    expect(recent.every((room) => room.p === "FIN")).toBe(true);
  });
});
