import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-55 memory, against the database.
 *
 * A memory is read into an agent's prompt on every run it is in scope for, so what is
 * checked here is what stops the wrong thing getting in: who may approve, what the PII
 * filter takes out, and that a version is never lost.
 */

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("memory", () => {
  let ownerId = "";
  let otherId = "";
  let scopePath = "";
  let agentId = "";
  const created: string[] = [];
  /** D68: the private (agent, person) scopes a case made, cleared with its memories. */
  const privateScopes: string[] = [];

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const other = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'memory:write' and rp.effect = 'Allow'
         and p.status = 'Active' and p.email <> 'mariam@tahseel.ae'
       order by ra.person_id limit 1`,
    );
    // The permission rules are about two people, so a seed with only one cannot show them.
    otherId = other.rows[0].id;
    const scope = await testPool().query<{ path: string }>(
      "select path from ai.memory_scope where kind = 'Organisation' limit 1",
    );
    scopePath = scope.rows[0].path;
    const agent = await testPool().query<{ id: string }>("select id from ai.agent where code = 'exp'");
    agentId = agent.rows[0].id;
  });

  afterEach(async () => {
    if (created.length > 0) {
      await testPool().query(
        "delete from ai.memory_version where memory_id in (select id from ai.memory where path = any($1))",
        [created],
      );
      await testPool().query("delete from ai.memory where path = any($1)", [created]);
      created.length = 0;
    }
    if (privateScopes.length > 0) {
      await testPool().query(
        "delete from ai.memory where scope_id in (select id from ai.memory_scope where path = any($1))",
        [privateScopes],
      );
      await testPool().query("delete from ai.memory_scope where path = any($1)", [privateScopes]);
      privateScopes.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** A memory of this test's own, so nothing here edits a seeded one. */
  const makeMemory = async (over: Record<string, unknown> = {}) => {
    const { createMemory } = await import("@/features/memory/service");
    const slug = `test-${Date.now().toString(36)}-${Math.floor(performance.now())}`;
    const path = await createMemory({
      scopePath,
      slug,
      titleEn: "A memory for the tests",
      titleAr: "ذاكرة للاختبارات",
      content: "## Rule\nAlways check the vendor list first.",
      requiresReview: false,
      ...over,
    } as Parameters<typeof createMemory>[0]);
    created.push(path);
    return path;
  };

  it("UC-55.3-06 a new memory starts at version 1, and pending review when the policy asks", async () => {
    signedInAs = ownerId;
    const path = await makeMemory();

    const { rows } = await testPool().query<{ status: string; version: number; content: string }>(
      `select m.status, m.current_version as version, v.content
       from ai.memory m join ai.memory_version v on v.memory_id = m.id and v.version_number = m.current_version
       where m.path = $1`,
      [path],
    );
    expect(rows[0].status).toBe("Active");
    expect(rows[0].version).toBe(1);
    expect(rows[0].content).toContain("vendor list");

    // With review required it is not used in runs until somebody approves it.
    const pending = await makeMemory({ requiresReview: true });
    const held = await testPool().query<{ status: string }>("select status from ai.memory where path = $1", [pending]);
    expect(held.rows[0].status).toBe("PendingReview");
  });

  it("UC-55.3-02 a version without a change note is refused", async () => {
    const { saveMemoryInput } = await import("@/features/memory/schema");
    // A change nobody can account for later is not a change the platform takes.
    const outcome = saveMemoryInput.safeParse({ path: "x", content: "something", changeNote: "", version: 1 });
    expect(outcome.success).toBe(false);
    expect(JSON.stringify(outcome.error?.issues)).toMatch(/Say what changed/i);
  });

  it("UC-55.3-01 UC-55.3-03 a save makes a version, and the PII filter is reported not hidden", async () => {
    const { saveMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const path = await makeMemory();

    const outcome = await saveMemory({
      path,
      content: "## Contact\nReach mariam@tahseel.ae about this.",
      changeNote: "Added the contact.",
      version: 1,
    });
    expect(outcome.version).toBe(2);

    const { rows } = await testPool().query<{ content: string; note: string }>(
      `select v.content, v.change_note as note from ai.memory_version v
       join ai.memory m on m.id = v.memory_id where m.path = $1 and v.version_number = 2`,
      [path],
    );
    // With the filter on the address is masked; with it off it is stored as written. Either
    // way the saver is told which happened.
    const flag = await testPool().query<{ on: boolean }>(
      "select is_enabled as on from gov.feature_flag where key = 'pii-filter-on-memory-writes'",
    );
    if (flag.rows[0]?.on) {
      expect(outcome.masked).toBe(true);
      expect(rows[0].content).not.toContain("mariam@tahseel.ae");
    } else {
      expect(outcome.masked).toBe(false);
    }
    expect(rows[0].note).toBe("Added the contact.");
  });

  it("UC-55.3-07 a save against a stale version is refused", async () => {
    const { saveMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const path = await makeMemory();

    await saveMemory({ path, content: "## One\nFirst.", changeNote: "First change.", version: 1 });
    // The second writer is still holding version 1, which is no longer what is there.
    await expect(
      saveMemory({ path, content: "## Two\nSecond.", changeNote: "Second change.", version: 1 }),
    ).rejects.toThrow();
  });

  it("UC-55.3-01 a reviewed memory saves against the lock the screen was given", async () => {
    const { loadMemory, reviewMemory, saveMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const path = await makeMemory({ requiresReview: true });
    // A review moves the row's lock and leaves the content version at 1.
    signedInAs = otherId;
    await reviewMemory({ path, decision: "Approved" });

    signedInAs = ownerId;
    const shown = (await loadMemory()).memories.find((memory) => memory.id === path);
    expect(shown?.v).toBe(1);
    const outcome = await saveMemory({
      path,
      content: "## Rule\nCheck the vendor list, then the contract.",
      changeNote: "Added the contract.",
      version: shown?.version ?? 0,
    });
    expect(outcome.version).toBe(2);
  });

  it("UC-55.3-04 UC-55.3-05 versions compare side by side, and a restore is a new version", async () => {
    const { compareVersions, restoreVersion, saveMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const path = await makeMemory();

    await saveMemory({ path, content: "## Changed\nThe new content.", changeNote: "Changed it.", version: 1 });
    const both = await compareVersions(path, 1, 2);
    expect(both.from).toContain("vendor list");
    expect(both.to).toContain("The new content");

    // `UC-55.3-05`: the old version stays; a new one carries its content.
    const created3 = await restoreVersion({ path, fromVersion: 1 });
    expect(created3).toBe(3);
    const { rows } = await testPool().query<{ content: string; from: number | null }>(
      `select v.content, v.restored_from_version as from from ai.memory_version v
       join ai.memory m on m.id = v.memory_id where m.path = $1 and v.version_number = 3`,
      [path],
    );
    expect(rows[0].content).toContain("vendor list");
    expect(rows[0].from).toBe(1);
  });

  it("UC-55.2-01 UC-55.2-02 UC-55.2-04 a review is somebody else's, and it decides what runs may read", async () => {
    const { MemoryRejected, loadMemory, reviewMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const path = await makeMemory({ requiresReview: true });
    // What the screen reads to decide whether it offers the decision at all.
    const mayReview = async () =>
      (await loadMemory()).memories.find((memory) => memory.id === path)?.mayReview;

    // `UC-55.2-04`: the person who proposed it may not also approve it, and is not offered it.
    expect(await mayReview()).toBe(false);
    await expect(reviewMemory({ path, decision: "Approved" })).rejects.toBeInstanceOf(MemoryRejected);

    signedInAs = otherId;
    expect(await mayReview()).toBe(true);
    await reviewMemory({ path, decision: "Approved" });

    const { rows } = await testPool().query<{ status: string }>("select status from ai.memory where path = $1", [path]);
    expect(rows[0].status).toBe("Active");

    // `UC-55.2-02`: a rejection takes it out of use. Proposed by one person and decided by
    // the other, because the same rule applies to a rejection.
    signedInAs = ownerId;
    const rejected = await makeMemory({ requiresReview: true });
    signedInAs = otherId;
    await reviewMemory({ path: rejected, decision: "Rejected" });
    const after = await testPool().query<{ status: string }>("select status from ai.memory where path = $1", [rejected]);
    expect(after.rows[0].status).toBe("Rejected");
  });

  it("UC-55.1-01 UC-55.1-05 the tree, the counters and one memory's detail are read together", async () => {
    const { loadMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const path = await makeMemory();

    const { tree, opened, counts, versions, mayWrite } = await loadMemory({}, undefined, path);
    expect(tree.length).toBeGreaterThan(0);
    expect(counts.total).toBeGreaterThan(0);
    expect(mayWrite).toBe(true);

    // The opened memory is the one the address names, with its history.
    expect(opened?.id).toBe(path);
    expect(opened?.v).toBe(1);
    expect(opened?.items.length).toBeGreaterThan(0);
    expect(versions[path]?.length).toBeGreaterThan(0);
  });

  it("D349 the memory list is one page of what matches, counted with the same filters", async () => {
    const { loadMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const word = `zephyrine${Date.now().toString(36)}`;
    const titled = await makeMemory({ slug: `${word}-a`, titleEn: `Memory about ${word}` });
    const bodied = await makeMemory({ content: `## Rule\nThe ${word} rule applies to refunds.` });
    const pending = await makeMemory({ slug: `${word}-c`, titleEn: `Pending ${word}`, requiresReview: true });

    // Words in the title or in the current content find the memory, on the server.
    const found = await loadMemory({ q: word });
    expect(found.total).toBe(3);
    expect(found.memories.map((memory) => memory.id).sort()).toEqual([titled, bodied, pending].sort());
    // The tree carries the page's memories and nothing else.
    expect(found.tree.flatMap((group) => group.kids.map((kid) => kid.id)).sort()).toEqual([titled, bodied, pending].sort());

    // A filter narrows the total as well as the rows.
    const waiting = await loadMemory({ q: word, status: "PendingReview" });
    expect(waiting.total).toBe(1);
    expect(waiting.memories.map((memory) => memory.id)).toEqual([pending]);

    // Page 2 is the rows after page 1, and the total stays the whole count.
    const first = await loadMemory({ q: word }, { limit: 2, offset: 0 });
    const second = await loadMemory({ q: word }, { limit: 2, offset: 2 });
    expect(first.memories).toHaveLength(2);
    expect(second.memories).toHaveLength(1);
    expect(second.total).toBe(3);
    expect(new Set([...first.memories, ...second.memories].map((memory) => memory.id)).size).toBe(3);

    // A memory opened by its path is read even when it is not on the page.
    const elsewhere = await loadMemory({ q: word }, { limit: 1, offset: 0 }, second.memories[0].id);
    expect(elsewhere.memories.map((memory) => memory.id)).not.toContain(second.memories[0].id);
    expect(elsewhere.opened?.id).toBe(second.memories[0].id);
  });

  it("D349 a memory in a scope the reader cannot reach is never listed, counted or opened", async () => {
    const { loadMemory, rememberForRun } = await import("@/features/memory/service");
    const { runAs } = await import("@/lib/session");
    const word = `quillon${Date.now().toString(36)}`;
    const written = await runAs(ownerId, { id: agentId, label: "exp" }, () => rememberForRun(`Private note ${word}.`));
    privateScopes.push(written.path.slice(0, written.path.lastIndexOf("/")));

    signedInAs = ownerId;
    expect((await loadMemory({ q: word })).total).toBe(1);

    signedInAs = otherId;
    const theirs = await loadMemory({ q: word }, undefined, written.path);
    expect(theirs.total).toBe(0);
    expect(theirs.memories).toHaveLength(0);
    expect(theirs.opened).toBeNull();
  });

  it("UC-55.1-07 a scope the person's grants do not reach is absent from the tree", async () => {
    const { loadMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const everything = await loadMemory();

    // Somebody whose memory grants are scoped rather than organisation-wide.
    const limited = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'memory:read' and rp.effect = 'Allow'
         and p.status = 'Active' and ra.scope_type = 'OrgUnit'
       order by ra.person_id limit 1`,
    );
    if (limited.rowCount === 0) return;
    signedInAs = limited.rows[0].id;
    const theirs = await loadMemory();
    expect(theirs.tree.length).toBeLessThanOrEqual(everything.tree.length);
  });

  it("memory_search reads the Active memory a run is in scope for, and nothing pending", async () => {
    const { searchForRun } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const active = await makeMemory();
    const pending = await makeMemory({ requiresReview: true });

    const found = await searchForRun("vendor list", 20);
    expect(found.map((one) => one.path)).toContain(active);
    // A proposal waiting for review is not something a run should act on.
    expect(found.map((one) => one.path)).not.toContain(pending);
  });

  /**
   * D68. The leak this closes: `memory_write` used to take a path, so everything a run
   * remembered landed in a scope shared by every person who used that agent, and the
   * next person's run read it back. No permission check saw it, because the permission
   * was the same person's either way.
   */
  it("D68 what one person's mission remembers is not readable in another person's mission", async () => {
    const { loadMemory, rememberForRun, searchForRun } = await import("@/features/memory/service");
    const { runAs } = await import("@/lib/session");
    const agent = { id: agentId, label: "exp" };
    const secret = `vendor-code-${Date.now().toString(36)}`;

    const written = await runAs(ownerId, agent, () => rememberForRun(`The owner prefers ${secret}.`));
    privateScopes.push(written.path.slice(0, written.path.lastIndexOf("/")));
    expect(written.path).toContain(ownerId);

    // The same agent, the same tool, a different person: the scope is not in the list the
    // query is built from, so there is nothing to filter out afterwards.
    const theirs = await runAs(otherId, agent, () => searchForRun(secret, 20));
    expect(theirs.map((one) => one.path)).not.toContain(written.path);

    const mine = await runAs(ownerId, agent, () => searchForRun(secret, 20));
    expect(mine.map((one) => one.path)).toContain(written.path);

    // And it is absent from the other person's console too, whatever their grants reach.
    signedInAs = otherId;
    const seen = await loadMemory();
    expect(seen.memories.map((memory) => memory.id)).not.toContain(written.path);
  });

  it("D68 room memory is read by the room's members and by nobody else", async () => {
    const { loadMemory } = await import("@/features/memory/service");
    const room = await testPool().query<{ path: string; memory: string }>(
      `select ms.path, m.path as memory from ai.memory_scope ms
       join ai.memory m on m.scope_id = ms.id where ms.kind = 'Session' limit 1`,
    );
    // A seed with no room memory cannot show the rule either way.
    if (room.rowCount === 0) return;

    const members = await testPool().query<{ id: string }>(
      `select rp.principal_id as id from work.room_participant rp
       join work.discussion_room r on r.id = rp.room_id
       join ai.memory_scope ms on ms.ref_id = r.id and ms.kind = 'Session'
       where ms.path = $1 and rp.principal_type = 'Person'`,
      [room.rows[0].path],
    );
    const memberIds = members.rows.map((person) => person.id);
    expect(memberIds.length).toBeGreaterThan(0);

    signedInAs = memberIds[0];
    const theirs = await loadMemory();
    expect(theirs.memories.map((memory) => memory.id)).toContain(room.rows[0].memory);

    // Somebody who may read memory organisation-wide but is not in the room. Membership
    // is the rule, not the org unit the room's project happens to sit under.
    const outsider = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
         join core.role r on r.id = ra.role_id
         join core.role_permission rp on rp.role_id = r.id
         join core.permission perm on perm.id = rp.permission_id
         join core.person p on p.id = ra.person_id
        where perm.code = 'memory:read' and rp.effect = 'Allow' and p.status = 'Active'
          and ra.person_id <> all($1::uuid[])
        order by ra.person_id limit 1`,
      [memberIds],
    );
    if (outsider.rowCount === 0) return;
    signedInAs = outsider.rows[0].id;
    const notTheirs = await loadMemory();
    expect(notTheirs.memories.map((memory) => memory.id)).not.toContain(room.rows[0].memory);
  });

  it("D68 a person clears their own agent memory and nobody else's", async () => {
    const { clearMyMemory, rememberForRun, searchForRun } = await import("@/features/memory/service");
    const { runAs } = await import("@/lib/session");
    const agent = { id: agentId, label: "exp" };
    const mark = `clear-case-${Date.now().toString(36)}`;

    const mine = await runAs(ownerId, agent, () => rememberForRun(`Owner note ${mark}.`));
    const theirs = await runAs(otherId, agent, () => rememberForRun(`Other note ${mark}.`));
    privateScopes.push(
      mine.path.slice(0, mine.path.lastIndexOf("/")),
      theirs.path.slice(0, theirs.path.lastIndexOf("/")),
    );

    signedInAs = ownerId;
    expect(await clearMyMemory()).toBeGreaterThan(0);

    expect((await runAs(ownerId, agent, () => searchForRun(mark, 20))).map((one) => one.path)).not.toContain(mine.path);
    // The call names nobody, so there is no way for it to have reached the other person's.
    expect((await runAs(otherId, agent, () => searchForRun(mark, 20))).map((one) => one.path)).toContain(theirs.path);
  });

  it("D68 a run remembers only into its own scope, and no argument moves it", async () => {
    const { MemoryRejected, rememberForRun, saveMemory } = await import("@/features/memory/service");
    const { runAs } = await import("@/lib/session");
    const agent = { id: agentId, label: "exp" };

    // `memory_write` has no scope or path argument at all: the only thing a run can send
    // is what to remember.
    const written = await runAs(ownerId, agent, () => rememberForRun("Something worth keeping."));
    privateScopes.push(written.path.slice(0, written.path.lastIndexOf("/")));
    expect(written.path).toBe(`agent/${agentId}/person/${ownerId}/remembered`);

    // A second write is a second version of the same memory, not a second memory.
    const again = await runAs(ownerId, agent, () => rememberForRun("And one more thing."));
    expect(again.path).toBe(written.path);
    expect(again.version).toBe(written.version + 1);

    // The path-taking write is still there for the console, and it refuses a path in
    // somebody else's private scope.
    const foreign = await runAs(otherId, agent, () => rememberForRun("Theirs."));
    privateScopes.push(foreign.path.slice(0, foreign.path.lastIndexOf("/")));
    signedInAs = ownerId;
    await expect(
      saveMemory({ path: foreign.path, content: "Mine now.", changeNote: "Taking it.", version: 1 }),
    ).rejects.toBeInstanceOf(MemoryRejected);
  });

  it("D68 D18 an agent never decides a review, and never its own proposal", async () => {
    const { MemoryRejected, loadMemory, reviewMemory } = await import("@/features/memory/service");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    const path = await makeMemory({ requiresReview: true });

    // The newest version now reads as an agent's proposal, which is what a run writing
    // into a reviewed scope leaves behind.
    await testPool().query(
      `update ai.memory_version set created_by_type = 'Agent', created_by_id = $2
        where memory_id = (select id from ai.memory where path = $1)`,
      [path, agentId],
    );

    // A person may still decide it — that is what the review is for.
    signedInAs = otherId;
    expect((await loadMemory()).memories.find((memory) => memory.id === path)?.mayReview).toBe(true);

    // The agent may not, whoever proposed it. Before this, an `Agent` proposer was not
    // recognised at all, so the separation-of-duties check passed unconditionally.
    const agent = { id: agentId, label: "exp" };
    await expect(
      runAs(otherId, agent, () => reviewMemory({ path, decision: "Approved" })),
    ).rejects.toBeInstanceOf(MemoryRejected);
  });

  it("deleting a memory removes it with its versions and its review", async () => {
    const { deleteMemory } = await import("@/features/memory/service");
    signedInAs = ownerId;
    const path = await makeMemory({ requiresReview: true });
    const memory = await testPool().query<{ id: string }>("select id from ai.memory where path = $1", [path]);
    const memoryId = memory.rows[0].id;
    // An undecided review of it, so the cascade has something to remove.
    await testPool().query("insert into ai.memory_review (memory_id) values ($1)", [memoryId]);

    await deleteMemory(path);

    expect((await testPool().query("select 1 from ai.memory where id = $1", [memoryId])).rowCount).toBe(0);
    expect((await testPool().query("select 1 from ai.memory_version where memory_id = $1", [memoryId])).rowCount).toBe(0);
    expect((await testPool().query("select 1 from ai.memory_review where memory_id = $1", [memoryId])).rowCount).toBe(0);
  });

  it("refuses to delete a memory that is gone, or for a person without memory:write", async () => {
    const { MemoryRejected, deleteMemory } = await import("@/features/memory/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    await expect(deleteMemory(`${scopePath}/no-such-memory-anywhere`)).rejects.toBeInstanceOf(MemoryRejected);

    const path = await makeMemory();
    const member = await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'");
    signedInAs = member.rows[0].id;
    await expect(deleteMemory(path)).rejects.toBeInstanceOf(NotPermitted);
    expect((await testPool().query("select 1 from ai.memory where path = $1", [path])).rowCount).toBe(1);
  });
});
