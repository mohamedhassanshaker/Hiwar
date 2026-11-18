import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * Comment threads on the dashboard cards against the database.
 *
 * A thread is one per card and shared by everybody, so these follow one card's thread from
 * the first comment through reading, editing, deleting and raising a task, as two people:
 * the author and somebody they name.
 */

let signedInAs = "";

// Who was told their Inbox changed; the rest of the live path is left as it is.
const live = vi.hoisted(() => ({ notifyInbox: vi.fn<(personId: string, reason: string) => Promise<void>>(async () => undefined) }));
vi.mock("@/lib/live", async (importOriginal) => ({ ...(await importOriginal<object>()), notifyInbox: live.notifyInbox }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("comments", () => {
  let authorId = "";
  let readerId = "";
  let designerId = "";
  let projectKey = "";
  /** The card the cases write on: one with no thread yet, so the whole thread is theirs. */
  let card: "runs" | "tasks" | "attention" | "live" = "live";
  let threadExisted = false;
  const comments: string[] = [];
  const workItems: string[] = [];
  let savedReads: { thread_id: string; person_id: string; last_read_at: Date }[] = [];

  const idOf = async (email: string) =>
    (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;

  beforeAll(async () => {
    authorId = await idOf("mariam@tahseel.ae");
    // A Member, who may write work items and is named in the author's comments.
    readerId = await idOf("layla@tahseel.ae");
    // An Agent Designer, who may not write work items.
    designerId = await idOf("omar@tahseel.ae");
    const project = await testPool().query<{ key: string }>(
      "select key from work.project where status not in ('Paused', 'Archived') order by key limit 1",
    );
    projectKey = project.rows[0].key;

    const threads = await testPool().query<{ card_id: string }>("select card_id from work.card_comment_thread");
    const taken = new Set(threads.rows.map((row) => row.card_id));
    const free = (["live", "attention", "tasks", "runs"] as const).find((one) => !taken.has(one));
    card = free ?? "live";
    threadExisted = free === undefined;
    if (threadExisted) {
      const reads = await testPool().query<{ thread_id: string; person_id: string; last_read_at: Date }>(
        `select r.thread_id, r.person_id, r.last_read_at from work.card_comment_read r
         join work.card_comment_thread t on t.id = r.thread_id where t.card_id = $1`,
        [card],
      );
      savedReads = reads.rows;
    }
  });

  afterAll(async () => {
    if (workItems.length > 0) {
      // A capture copied onto a work item is its own object and its own attachment row.
      const copied = await testPool().query<{ id: string; content_ref: string }>(
        `delete from work.attachment where owner_type = 'WorkItem'
           and owner_id in (select id from work.work_item where key = any($1)) returning id, content_ref`,
        [workItems],
      );
      const { deleteObject } = await import("@/lib/objects");
      for (const row of copied.rows) await deleteObject(row.content_ref);
      await testPool().query("update work.card_comment set work_item_id = null where id = any($1)", [comments]);
      await testPool().query(
        "delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = any($1))",
        [workItems],
      );
      await testPool().query("delete from work.work_item where key = any($1)", [workItems]);
    }
    if (threadExisted) {
      await testPool().query("delete from work.card_comment where id = any($1)", [comments]);
      const thread = await testPool().query<{ id: string }>("select id from work.card_comment_thread where card_id = $1", [card]);
      await testPool().query("delete from work.card_comment_read where thread_id = $1", [thread.rows[0].id]);
      for (const read of savedReads) {
        await testPool().query(
          "insert into work.card_comment_read (thread_id, person_id, last_read_at) values ($1, $2, $3)",
          [read.thread_id, read.person_id, read.last_read_at],
        );
      }
    } else {
      // The thread did not exist before, so everything hanging off it goes with it.
      await testPool().query("delete from work.card_comment_thread where card_id = $1", [card]);
    }
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const post = async (body: string, mentions: string[] = []) => {
    const { postComment } = await import("@/features/comments/service");
    const id = await postComment({ card, body, mentions });
    comments.push(id);
    return id;
  };

  it("an empty comment with no capture is refused", async () => {
    const { CommentRejected, postComment } = await import("@/features/comments/service");
    signedInAs = authorId;
    await expect(postComment({ card, body: "", mentions: [] })).rejects.toBeInstanceOf(CommentRejected);
  });

  it("a comment names only real, active people other than its author, and is unread for them alone", async () => {
    const { loadThread, loadThreads, unreadByCard } = await import("@/features/comments/service");
    signedInAs = authorId;
    const id = await post("Can somebody look at the failed runs?", [
      readerId,
      authorId,
      "00000000-0000-4000-8000-0000000000aa",
    ]);

    const named = await testPool().query<{ person_id: string }>(
      "select person_id from work.card_comment_mention where comment_id = $1",
      [id],
    );
    expect(named.rows.map((row) => row.person_id)).toEqual([readerId]);

    // The author's own comment is never unread for them.
    expect((await unreadByCard())[card]).toBeUndefined();
    const own = await loadThread({ card });
    expect(own.unread).toBe(false);

    signedInAs = readerId;
    expect((await unreadByCard())[card]).toBe(1);
    const thread = await loadThread({ card });
    expect(thread).toMatchObject({ card, unread: true, unreadCount: 1 });
    const comment = thread.comments.find((one) => one.id === id);
    expect(comment).toMatchObject({
      authorId,
      bodyText: "Can somebody look at the failed runs?",
      mentions: [readerId],
      captureUrl: null,
      deletedAt: null,
      task: null,
    });
    expect((await loadThreads()).map((one) => one.card)).toContain(card);
  });

  it("reading the thread clears its unread count", async () => {
    const { loadThread, markRead, unreadByCard } = await import("@/features/comments/service");
    signedInAs = authorId;
    await post("One more for you.");

    signedInAs = readerId;
    expect((await unreadByCard())[card]).toBeGreaterThan(0);
    await markRead({ card });
    expect((await unreadByCard())[card]).toBeUndefined();
    expect((await loadThread({ card })).unreadCount).toBe(0);
  });

  it("the people a comment may name are the active people other than the asker", async () => {
    const { mentionable } = await import("@/features/comments/service");
    signedInAs = authorId;
    const active = await testPool().query<{ id: string }>(
      "select id from core.person where status = 'Active' and id <> $1 order by id",
      [authorId],
    );

    const offered = await mentionable();
    expect(offered.map((one) => one.id).sort()).toEqual(active.rows.map((row) => row.id).sort());
  });

  it("only the author edits a comment, and editing replaces whom it names", async () => {
    const { CommentRejected, editComment } = await import("@/features/comments/service");
    signedInAs = authorId;
    const id = await post("First words", [readerId]);

    await editComment({ commentId: id, body: "Second words", mentions: [] });
    const row = await testPool().query<{ body_text: string; edited_at: Date | null; mentions: number }>(
      `select body_text, edited_at,
              (select count(*)::int from work.card_comment_mention m where m.comment_id = c.id) as mentions
       from work.card_comment c where c.id = $1`,
      [id],
    );
    expect(row.rows[0]).toMatchObject({ body_text: "Second words", mentions: 0 });
    expect(row.rows[0].edited_at).not.toBeNull();

    signedInAs = readerId;
    await expect(editComment({ commentId: id, body: "Not mine", mentions: [] })).rejects.toBeInstanceOf(CommentRejected);
    const after = await testPool().query<{ body_text: string }>("select body_text from work.card_comment where id = $1", [id]);
    expect(after.rows[0].body_text).toBe("Second words");
  });

  it("an edit that names somebody new tells them, and the comment is unread for them until they read it", async () => {
    const { editComment, loadThread, markRead, unreadByCard } = await import("@/features/comments/service");
    signedInAs = authorId;
    const id = await post("Somebody should check the totals.", [designerId]);

    signedInAs = readerId;
    await markRead({ card });
    expect((await loadThread({ card })).unreadCount).toBe(0);

    signedInAs = authorId;
    live.notifyInbox.mockClear();
    await editComment({ commentId: id, body: "Layla, please check the totals.", mentions: [readerId, designerId] });
    // Only the person named for the first time; the designer was named before and after.
    expect(live.notifyInbox.mock.calls).toEqual([[readerId, "comment"]]);

    // The comment is older than the reader's read marker, and is unread because it now names them.
    signedInAs = readerId;
    expect((await loadThread({ card })).unreadCount).toBe(1);
    expect((await unreadByCard())[card]).toBe(1);

    await markRead({ card });
    expect((await loadThread({ card })).unreadCount).toBe(0);
    expect((await unreadByCard())[card]).toBeUndefined();
  });

  it("only the author deletes a comment, which keeps its place in the thread without its words", async () => {
    const { CommentRejected, deleteComment, editComment, loadThread } = await import("@/features/comments/service");
    signedInAs = authorId;
    const id = await post("Delete me");

    signedInAs = readerId;
    await expect(deleteComment(id)).rejects.toBeInstanceOf(CommentRejected);

    signedInAs = authorId;
    await deleteComment(id);
    const comment = (await loadThread({ card })).comments.find((one) => one.id === id);
    expect(comment?.bodyText).toBe("");
    expect(comment?.deletedAt).not.toBeNull();
    // Gone is gone: neither a second delete nor an edit finds it.
    await expect(deleteComment(id)).rejects.toBeInstanceOf(CommentRejected);
    await expect(editComment({ commentId: id, body: "Back", mentions: [] })).rejects.toBeInstanceOf(CommentRejected);
  });

  it("a capture is offered only while its comment exists and has one", async () => {
    const { deleteComment, readCapture } = await import("@/features/comments/service");
    signedInAs = authorId;
    const plain = await post("No picture here");
    expect(await readCapture(plain)).toBeNull();
    expect(await readCapture("00000000-0000-4000-8000-0000000000bb")).toBeNull();

    // A stored capture, as `putObject` would have referenced it.
    const ref = "attachments/card-comments/test/capture.jpg";
    await testPool().query("update work.card_comment set capture_ref = $1 where id = $2", [ref, plain]);
    expect(await readCapture(plain)).toEqual({ ref });

    await deleteComment(plain);
    expect(await readCapture(plain)).toBeNull();
  });

  it("Make it a task raises one work item per comment, assigned and linked back to it", async () => {
    const { CommentRejected, loadThread, makeTask } = await import("@/features/comments/service");
    signedInAs = authorId;
    const id = await post("The vendor list is out of date.");

    const key = await makeTask({ commentId: id, title: "Refresh the vendor list", assignee: readerId, priority: "High", dueAt: "2026-11-02", projectKey });
    workItems.push(key);

    const item = await testPool().query<{
      status: string;
      assignee_id: string;
      origin_type: string;
      origin_id: string;
      description_en: string;
      due_at: Date;
    }>("select status, assignee_id, origin_type, origin_id, description_en, due_at from work.work_item where key = $1", [key]);
    expect(item.rows[0]).toMatchObject({
      status: "ToDo",
      assignee_id: readerId,
      origin_type: "Comment",
      origin_id: id,
      description_en: "The vendor list is out of date.",
    });
    expect(item.rows[0].due_at.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect((await loadThread({ card })).comments.find((one) => one.id === id)?.task).toEqual({ key, status: "ToDo" });

    await expect(makeTask({ commentId: id, title: "Again", priority: "Low", projectKey })).rejects.toBeInstanceOf(CommentRejected);
  });

  it("Make it a task copies the comment's capture onto the work item, which keeps it when the comment goes", async () => {
    const { deleteComment, makeTask, postComment } = await import("@/features/comments/service");
    const { loadWorkItem } = await import("@/features/work-items/service");
    signedInAs = authorId;
    const captureBytes = Buffer.from(`a captured card area ${Date.now()}`);
    const id = await postComment({
      card,
      body: "This total is wrong.",
      mentions: [],
      capture: `data:image/jpeg;base64,${captureBytes.toString("base64")}`,
    });
    comments.push(id);
    const commentCapture = (await testPool().query<{ capture_ref: string }>("select capture_ref from work.card_comment where id = $1", [id]))
      .rows[0].capture_ref;

    const key = await makeTask({ commentId: id, title: "Fix the total", priority: "Medium", projectKey });
    workItems.push(key);

    const attached = await testPool().query<{ file_name: string; mime_type: string; size: number; content_ref: string; uploaded_by: string }>(
      `select a.file_name, a.mime_type, a.size, a.content_ref, a.uploaded_by from work.attachment a
       join work.work_item w on w.id = a.owner_id where a.owner_type = 'WorkItem' and w.key = $1`,
      [key],
    );
    expect(attached.rows).toHaveLength(1);
    expect(attached.rows[0]).toMatchObject({ mime_type: "image/jpeg", size: captureBytes.byteLength, uploaded_by: authorId });
    // A copy of its own, not the comment's object, so deleting the comment cannot take it.
    expect(attached.rows[0].content_ref).not.toBe(commentCapture);

    await deleteComment(id);
    expect((await loadWorkItem(key))?.detail.attachments.map(([name]) => name)).toContain(attached.rows[0].file_name);
    // The deleted comment no longer points at its capture, so nothing else removes it.
    const { deleteObject } = await import("@/lib/objects");
    await deleteObject(commentCapture);
  });

  it("Make it a task leaves an unassigned task in the backlog, and refuses a missing comment or assignee", async () => {
    const { CommentRejected, deleteComment, makeTask } = await import("@/features/comments/service");
    signedInAs = authorId;
    const id = await post("Someone should take this.");

    await expect(
      makeTask({ commentId: id, title: "Nobody", assignee: "00000000-0000-4000-8000-0000000000cc", priority: "Low", projectKey }),
    ).rejects.toBeInstanceOf(CommentRejected);
    await expect(
      makeTask({ commentId: "00000000-0000-4000-8000-0000000000dd", title: "Nothing", priority: "Low", projectKey }),
    ).rejects.toBeInstanceOf(CommentRejected);

    const key = await makeTask({ commentId: id, title: "Take this", priority: "Low", projectKey });
    workItems.push(key);
    const item = await testPool().query<{ status: string; assignee_id: string | null }>(
      "select status, assignee_id from work.work_item where key = $1",
      [key],
    );
    expect(item.rows[0]).toEqual({ status: "Backlog", assignee_id: null });

    const gone = await post("Deleted before anyone raised it.");
    await deleteComment(gone);
    await expect(makeTask({ commentId: gone, title: "Too late", priority: "Low", projectKey })).rejects.toBeInstanceOf(CommentRejected);
  });

  it("raising a task needs work_items:write, which decides whether the offer shows", async () => {
    const { makeTask, mayRaiseTasks } = await import("@/features/comments/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = authorId;
    const id = await post("For the designer.");
    expect(await mayRaiseTasks()).toBe(true);

    signedInAs = designerId;
    expect(await mayRaiseTasks()).toBe(false);
    await expect(makeTask({ commentId: id, title: "Not allowed", priority: "Low", projectKey })).rejects.toBeInstanceOf(NotPermitted);
    const linked = await testPool().query<{ work_item_id: string | null }>("select work_item_id from work.card_comment where id = $1", [id]);
    expect(linked.rows[0].work_item_id).toBeNull();
  });

  it("finishing a task raised from a comment says so in the thread it came from", async () => {
    const { loadThread, makeTask, noteTaskDone } = await import("@/features/comments/service");
    signedInAs = authorId;
    const id = await post("Close the loop on this.");
    const key = await makeTask({ commentId: id, title: "Close the loop", priority: "Low", projectKey });
    workItems.push(key);
    const item = await testPool().query<{ id: string }>("select id from work.work_item where key = $1", [key]);

    const before = (await loadThread({ card })).comments.length;
    await noteTaskDone(item.rows[0].id, key, "Close the loop", readerId);
    const thread = await loadThread({ card });
    expect(thread.comments).toHaveLength(before + 1);
    const note = thread.comments[thread.comments.length - 1];
    comments.push(note.id);
    expect(note).toMatchObject({ authorId: readerId, bodyText: `Marked task ${key} as done: Close the loop` });

    // A work item that came from nowhere has no thread to tell.
    await noteTaskDone("00000000-0000-4000-8000-0000000000ee", "TSK-0", "Nothing", readerId);
    expect((await loadThread({ card })).comments).toHaveLength(before + 1);
  });
});
