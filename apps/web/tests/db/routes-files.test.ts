import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `GET /api/files`, the bytes behind a file's preview or download (`UC-32.1-02`,
 * `UC-33.1-08`). The file row and the object store are real: the bytes are put in the store
 * here and read back through the route, so what is checked is what a browser receives.
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

describe.skipIf(!hasDatabase)("GET /api/files", () => {
  let ownerId = "";
  /** A Member, who may read files but not one only its uploader may see. */
  let memberId = "";
  /** An Agent Designer, who holds no `files:read`. */
  let designerId = "";
  const stamp = Date.now().toString(36);
  // A quote in the name, which must not end the content-disposition header early.
  const name = `route "preview" ${stamp}.pdf`;
  const bytes = new TextEncoder().encode(`%PDF-1.7 the bytes of ${stamp}`);
  let reference = "";

  beforeAll(async () => {
    const idOf = async (email: string) =>
      (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;
    ownerId = await idOf("mariam@tahseel.ae");
    memberId = await idOf("layla@tahseel.ae");
    designerId = await idOf("omar@tahseel.ae");

    const { buckets, putObject } = await import("@/lib/objects");
    reference = await putObject(buckets.files, `route-tests/${stamp}.pdf`, bytes, "application/octet-stream");
    await testPool().query(
      `insert into work.project_file (project_id, name, content_ref, size, mime_type, uploaded_by, scope_of_use, status, created_by, updated_by)
       select p.id, $1, $2, $3, 'application/pdf', $4, 'OnlyMe', 'Active', $4, $4
       from work.project p order by p.key limit 1`,
      [name, reference, bytes.byteLength, ownerId],
    );
  });

  afterAll(async () => {
    await testPool().query("delete from work.project_file where name = $1", [name]);
    const { deleteObject } = await import("@/lib/objects");
    if (reference) await deleteObject(reference);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const read = async (query: string) => {
    const { GET } = await import("@/app/api/files/route");
    return GET(new Request(`http://console.awp.test/api/files?${query}`));
  };

  it("UC-32.1-02 serves the stored bytes inline, with the row's type and the object's length, uncached", async () => {
    signedInAs = ownerId;

    const response = await read(new URLSearchParams({ name }).toString());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="route preview ${stamp}.pdf"; filename*=UTF-8''route%20preview%20${stamp}.pdf`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("UC-33.1-08 asks the browser to save the file when the download is asked for", async () => {
    signedInAs = ownerId;

    const response = await read(new URLSearchParams({ name, download: "1" }).toString());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="route preview ${stamp}.pdf"; filename*=UTF-8''route%20preview%20${stamp}.pdf`,
    );
    await response.body?.cancel();
  });

  it("answers 400 when no file is named", async () => {
    signedInAs = ownerId;

    const response = await read("");

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Name the file.");
  });

  it("UC-32.1-07 answers 403 to a reader outside the file's scope of use", async () => {
    signedInAs = memberId;

    const response = await read(new URLSearchParams({ name }).toString());

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("That file is not yours to read.");
  });

  it("answers 403 to an attachment asked for without the item it is on", async () => {
    signedInAs = ownerId;

    const response = await read(new URLSearchParams({ name, kind: "attachment", ownerType: "WorkItem" }).toString());

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("An attachment is read through the item it is on.");
  });

  it("COM-07 answers 403 to a person who may not read files at all", async () => {
    signedInAs = designerId;

    const response = await read(new URLSearchParams({ name }).toString());

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("You may not read files.");
  });
});
