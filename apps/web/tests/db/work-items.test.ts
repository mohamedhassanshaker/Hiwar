import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-24 work items: what one may be when it is created, and where it may move afterwards.
 *
 * The board lets a card be dragged anywhere, so every rule below lives where the write
 * happens rather than in a drag handler — a transition the platform refuses has to fail the
 * same way whether it came from a drag, the drawer, an agent or the API.
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

describe.skipIf(!hasDatabase)("work items", () => {
  let ownerId = "";
  let memberId = "";
  let projectKey = "";
  // The member's work goes in Finance, their unit's project; an item outside it is read-only to them.
  const memberProjectKey = "FIN";
  const created: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const member = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    memberId = member.rows[0].id;
    const project = await testPool().query<{ key: string }>(
      "select key from work.project order by key limit 1",
    );
    projectKey = project.rows[0].key;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (created.length > 0) {
      await testPool().query("delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = any($1))", [created]);
      await testPool().query("delete from work.work_item where key = any($1)", [created]);
      created.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const create = async (over: Record<string, unknown> = {}) => {
    const { createWorkItem } = await import("@/features/work-items/service");
    const key = await createWorkItem({
      projectKey,
      type: "Task",
      titleEn: "A work item for the tests",
      titleAr: "بند عمل للاختبارات",
      priority: "Medium",
      ...over,
    } as Parameters<typeof createWorkItem>[0]);
    created.push(key);
    return key;
  };

  it("UC-24.3-01 an item with nobody on it is in the backlog, and one with an assignee is to do", async () => {
    signedInAs = ownerId;

    const unassigned = await create();
    const assigned = await create({ assignee: memberId });

    const rows = await testPool().query<{ key: string; status: string }>(
      "select key, status from work.work_item where key = any($1) order by key",
      [[unassigned, assigned]],
    );
    const status = Object.fromEntries(rows.rows.map((row) => [row.key, row.status]));
    expect(status[unassigned]).toBe("Backlog");
    expect(status[assigned]).toBe("ToDo");

    // The key comes from the type, which is how a person reads a list of them.
    expect(unassigned).toMatch(/^TSK-\d+$/);
    expect(await create({ type: "Bug" })).toMatch(/^BUG-\d+$/);
  });

  it("UC-24.3-03 a sub item needs a parent and takes that parent's project", async () => {
    const { createWorkItem, WorkItemRejected } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    await expect(
      createWorkItem({
        projectKey,
        type: "SubItem",
        titleEn: "An orphan",
        titleAr: "يتيم",
        priority: "Medium",
      } as Parameters<typeof createWorkItem>[0]),
    ).rejects.toBeInstanceOf(WorkItemRejected);

    // A parent in another project wins over whatever the form said.
    const other = await testPool().query<{ key: string }>(
      "select key from work.project where key <> $1 order by key limit 1",
      [projectKey],
    );
    if (other.rowCount === 0) return;
    const parent = await testPool().query<{ key: string }>(
      "select wi.key from work.work_item wi join work.project p on p.id = wi.project_id where p.key = $1 limit 1",
      [other.rows[0].key],
    );
    if (parent.rowCount === 0) return;

    const child = await create({ type: "SubItem", parentKey: parent.rows[0].key });
    const stored = await testPool().query<{ project: string }>(
      "select p.key as project from work.work_item wi join work.project p on p.id = wi.project_id where wi.key = $1",
      [child],
    );
    expect(stored.rows[0].project).toBe(other.rows[0].key);
  });

  it("UC-24.3-04 a bug keeps what someone needs to reproduce it", async () => {
    signedInAs = ownerId;

    const key = await create({
      type: "Bug",
      attributes: { severity: "High", steps: "Open the claim", expected: "A total", actual: "An error" },
    });
    const stored = await testPool().query<{ attributes: Record<string, unknown> }>(
      "select attributes from work.work_item where key = $1",
      [key],
    );
    expect(stored.rows[0].attributes).toMatchObject({ severity: "High", actual: "An error" });
  });

  it("UC-24.3-05 a near-duplicate of an open item is found by what it says, not how it starts", async () => {
    const { similarOpenItems } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const key = await create({ titleEn: "Update the vendor list for Q4", titleAr: "تحديث قائمة الموردين" });
    const found = await similarOpenItems(projectKey, "vendor list update for Q4");
    expect(found.map((item) => item.key)).toContain(key);

    // Nothing like it is nothing, rather than everything in the project.
    expect(await similarOpenItems(projectKey, "zzzz nothing resembles this")).toEqual([]);
  });

  it("UC-24.3-07 a reviewer who is the assignee is refused where the project requires two people", async () => {
    const { createWorkItem, WorkItemRejected } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const strict = await testPool().query<{ key: string }>(
      "select key from work.project where require_reviewer_not_author order by key limit 1",
    );
    if (strict.rowCount === 0) return;

    await expect(
      createWorkItem({
        projectKey: strict.rows[0].key,
        type: "Task",
        titleEn: "Reviewed by its own author",
        titleAr: "يراجعه مؤلفه",
        priority: "Medium",
        assignee: memberId,
        reviewer: memberId,
      } as Parameters<typeof createWorkItem>[0]),
    ).rejects.toBeInstanceOf(WorkItemRejected);
  });

  it("UC-24.3-08 an agent the project does not allow is not given its work", async () => {
    const { createWorkItem, WorkItemRejected } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const restricted = await testPool().query<{ key: string; code: string }>(
      `select p.key, a.code from work.project p
       join work.project_allowed_agent paa on paa.project_id = p.id
       join ai.agent a on a.id = paa.agent_id limit 1`,
    );
    if (restricted.rowCount === 0) return;

    const outsider = await testPool().query<{ code: string }>(
      `select code from ai.agent a
       where not exists (
         select 1 from work.project_allowed_agent paa
         join work.project p on p.id = paa.project_id
         where paa.agent_id = a.id and p.key = $1
       ) limit 1`,
      [restricted.rows[0].key],
    );
    if (outsider.rowCount === 0) return;

    await expect(
      createWorkItem({
        projectKey: restricted.rows[0].key,
        type: "Task",
        titleEn: "For an agent that may not be here",
        titleAr: "لوكيل غير مسموح",
        priority: "Medium",
        assignee: outsider.rows[0].code,
      } as Parameters<typeof createWorkItem>[0]),
    ).rejects.toBeInstanceOf(WorkItemRejected);
  });

  it("UC-24.1-07 a move the platform does not allow is refused, whatever asked for it", async () => {
    const { changeStatus, WorkItemRejected } = await import("@/features/work-items/service");
    const { canMove } = await import("@/features/work-items/transitions");
    signedInAs = ownerId;

    // Finished work reopens by starting again, not by going back mid-flight.
    expect(canMove("Done", "ToDo")).toBe(true);
    expect(canMove("Done", "InReview")).toBe(false);
    expect(canMove("Backlog", "InReview")).toBe(false);
    expect(canMove("InProgress", "Done")).toBe(true);

    const key = await create();
    const version = await testPool().query<{ version: number }>(
      "select version from work.work_item where key = $1",
      [key],
    );
    await expect(
      changeStatus({ key, status: "InReview", version: version.rows[0].version }),
    ).rejects.toBeInstanceOf(WorkItemRejected);

    // The refusal changed nothing.
    const after = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0].status).toBe("Backlog");
  });

  it("D349 the screen's items are filtered, counted and paged on the server, and an item opens off the page", async () => {
    const { loadWorkItem, loadWorkItems } = await import("@/features/work-items/service");
    signedInAs = ownerId;
    const word = `paged${Date.now().toString(36)}`;
    // Oldest first: a backlog item, an assigned high-priority one (hot), and a low-priority one due soon (hot).
    const backlog = await create({ titleEn: `${word} backlog`, priority: "Low" });
    const high = await create({ titleEn: `${word} high`, priority: "High", assignee: memberId });
    const due = await create({ titleEn: `${word} due`, priority: "Low", assignee: memberId, dueAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });

    // The list: newest first, the search's total, pages that split it.
    const first = await loadWorkItems({ scope: "all", q: word }, { board: false, limit: 2, offset: 0 });
    const second = await loadWorkItems({ scope: "all", q: word }, { board: false, limit: 2, offset: 2 });
    expect([first.total, second.total]).toEqual([3, 3]);
    expect([...first.items, ...second.items].map((item) => item.k)).toEqual([due, high, backlog]);

    // Each filter narrows the same count; the hot scope keeps only high priority, blocked or due soon.
    const total = async (filters: Parameters<typeof loadWorkItems>[0]) =>
      (await loadWorkItems({ q: word, ...filters }, { board: false, limit: 50, offset: 0 })).total;
    expect(await total({ scope: "hot" })).toBe(2);
    expect(await total({ scope: "all", priority: "Low" })).toBe(2);
    expect(await total({ scope: "all", assignee: "none" })).toBe(1);
    expect(await total({ scope: "all", assignee: memberId })).toBe(2);
    expect(await total({ scope: "all", status: "Backlog" })).toBe(1);
    expect(await total({ scope: "all", projectKey: "NOPE" })).toBe(0);
    expect(await total({ scope: "all", dueBefore: new Date(Date.now() + 3 * 86_400_000) })).toBe(1);
    expect(await total({ scope: "all", open: true })).toBe(3);

    // The board: each column's cards with the column's own count.
    const board = await loadWorkItems({ scope: "all", q: word }, { board: true });
    expect(board.columns).toMatchObject({ Backlog: 1, ToDo: 2, InProgress: 0 });
    expect(board.items.map((item) => item.k).sort()).toEqual([backlog, high, due].sort());
    // The scope chips count everything the person sees, whatever the filters.
    expect(board.scopes.all).toBeGreaterThanOrEqual(3);

    // The oldest is not on the first page of two, and still opens by its key with its detail.
    expect(first.items.map((item) => item.k)).not.toContain(backlog);
    expect(await loadWorkItem(backlog)).toMatchObject({ item: { k: backlog, st: "Backlog" }, detail: { desc: null } });
    expect(await loadWorkItem("TSK-NOPE")).toBeNull();
  });

  it("UC-24.2-01 the advanced search narrows by every criterion it offers", async () => {
    const { searchWorkItems } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const key = await create({
      titleEn: "Quarterly supplier audit",
      titleAr: "تدقيق الموردين الربعي",
      priority: "High",
      assignee: memberId,
    });

    const byKeyword = await searchWorkItems({ keyword: "supplier audit" });
    expect(byKeyword.map((item) => item.k)).toContain(key);

    const byPriority = await searchWorkItems({ keyword: "supplier audit", priority: "Low" });
    expect(byPriority.map((item) => item.k)).not.toContain(key);

    const unassigned = await searchWorkItems({ keyword: "supplier audit", assignee: "unassigned" });
    expect(unassigned.map((item) => item.k)).not.toContain(key);
  });

  it("UC-24.2-01 a keyword is matched literally, and normalised as the palette's search is", async () => {
    const { searchWorkItems } = await import("@/features/work-items/service");
    signedInAs = ownerId;
    const stamp = Date.now().toString(36);

    const percent = await create({ titleEn: `Done 100% ${stamp}` });
    const digits = await create({ titleEn: `Done 1000 ${stamp}` });
    const arabic = await create({ titleEn: `Administration ${stamp}`, titleAr: `ادارة ${stamp}` });

    // `%` is a character to find, not a wildcard that also matches the `0` of "1000".
    const byPercent = (await searchWorkItems({ keyword: `100% ${stamp}` })).map((item) => item.k);
    expect(byPercent).toContain(percent);
    expect(byPercent).not.toContain(digits);

    // NFR-21: the hamza form of alef folds as the stored search key does.
    const byArabic = (await searchWorkItems({ keyword: `إدارة ${stamp}` })).map((item) => item.k);
    expect(byArabic).toContain(arabic);
  });

  it("UC-24.2-04 a due window that ends before it starts is refused, not answered with nothing", async () => {
    const { searchWorkItems, WorkItemRejected } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    await expect(
      searchWorkItems({ dueFrom: "2026-12-01", dueTo: "2026-01-01" }),
    ).rejects.toBeInstanceOf(WorkItemRejected);
  });

  it("UC-24.2-02 a saved view keeps its criteria under a name, and saving again replaces it", async () => {
    const { saveView, loadWorkItems } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    await saveView("Mine, high priority", { priority: "High", assignee: ownerId });
    await saveView("Mine, high priority", { priority: "High" });

    const { views } = await loadWorkItems();
    const mine = views.filter((view) => view.name === "Mine, high priority");
    // One name, one set of criteria.
    expect(mine).toHaveLength(1);
    expect(mine[0].filter).toEqual({ priority: "High" });

    await testPool().query("delete from work.saved_view where person_id = $1", [ownerId]);
  });

  it("UC-25.2-01 submitting for review puts it in the reviewer's inbox", async () => {
    const { submitForReview } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const key = await create({ assignee: memberId, reviewer: ownerId });
    await submitForReview(key);

    const item = await testPool().query<{ id: string; status: string }>(
      "select id, status from work.work_item where key = $1",
      [key],
    );
    expect(item.rows[0].status).toBe("InReview");

    // A review nobody knows about is not a review.
    const waiting = await testPool().query(
      "select 1 from ai.inbox_item where source_type = 'WorkItem' and source_id = $1 and kind = 'Review'",
      [item.rows[0].id],
    );
    expect(waiting.rowCount).toBe(1);

    await testPool().query("delete from ai.inbox_item where source_id = $1", [item.rows[0].id]);
  });

  it("D358 a decided review leaves the reviewer's Inbox, whether approved or sent back", async () => {
    const { approve, requestChanges, submitForReview } = await import("@/features/work-items/service");
    const review = async (key: string) =>
      (
        await testPool().query<{ status: string; resolved: boolean }>(
          `select i.status, i.resolved_at is not null as resolved from ai.inbox_item i
           join work.work_item w on w.id = i.source_id where w.key = $1 and i.person_id = $2 and i.kind = 'Review'`,
          [key, ownerId],
        )
      ).rows;

    signedInAs = memberId;
    const approved = await create({ projectKey: memberProjectKey, assignee: memberId, reviewer: ownerId });
    const sentBack = await create({ projectKey: memberProjectKey, assignee: memberId, reviewer: ownerId });
    await submitForReview(approved);
    await submitForReview(sentBack);
    expect(await review(approved)).toEqual([{ status: "Open", resolved: false }]);

    signedInAs = ownerId;
    await approve(approved);
    await requestChanges(sentBack, "The totals are wrong.");

    expect(await review(approved)).toEqual([{ status: "Resolved", resolved: true }]);
    expect(await review(sentBack)).toEqual([{ status: "Resolved", resolved: true }]);
    await testPool().query(
      "delete from ai.inbox_item where source_id in (select id from work.work_item where key = any($1))",
      [[approved, sentBack]],
    );
  });

  it("UC-25.2-04 approving your own work item is refused", async () => {
    const { approve, mayApprove, WorkItemRejected } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    // The rule itself, which the drawer reads to decide whether to draw the button.
    expect(mayApprove({ createdBy: ownerId, assigneeType: "None", assigneeId: null }, ownerId)).toBe(false);
    expect(mayApprove({ createdBy: memberId, assigneeType: "Person", assigneeId: ownerId }, ownerId)).toBe(false);
    expect(mayApprove({ createdBy: memberId, assigneeType: "Person", assigneeId: memberId }, ownerId)).toBe(true);

    const key = await create({ assignee: memberId });
    await expect(approve(key)).rejects.toBeInstanceOf(WorkItemRejected);
  });

  it("UC-25.2-08 a parent with open sub items is not done until it is overridden with a reason", async () => {
    const { addSubItem, approve, submitForReview, WorkItemRejected } = await import(
      "@/features/work-items/service"
    );
    signedInAs = ownerId;

    // Written and done by someone else, so the owner may review it (`UC-25.2-04`).
    signedInAs = memberId;
    const parent = await create({ projectKey: memberProjectKey, assignee: memberId });
    const sub = await addSubItem(parent, "Something still open");
    created.push(sub);
    await submitForReview(parent);
    signedInAs = ownerId;

    await expect(approve(parent)).rejects.toBeInstanceOf(WorkItemRejected);

    // Overriding is allowed and says so in the history, because the sub items may have
    // been overtaken — but never silently.
    await approve(parent, "The sub item was handled in TSK-2311.");
    const after = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [parent],
    );
    expect(after.rows[0].status).toBe("Done");

    const history = await testPool().query<{ detail_en: string }>(
      `select a.detail_en from work.work_item_activity a
       join work.work_item w on w.id = a.work_item_id
       where w.key = $1 and a.event_type = 'Approved'`,
      [parent],
    );
    expect(history.rows[0].detail_en).toContain("overriding open sub items");
  });

  it("UC-25.2-03 asking for changes sends it back with what to change", async () => {
    const { requestChanges, submitForReview, WorkItemRejected } = await import(
      "@/features/work-items/service"
    );
    signedInAs = ownerId;

    signedInAs = memberId;
    const key = await create({ projectKey: memberProjectKey, assignee: memberId });
    await submitForReview(key);
    signedInAs = ownerId;

    // A request for changes with nothing in it is not one.
    await expect(requestChanges(key, "  ")).rejects.toBeInstanceOf(WorkItemRejected);

    await requestChanges(key, "Split the vendor list by region.");
    const after = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0].status).toBe("InProgress");

    const history = await testPool().query<{ detail_en: string }>(
      `select a.detail_en from work.work_item_activity a
       join work.work_item w on w.id = a.work_item_id
       where w.key = $1 and a.event_type = 'ChangesRequested'`,
      [key],
    );
    expect(history.rows[0].detail_en).toContain("Split the vendor list by region.");
  });

  it("UC-25.2-05 unblocking puts the item back where it was before the block", async () => {
    const { changeStatus, unblock } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const key = await create({ assignee: memberId });
    const version = async () => {
      const { rows } = await testPool().query<{ version: number }>(
        "select version from work.work_item where key = $1",
        [key],
      );
      return rows[0].version;
    };

    await changeStatus({ key, status: "InProgress", version: await version() });
    await changeStatus({ key, status: "Blocked", version: await version() });

    // The history already says what it was; a second copy of that fact could disagree.
    const previous = await unblock(key);
    expect(previous).toBe("InProgress");

    const after = await testPool().query<{ status: string; blocked_reason_en: string | null }>(
      "select status, blocked_reason_en from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0]).toEqual({ status: "InProgress", blocked_reason_en: null });
  });

  it("UC-25.2-07 reopening finished work needs a reason, and says it in the history", async () => {
    const { approve, reopen, submitForReview, WorkItemRejected } = await import(
      "@/features/work-items/service"
    );
    signedInAs = ownerId;

    signedInAs = memberId;
    const key = await create({ projectKey: memberProjectKey, assignee: memberId });
    await submitForReview(key);
    signedInAs = ownerId;
    await approve(key);

    // Without a reason nobody can tell why quality moved, which is the only reason to count.
    await expect(reopen(key, "   ")).rejects.toBeInstanceOf(WorkItemRejected);

    await reopen(key, "The totals were wrong.");
    const after = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0].status).toBe("ToDo");

    const counted = await testPool().query<{ detail_en: string }>(
      `select a.detail_en from work.work_item_activity a
       join work.work_item w on w.id = a.work_item_id
       where w.key = $1 and a.event_type = 'Reopened'`,
      [key],
    );
    expect(counted.rows[0].detail_en).toContain("The totals were wrong.");
  });

  it("UC-25.3-01 UC-25.3-02 a sub item lives in its parent's project and moves its progress", async () => {
    const { addSubItem, setSubItemDone } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const parent = await create();
    const sub = await addSubItem(parent, "One of two things to do");
    created.push(sub);

    const stored = await testPool().query<{ project: string; parent: string | null }>(
      `select p.key as project, (select pk.key from work.work_item pk where pk.id = wi.parent_work_item_id) as parent
       from work.work_item wi join work.project p on p.id = wi.project_id where wi.key = $1`,
      [sub],
    );
    expect(stored.rows[0]).toEqual({ project: projectKey, parent });

    await setSubItemDone(sub, true);
    const done = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [sub],
    );
    expect(done.rows[0].status).toBe("Done");

    // The parent's progress is counted from its children rather than stored on it.
    const progress = await testPool().query<{ done: number; total: number }>(
      `select count(*) filter (where c.status = 'Done')::int as done, count(*)::int as total
       from work.work_item c join work.work_item p on p.id = c.parent_work_item_id where p.key = $1`,
      [parent],
    );
    expect(progress.rows[0]).toEqual({ done: 1, total: 1 });
  });

  it("UC-25.4-01 UC-25.4-02 a comment is in the history, and an @mention reaches that person", async () => {
    const { comment } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const key = await create();
    const { mentioned } = await comment(key, "@layla could you look at the totals?");
    expect(mentioned).toContain("layla");

    const history = await testPool().query<{ event_type: string; detail_en: string }>(
      `select a.event_type, a.detail_en from work.work_item_activity a
       join work.work_item w on w.id = a.work_item_id
       where w.key = $1 and a.event_type = 'Commented'`,
      [key],
    );
    expect(history.rows[0].detail_en).toContain("look at the totals");

    const item = await testPool().query<{ id: string }>(
      "select id from work.work_item where key = $1",
      [key],
    );
    const inbox = await testPool().query(
      "select 1 from ai.inbox_item where source_id = $1 and person_id = $2 and kind = 'Mention'",
      [item.rows[0].id, memberId],
    );
    expect(inbox.rowCount).toBe(1);

    await testPool().query("delete from ai.inbox_item where source_id = $1", [item.rows[0].id]);
  });

  it("UC-24.3-02 an agent assignee starts on the work, which is what moves it on", async () => {
    signedInAs = ownerId;

    // The agent service is the only thing outside the process here; what matters is that
    // the run was asked for and that the item follows it.
    const asked: string[] = [];
    const prompts: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      asked.push(String(url));
      prompts.push((JSON.parse(String(init?.body)) as { task: { description: string } }).task.description);
      return { ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" } as Response;
    }) as typeof fetch;

    const agent = await testPool().query<{ code: string }>(
      `select code from ai.agent
       where is_system = false and status not in ('Paused', 'Error', 'Retired')
       order by code limit 1`,
    );
    const key = await create({ assignee: agent.rows[0].code });

    expect(asked.join(" ")).toContain("/agui/runs");
    // Every tool that finishes the work names the item by its key, so the agent is told it.
    expect(prompts.at(-1)).toContain(key);
    const after = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0].status).toBe("InProgress");
  });

  it("UC-25.2-09 an agent run that will not start leaves the work to do, not in progress", async () => {
    signedInAs = ownerId;

    // A failure to start must not claim progress that is not happening.
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    const agent = await testPool().query<{ code: string }>(
      `select code from ai.agent
       where is_system = false and status not in ('Paused', 'Error', 'Retired')
       order by code limit 1`,
    );
    const key = await create({ assignee: agent.rows[0].code });

    const after = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0].status).toBe("ToDo");
  });

  it("UC-24.3-01 an item is given to a person from the drawer, and never to its own reviewer", async () => {
    const { assign } = await import("@/features/work-items/service");
    signedInAs = ownerId;
    const key = await create({ reviewer: ownerId });
    const row = async () =>
      (
        await testPool().query<{ status: string; assignee_type: string; assignee_id: string | null }>(
          "select status, assignee_type, assignee_id from work.work_item where key = $1",
          [key],
        )
      ).rows[0];
    expect((await row()).status).toBe("Backlog");

    await assign(key, memberId);
    expect(await row()).toEqual({ status: "ToDo", assignee_type: "Person", assignee_id: memberId });

    await expect(assign(key, ownerId)).rejects.toThrow(/Reviewer must differ/);
    await expect(assign(key, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/no longer exists/);
  });

  it("UC-25.2-01 an agent's edit to In review tells the reviewer, and the activity names the agent", async () => {
    const { updateWorkItem } = await import("@/features/work-items/service");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    const key = await create({ assignee: ownerId, reviewer: memberId });
    const agent = (await testPool().query<{ id: string }>("select id from ai.agent order by code limit 1")).rows[0];
    const version = async () =>
      (await testPool().query<{ version: number }>("select version from work.work_item where key = $1", [key])).rows[0].version;

    await runAs(ownerId, { id: agent.id, label: "work_item_edit", runId: "11111111-1111-4111-8111-111111111111" }, async () => {
      await updateWorkItem({ key, expectedVersion: await version(), status: "InProgress" });
      await updateWorkItem({ key, expectedVersion: await version(), status: "InReview" });
    });

    const inbox = await testPool().query(
      `select 1 from ai.inbox_item i join work.work_item w on w.id = i.source_id
       where w.key = $1 and i.person_id = $2 and i.kind = 'Review' and i.status = 'Open'`,
      [key, memberId],
    );
    expect(inbox.rowCount).toBe(1);
    const activity = await testPool().query<{ actor_type: string; actor_id: string }>(
      `select a.actor_type, a.actor_id from work.work_item_activity a join work.work_item w on w.id = a.work_item_id
       where w.key = $1 and a.event_type = 'StatusChanged' order by a.at desc limit 1`,
      [key],
    );
    expect(activity.rows[0]).toEqual({ actor_type: "Agent", actor_id: agent.id });
    await testPool().query("delete from ai.inbox_item where source_id = (select id from work.work_item where key = $1)", [key]);
  });

  it("UC-24.3-02 D202 an agent reading its work item gets the brief it was written with", async () => {
    const { TOOLS_BY_NAME } = await import("@/mcp/tools");
    signedInAs = ownerId;
    const key = await create({ descriptionEn: "Summarise the vendor list. Acceptance criteria: three lines, in English." });

    const read = TOOLS_BY_NAME.get("work_item_read");
    expect(read).toBeDefined();
    const result = (await read!.run({ key } as never)) as Record<string, unknown>;
    expect(result).toMatchObject({
      key,
      title: "A work item for the tests",
      status: "Backlog",
      description: "Summarise the vendor list. Acceptance criteria: three lines, in English.",
    });
  });

  it("UC-25.2-06 assigning a blocked item to an agent starts it and moves it on", async () => {
    const { assignToAgent, changeStatus } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-2" }), text: async () => "" }) as Response) as typeof fetch;

    const key = await create();
    const version = async () => {
      const { rows } = await testPool().query<{ version: number }>(
        "select version from work.work_item where key = $1",
        [key],
      );
      return rows[0].version;
    };
    await changeStatus({ key, status: "InProgress", version: await version() });
    await changeStatus({ key, status: "Blocked", version: await version() });

    const agent = await testPool().query<{ code: string }>(
      `select a.code from ai.agent a
       where a.is_system = false
         and a.status not in ('Paused', 'Error', 'Retired')
         and (not exists (select 1 from work.project_allowed_agent paa
                          join work.project p on p.id = paa.project_id where p.key = $1)
              or exists (select 1 from work.project_allowed_agent paa
                         join work.project p on p.id = paa.project_id
                         where p.key = $1 and paa.agent_id = a.id))
       order by a.code limit 1`,
      [projectKey],
    );
    if (agent.rowCount === 0) return;

    await assignToAgent(key, agent.rows[0].code);
    const after = await testPool().query<{ status: string; assignee_type: string }>(
      "select status, assignee_type from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0]).toEqual({ status: "InProgress", assignee_type: "Agent" });
  });

  it("UC-25.2-09 D191 an agent that cannot start is said in both languages, and the item waits To do for somebody", async () => {
    const { assignToAgent, WorkItemRejected } = await import("@/features/work-items/service");
    signedInAs = ownerId;
    // The agent service refuses the run.
    globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" }) as Response) as typeof fetch;

    const key = await create();
    const agent = await testPool().query<{ code: string }>(
      `select a.code from ai.agent a
       where a.is_system = false and a.status not in ('Paused', 'Error', 'Retired')
         and not exists (select 1 from work.project_allowed_agent paa join work.project p on p.id = paa.project_id where p.key = $1)
       order by a.code limit 1`,
      [projectKey],
    );
    expect(agent.rowCount).toBe(1);

    const refusal = await assignToAgent(key, agent.rows[0].code).then(
      () => null,
      (problem: unknown) => problem,
    );
    expect(refusal).toBeInstanceOf(WorkItemRejected);
    expect((refusal as InstanceType<typeof WorkItemRejected>).message).toMatch(new RegExp(`^${agent.rows[0].code} could not start: `));
    expect((refusal as InstanceType<typeof WorkItemRejected>).messageAr).toMatch(new RegExp(`^تعذّر تشغيل ${agent.rows[0].code}: `));
    const after = await testPool().query<{ status: string; assignee_type: string }>(
      "select status, assignee_type from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0]).toEqual({ status: "ToDo", assignee_type: "Agent" });
  });

  it("UC-25.2-02 finishing the last work item of a request completes the request", async () => {
    const { approve, submitForReview } = await import("@/features/work-items/service");

    const linked = await testPool().query<{ key: string; request_key: string }>(
      `select wi.key, r.key as request_key
       from work.work_item wi join work.request r on r.id = wi.request_id
       where not exists (
         select 1 from work.work_item other
         where other.request_id = wi.request_id and other.id <> wi.id
           and other.status not in ('Done', 'Cancelled')
       )
       limit 1`,
    );
    if (linked.rowCount === 0) return;
    const { key, request_key: requestKey } = linked.rows[0];

    const before = await testPool().query<{ status: string; item: string }>(
      `select r.status, wi.status as item from work.request r
       join work.work_item wi on wi.key = $1 where r.key = $2`,
      [key, requestKey],
    );

    try {
      // The case is about what approving the last item does, so it starts from the state
      // that question is asked in rather than from whatever an earlier suite left.
      await testPool().query("update work.work_item set status = 'ToDo' where key = $1", [key]);
      await testPool().query("update work.request set status = 'InReview' where key = $1", [requestKey]);

      signedInAs = ownerId;
      await submitForReview(key);
      await approve(key, "Finishing this for the test.");

      // A request whose work is finished and which still says In review is a question
      // nobody is answering.
      const after = await testPool().query<{ status: string }>(
        "select status from work.request where key = $1",
        [requestKey],
      );
      expect(after.rows[0].status).toBe("Completed");
    } finally {
      await testPool().query("update work.request set status = $1 where key = $2", [
        before.rows[0].status,
        requestKey,
      ]);
      await testPool().query("update work.work_item set status = $1 where key = $2", [
        before.rows[0].item,
        key,
      ]);
      // The review this case raised on a seeded item, which approving leaves open.
      await testPool().query(
        `delete from ai.inbox_item where kind = 'Review' and created_at > now() - interval '5 minutes'
           and source_id = (select id from work.work_item where key = $1)`,
        [key],
      );
    }
  });

  it("UC-25.3-05 nothing moves a work item to another project", async () => {
    const service = await import("@/features/work-items/service");
    signedInAs = ownerId;

    // There is no such act, which is the rule: a sub item belongs to its parent's project
    // and a work item belongs to the project it was raised in.
    const moves = Object.keys(service).filter((name) => /project/i.test(name) && /move|set|change/i.test(name));
    expect(moves).toEqual([]);

    // And creating one under a parent always takes the parent's project.
    const parent = await create();
    const sub = await service.addSubItem(parent, "Belongs where its parent does");
    created.push(sub);
    const stored = await testPool().query<{ same: boolean }>(
      `select (c.project_id = p.project_id) as same from work.work_item c
       join work.work_item p on p.id = c.parent_work_item_id where c.key = $1`,
      [sub],
    );
    expect(stored.rows[0].same).toBe(true);
  });

  it("UC-25.1-03 an attachment is refused before it reaches the store when it may not be stored", async () => {
    const { attach, WorkItemRejected } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    const key = await create();
    const executable = `data:application/x-msdownload;base64,${Buffer.from("MZ").toString("base64")}`;
    await expect(attach(key, "setup.exe", executable)).rejects.toBeInstanceOf(WorkItemRejected);

    // Nothing was written for a file that was never acceptable.
    const files = await testPool().query(
      `select 1 from work.project_file pf
       join work.work_item wi on wi.id = pf.linked_to_id where wi.key = $1`,
      [key],
    );
    expect(files.rowCount).toBe(0);
  });

  it("an agent moves a card along the board unattended, and waits for a person to close it", async () => {
    const { updateWorkItem } = await import("@/features/work-items/service");
    const { ApprovalRequired } = await import("@/lib/approval-binding");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;

    const key = await create({ assignee: memberId });
    const agent = { id: "a-field-rules", label: "A test agent" };
    const versionOf = async () =>
      (
        await testPool().query<{ version: number }>(
          "select version from work.work_item where key = $1",
          [key],
        )
      ).rows[0].version;

    // D58 with a per-value rule: moving work along is ordinary editing, so it runs.
    const atToDo = await versionOf();
    await runAs(ownerId, agent, () =>
      updateWorkItem({ key, expectedVersion: atToDo, status: "InProgress" }),
    );
    const moved = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [key],
    );
    expect(moved.rows[0].status).toBe("InProgress");

    // Saying the work is finished is the claim a person has to agree to, and the refusal
    // comes before anything is written.
    const version = await versionOf();
    await expect(
      runAs(ownerId, agent, () => updateWorkItem({ key, expectedVersion: version, status: "Done" })),
    ).rejects.toBeInstanceOf(ApprovalRequired);
    const after = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [key],
    );
    expect(after.rows[0].status).toBe("InProgress");

    // The same call with the approval already spent at the MCP boundary goes through.
    await runAs(
      ownerId,
      agent,
      () => updateWorkItem({ key, expectedVersion: version, status: "Done" }),
      { approvedFields: ["status"] },
    );
    const closed = await testPool().query<{ status: string }>(
      "select status from work.work_item where key = $1",
      [key],
    );
    expect(closed.rows[0].status).toBe("Done");
  });

  it("a work item's agent run that stops short says so in the item's history, and the item stays", async () => {
    const { finishRun } = await import("@/features/agents/run-service");
    signedInAs = ownerId;

    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
    const agent = (
      await testPool().query<{ id: string; code: string }>(
        `select id, code from ai.agent
         where is_system = false and status not in ('Paused', 'Error', 'Retired')
         order by code limit 1`,
      )
    ).rows[0];
    const key = await create({ assignee: agent.code });
    const run = (
      await testPool().query<{ id: string; key: string }>(
        `select r.id, r.key from ai.run r join work.work_item wi on wi.id = r.context_id
         where wi.key = $1 and r.context_type = 'WorkItem'`,
        [key],
      )
    ).rows[0];

    await finishRun({
      run_id: run.id,
      status: "BudgetExceeded",
      output: "",
      tokens_in: 0,
      tokens_out: 0,
      tool_call_count: 0,
      estimated_cost_aed: 0,
      eval_scores: {},
      steps: [],
    });

    const { rows } = await testPool().query<{ actor_type: string; actor_id: string; detail: string; status: string }>(
      `select a.actor_type, a.actor_id, a.detail_en as detail, wi.status
       from work.work_item_activity a join work.work_item wi on wi.id = a.work_item_id
       where wi.key = $1 order by a.at desc limit 1`,
      [key],
    );
    expect(rows[0]).toMatchObject({ actor_type: "Agent", actor_id: agent.id, status: "InProgress" });
    expect(rows[0].detail).toContain(`${agent.code} stopped without finishing: it reached its effort limit (run ${run.key})`);
  });

  it("D346 a work item's agent run that succeeds sends the item to review; one moved on meanwhile is left", async () => {
    const { finishRun } = await import("@/features/agents/run-service");
    signedInAs = ownerId;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
    const agent = (
      await testPool().query<{ id: string; code: string }>(
        `select id, code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired') order by code limit 1`,
      )
    ).rows[0];
    const runOf = async (key: string) =>
      (
        await testPool().query<{ id: string }>(
          "select r.id from ai.run r join work.work_item wi on wi.id = r.context_id where wi.key = $1 and r.context_type = 'WorkItem'",
          [key],
        )
      ).rows[0].id;
    const succeed = (runId: string) =>
      finishRun({ run_id: runId, status: "Succeeded", output: "Done: the deck is saved.", tokens_in: 0, tokens_out: 0, tool_call_count: 2, estimated_cost_aed: 0, eval_scores: {}, steps: [] });

    const done = await create({ assignee: agent.code });
    await succeed(await runOf(done));
    const reviewed = await testPool().query<{ status: string; actor_type: string; actor_id: string; event: string }>(
      `select wi.status, a.actor_type, a.actor_id, a.event_type as event from work.work_item wi
       join work.work_item_activity a on a.work_item_id = wi.id where wi.key = $1 order by a.at desc limit 1`,
      [done],
    );
    expect(reviewed.rows[0]).toEqual({ status: "InReview", actor_type: "Agent", actor_id: agent.id, event: "SubmittedForReview" });

    // Somebody blocked it while the run worked: the run's success does not override that.
    const blocked = await create({ assignee: agent.code });
    await testPool().query("update work.work_item set status = 'Blocked' where key = $1", [blocked]);
    await succeed(await runOf(blocked));
    const left = await testPool().query<{ status: string }>("select status from work.work_item where key = $1", [blocked]);
    expect(left.rows[0].status).toBe("Blocked");
  });

  it("a work item converted into a room is read as its own title, status and project", async () => {
    const { loadWorkItemForRoom } = await import("@/features/work-items/service");
    signedInAs = memberId;
    const key = await create({ projectKey: memberProjectKey, titleEn: "A work item to discuss", priority: "High" });

    const stored = await testPool().query<{ title_en: string; title_ar: string; status: string; priority: string }>(
      "select title_en, title_ar, status, priority from work.work_item where key = $1",
      [key],
    );
    expect(await loadWorkItemForRoom(key)).toMatchObject({
      titleEn: stored.rows[0].title_en,
      titleAr: stored.rows[0].title_ar,
      status: stored.rows[0].status,
      priority: stored.rows[0].priority,
      projectKey: memberProjectKey,
    });
    expect(await loadWorkItemForRoom("WI-DOES-NOT-EXIST")).toBeNull();

    signedInAs = "";
    await expect(loadWorkItemForRoom(key)).rejects.toThrow();
  });

  it("deleting a work item takes its history, and one with a sub item under it is refused", async () => {
    const { WorkItemRejected, addSubItem, comment, deleteWorkItem } = await import("@/features/work-items/service");
    signedInAs = ownerId;
    const parent = await create();
    const sub = await addSubItem(parent, "Still under its parent");
    created.push(sub);
    await comment(sub, "A line of history that goes with it.");

    await expect(deleteWorkItem(parent)).rejects.toBeInstanceOf(WorkItemRejected);
    await expect(deleteWorkItem(parent)).rejects.toThrow(/1 sub items/);
    const kept = await testPool().query("select 1 from work.work_item where key = $1", [parent]);
    expect(kept.rowCount).toBe(1);

    await deleteWorkItem(sub);
    const history = await testPool().query(
      `select 1 from work.work_item_activity a join work.work_item wi on wi.id = a.work_item_id where wi.key = $1`,
      [sub],
    );
    expect(history.rowCount).toBe(0);
    const gone = await testPool().query("select 1 from work.work_item where key = $1", [sub]);
    expect(gone.rowCount).toBe(0);
    const entry = await testPool().query<{ action: string; object_label: string }>(
      "select action, object_label from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toEqual({ action: "work_items:delete", object_label: sub });

    await deleteWorkItem(parent);
    await expect(deleteWorkItem(parent)).rejects.toThrow(/no longer exists/);
  });
});

