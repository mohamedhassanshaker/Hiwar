import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `GET /api/comments/capture`, the captured card area attached to a comment (handoff v2
 * section 5.1). The comment is posted through the service with a capture, which puts the
 * bytes in the real object store, and the route is asked for them back.
 */

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-pathname": "/dashboard" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("GET /api/comments/capture", () => {
  let authorId = "";
  let readerId = "";
  /** A card with no thread yet when one is free, so the whole thread is this suite's. */
  let card: "runs" | "tasks" | "attention" | "live" = "live";
  let threadExisted = false;
  let savedReads: { thread_id: string; person_id: string; last_read_at: Date }[] = [];
  const comments: string[] = [];
  const captureBytes = Buffer.from(`a captured card area ${Date.now()}`);
  let withCapture = "";
  let withoutCapture = "";
  let captureRef = "";

  beforeAll(async () => {
    const idOf = async (email: string) =>
      (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;
    authorId = await idOf("mariam@tahseel.ae");
    readerId = await idOf("layla@tahseel.ae");

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

    const { postComment } = await import("@/features/comments/service");
    signedInAs = authorId;
    withCapture = await postComment({
      card,
      body: "This number looks wrong.",
      mentions: [],
      capture: `data:image/jpeg;base64,${captureBytes.toString("base64")}`,
    });
    withoutCapture = await postComment({ card, body: "No picture here.", mentions: [] });
    comments.push(withCapture, withoutCapture);
    const stored = await testPool().query<{ capture_ref: string }>("select capture_ref from work.card_comment where id = $1", [withCapture]);
    captureRef = stored.rows[0].capture_ref;
    signedInAs = "";
  });

  afterAll(async () => {
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
      await testPool().query("delete from work.card_comment_thread where card_id = $1", [card]);
    }
    const { deleteObject } = await import("@/lib/objects");
    if (captureRef) await deleteObject(captureRef);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const read = async (query: string) => {
    const { GET } = await import("@/app/api/comments/capture/route");
    return GET(new Request(`http://console.awp.test/api/comments/capture?${query}`));
  };

  it("serves the capture's bytes to anyone signed in, as the stored JPEG, uncached", async () => {
    // A thread is shared by everybody who can open the dashboard, so the reader is not the author.
    signedInAs = readerId;

    const response = await read(`comment=${withCapture}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe(String(captureBytes.byteLength));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(captureBytes);
  });

  it("answers 400 when no comment is named", async () => {
    signedInAs = readerId;

    const response = await read("");

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Name the comment.");
  });

  it("answers 404 for a comment with no capture, and for one that does not exist", async () => {
    signedInAs = readerId;

    for (const commentId of [withoutCapture, "00000000-0000-4000-8000-0000000000bb"]) {
      const response = await read(`comment=${commentId}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("No capture.");
    }
  });

  it("answers 404 when the capture's object is no longer in the store", async () => {
    signedInAs = readerId;
    const missing = `attachments/card-comments/${card}/route-tests-missing-${Date.now()}.jpg`;
    await testPool().query("update work.card_comment set capture_ref = $1 where id = $2", [missing, withoutCapture]);
    try {
      const response = await read(`comment=${withoutCapture}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("No capture.");
    } finally {
      await testPool().query("update work.card_comment set capture_ref = null where id = $1", [withoutCapture]);
    }
  });

  it("COM-09 sends a caller with no session to sign in rather than serving the bytes", async () => {
    signedInAs = "";

    // `redirect()` throws, and the App Router turns the throw into the redirect response.
    await expect(read(`comment=${withCapture}`)).rejects.toMatchObject({
      digest: expect.stringContaining(`;/sign-in?next=${encodeURIComponent("/dashboard")};`),
    });
  });
});