/**
 * The work item field rules, which decide what an agent may set unattended.
 *
 * No database: the rules are a declaration, and reading them is what the MCP server does
 * with the wire payload before the call reaches the service.
 */
describe("work item field rules", () => {
  it("asks for a person only on the way into a terminal status", async () => {
    const { sensitiveFieldsIn, TERMINAL_WORK_ITEM_STATUSES } = await import(
      "@/features/work-items/privileges"
    );
    const patch = (status: string) =>
      sensitiveFieldsIn({ key: "TSK-1", expectedVersion: 1, status } as never);

    for (const status of TERMINAL_WORK_ITEM_STATUSES) {
      expect(patch(status)).toEqual(["status"]);
    }
    for (const status of ["Backlog", "ToDo", "InProgress", "InReview", "Blocked"]) {
      expect(patch(status)).toEqual([]);
    }

    // Reopening finished work is a move out of a terminal status, not into one.
    expect(patch("ToDo")).toEqual([]);
    // Ordinary fields never were sensitive, and a patch naming none of them needs nobody.
    expect(sensitiveFieldsIn({ key: "TSK-1", expectedVersion: 1, titleEn: "A new title" })).toEqual([]);
  });

  it("fails closed on a status value the rule cannot read", async () => {
    const { sensitiveFieldsIn } = await import("@/features/work-items/privileges");
    // A payload the schema would reject still reaches `escalates` at the boundary; a
    // value that is not one of the statuses waits for a person rather than slipping past.
    expect(sensitiveFieldsIn({ key: "TSK-1", expectedVersion: 1, status: null } as never)).toEqual([
      "status",
    ]);
    expect(sensitiveFieldsIn({ key: "TSK-1", expectedVersion: 1, status: 42 } as never)).toEqual([
      "status",
    ]);
  });

  it("renders the per-value rule in the table the owner reviews", async () => {
    const { workItemFieldRulesTable } = await import("@/features/work-items/privileges");
    const table = workItemFieldRulesTable();
    // "yes" would overstate it: the review has to show which values wait for a person.
    expect(table).toContain("| status | work_items:write | only Done, Cancelled |");
    expect(table).toContain("| priority | work_items:write | no |");
  });
});
