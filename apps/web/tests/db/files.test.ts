import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-32 artifacts and S-33 project files, against the database.
 *
 * A file's scope of use is what the platform hands to agents as context, so these follow it
 * through the read model rather than through a screen: a file filtered out on the client is
 * a file that was still sent.
 */

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
/**
 * The object store lives in the cluster; here it is a map, so a read can be checked against
 * what the write put there rather than against a fixed string.
 */
const stored = new Map<string, { bytes: Uint8Array; contentType: string }>();
vi.mock("@/lib/objects", () => ({
  buckets: { files: "files", artifacts: "artifacts", attachments: "attachments" },
  objectStoreConfigured: () => true,
  putObject: async (bucket: string, key: string, bytes: Uint8Array, contentType: string) => {
    stored.set(`${bucket}/${key}`, { bytes, contentType });
    return `${bucket}/${key}`;
  },
  deleteObject: async (reference: string) => {
    stored.delete(reference);
  },
  getObject: async (reference: string) => {
    const object = stored.get(reference) ?? { bytes: new TextEncoder().encode("the bytes"), contentType: "application/pdf" };
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(object.bytes);
          controller.close();
        },
      }),
      contentType: object.contentType,
      size: object.bytes.byteLength,
    };
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("artifacts and files", () => {
  let ownerId = "";
  let otherId = "";
  let projectKey = "";
  const files: string[] = [];

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    // Someone else who may read files at all, so the scope is what decides, not the role.
    const other = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'files:read' and rp.effect = 'Allow'
         and p.status = 'Active' and p.email <> 'mariam@tahseel.ae'
       order by ra.person_id limit 1`,
    );
    otherId = other.rows[0]?.id ?? "";
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    projectKey = project.rows[0].key;
  });

  afterEach(async () => {
    if (files.length > 0) {
      await testPool().query(
        "delete from work.file_access_grant where file_id in (select id from work.project_file where name = any($1))",
        [files],
      );
      await testPool().query("delete from work.project_file where name = any($1)", [files]);
      files.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-25.1-03 a picker finds the files a person may read, and never one scoped to somebody else", async () => {
    const { searchHeld } = await import("@/features/files/service");
    signedInAs = ownerId;
    const stamp = Date.now().toString(36);
    const mine = `held-mine-${stamp}.pdf`;
    const theirs = `held-theirs-${stamp}.pdf`;
    files.push(mine, theirs);
    const project = await testPool().query<{ id: string }>("select id from work.project where key = $1", [projectKey]);
    await testPool().query(
      `insert into work.project_file (project_id, name, content_ref, size, mime_type, scope_of_use, uploaded_by, status)
       values ($1, $2, 'files/held-mine', 9, 'application/pdf', 'AllProject', $3, 'Active'),
              ($1, $4, 'files/held-theirs', 9, 'application/pdf', 'OnlyMe', $5, 'Active')`,
      [project.rows[0].id, mine, ownerId, theirs, otherId],
    );

    const found = (await searchHeld({ kind: "File", q: "held-" })).map((item) => item.name);
    const named = (await searchHeld({ kind: "File", q: stamp })).map((item) => item.name);
    expect(named).toContain(mine);
    expect(named).not.toContain(theirs);
    expect(found).not.toContain(theirs);
  });

  it("UC-25.1-03 a picker matches its search text literally", async () => {
    const { searchHeld } = await import("@/features/files/service");
    signedInAs = ownerId;
    const stamp = Date.now().toString(36);
    const name = `held-literal-${stamp}.pdf`;
    files.push(name);
    const project = await testPool().query<{ id: string }>("select id from work.project where key = $1", [projectKey]);
    await testPool().query(
      `insert into work.project_file (project_id, name, content_ref, size, mime_type, scope_of_use, uploaded_by, status)
       values ($1, $2, 'files/held-literal', 9, 'application/pdf', 'AllProject', $3, 'Active')`,
      [project.rows[0].id, name, ownerId],
    );

    expect((await searchHeld({ kind: "File", q: `held-literal-${stamp}` })).map((item) => item.name)).toContain(name);
    // `%` and `_` stand for themselves, so they match no other character of the name.
    expect(await searchHeld({ kind: "File", q: `held%literal-${stamp}` })).toEqual([]);
    expect(await searchHeld({ kind: "File", q: `held_literal-${stamp}` })).toEqual([]);
  });

  it("UC-25.1-03 attaching a held file copies it onto the request, and one the person may not read is refused", async () => {
    const { attachHeld, FileRejected } = await import("@/features/files/service");
    signedInAs = ownerId;
    const stamp = Date.now().toString(36);
    const readable = `attach-held-${stamp}.pdf`;
    const unreadable = `attach-hidden-${stamp}.pdf`;
    files.push(readable, unreadable);
    const project = await testPool().query<{ id: string }>("select id from work.project where key = $1", [projectKey]);
    stored.set("files/attach-held", { bytes: new TextEncoder().encode("%PDF held"), contentType: "application/pdf" });
    const rows = await testPool().query<{ id: string; name: string }>(
      `insert into work.project_file (project_id, name, content_ref, size, mime_type, scope_of_use, uploaded_by, status)
       values ($1, $2, 'files/attach-held', 9, 'application/pdf', 'AllProject', $3, 'Active'),
              ($1, $4, 'files/attach-hidden', 9, 'application/pdf', 'OnlyMe', $5, 'Active')
       returning id, name`,
      [project.rows[0].id, readable, ownerId, unreadable, otherId],
    );
    const id = (name: string) => rows.rows.find((row) => row.name === name)!.id;
    const request = await testPool().query<{ key: string }>(
      "select r.key from work.request r join work.project p on p.id = r.project_id where p.key = $1 order by r.key limit 1",
      [projectKey],
    );
    const ownerKey = request.rows[0].key;

    expect(await attachHeld({ ownerType: "Request", ownerKey, kind: "File", id: id(readable) })).toEqual({ name: readable });
    const attachment = await testPool().query<{ content_ref: string }>(
      `select a.content_ref from work.attachment a join work.request r on r.id = a.owner_id
       where a.owner_type = 'Request' and r.key = $1 and a.file_name = $2`,
      [ownerKey, readable],
    );
    // A copy of its own: the attachment outlives the file it came from.
    expect(attachment.rows[0].content_ref).toBe(`attachments/${ownerKey}/${readable}`);
    expect(stored.get(attachment.rows[0].content_ref)?.bytes).toEqual(new TextEncoder().encode("%PDF held"));

    await expect(attachHeld({ ownerType: "Request", ownerKey, kind: "File", id: id(unreadable) })).rejects.toBeInstanceOf(FileRejected);
    const none = await testPool().query("select 1 from work.attachment where file_name = $1", [unreadable]);
    expect(none.rowCount).toBe(0);

    await testPool().query("delete from work.attachment where file_name = $1", [readable]);
  });

  /** The names the Files screen lists for whoever is signed in. */
  const loadFilesNames = async (): Promise<string[]> => {
    const { loadFiles } = await import("@/features/files/service");
    return (await loadFiles()).items.map((one) => one.n);
  };

  /** Writes a file straight into the project, so the scope rules can be read back. */
  const place = async (name: string, scope: string, grants: string[] = [], uploader = ownerId) => {
    const { rows } = await testPool().query<{ id: string }>(
      `insert into work.project_file (project_id, name, content_ref, size, mime_type, uploaded_by, scope_of_use, status, created_by, updated_by)
       select p.id, $1, 'test://file', 10, 'application/pdf', $2, $3, 'Active', $2, $2
       from work.project p where p.key = $4 returning id`,
      [name, uploader, scope, projectKey],
    );
    files.push(name);
    for (const grant of grants) {
      await testPool().query(
        "insert into work.file_access_grant (file_id, principal_type, principal_id) values ($1, 'Person', $2)",
        [rows[0].id, grant],
      );
    }
    return rows[0].id;
  };

  it("D349 the Files list is one page of what matches, newest first, counted with the same filters", async () => {
    const { loadFiles } = await import("@/features/files/service");
    const stamp = Date.now().toString(36);
    const oldest = `paged-${stamp}-ledger.pdf`;
    const middle = `paged-${stamp}-invoice.pdf`;
    const newest = `paged-${stamp}-receipt.pdf`;
    const theirs = `paged-${stamp}-private.pdf`;
    for (const name of [oldest, middle, newest]) await place(name, "AllProject");
    await place(theirs, "OnlyMe", [], otherId);
    // Newest first is by when a file was added, so the three are spaced apart.
    await testPool().query(
      `update work.project_file set created_at = now() - make_interval(mins => array_position($1::text[], name))
       where name = any($1)`,
      [[newest, middle, oldest]],
    );

    signedInAs = ownerId;
    // A word in the name finds the files, and another person's private file is never counted.
    const all = await loadFiles({ q: `paged-${stamp}` });
    expect(all.total).toBe(3);
    expect(all.items.map((item) => item.n)).toEqual([newest, middle, oldest]);

    // Page 2 continues where page 1 stopped, and the total is still the whole count.
    const first = await loadFiles({ q: `paged-${stamp}` }, { limit: 2, offset: 0 });
    const second = await loadFiles({ q: `paged-${stamp}` }, { limit: 2, offset: 2 });
    expect(first.items.map((item) => item.n)).toEqual([newest, middle]);
    expect(second.items.map((item) => item.n)).toEqual([oldest]);
    expect(second.total).toBe(3);

    // A narrower word narrows the total, and another project's key finds none of them.
    expect((await loadFiles({ q: `${stamp}-invoice` })).total).toBe(1);
    const other = await testPool().query<{ key: string }>("select key from work.project where key <> $1 order by key limit 1", [projectKey]);
    if (other.rowCount) expect((await loadFiles({ q: `paged-${stamp}`, project: other.rows[0].key })).total).toBe(0);
    expect((await loadFiles({ q: `paged-${stamp}`, project: projectKey })).total).toBe(3);
  });

  it("D349 the Artifacts list is one page of what matches, newest first, with what each links to", async () => {
    const { loadArtifacts } = await import("@/features/files/service");
    const stamp = Date.now().toString(36);
    const names = [`artefact-${stamp}-one`, `artefact-${stamp}-two`, `artefact-${stamp}-three`];
    try {
      await testPool().query(
        `insert into work.artifact (project_id, name_en, name_ar, produced_by_type, produced_by_id, status, created_at)
         select p.id, n.name, n.name, 'Person', $2, 'Active', now() - make_interval(mins => n.ord::int)
         from work.project p, unnest($1::text[]) with ordinality as n(name, ord) where p.key = $3`,
        [names, ownerId, projectKey],
      );
      signedInAs = ownerId;
      const all = await loadArtifacts({ q: `artefact-${stamp}` });
      expect(all.total).toBe(3);
      expect(all.items.map((item) => item.n)).toEqual(names);
      const second = await loadArtifacts({ q: `artefact-${stamp}` }, { limit: 2, offset: 2 });
      expect(second.items.map((item) => item.n)).toEqual([names[2]]);
      expect(second.total).toBe(3);
      expect((await loadArtifacts({ q: `${stamp}-two` })).items.map((item) => item.n)).toEqual([names[1]]);
    } finally {
      await testPool().query("delete from work.artifact where name_en = any($1)", [names]);
    }
  });

  it("UC-33.1-01 a file scoped to only me is listed to me and to nobody else", async () => {
    const { loadFiles } = await import("@/features/files/service");
    await place("only-me-for-the-tests.pdf", "OnlyMe");

    signedInAs = ownerId;
    expect((await loadFiles()).items.map((item) => item.n)).toContain("only-me-for-the-tests.pdf");

    // Not hidden on the screen: it is never selected, so it never reaches the browser.
    signedInAs = otherId;
    expect((await loadFiles()).items.map((item) => item.n)).not.toContain("only-me-for-the-tests.pdf");
  });

  it("UC-33.1-02 UC-33.1-03 Selected reaches exactly who is named, and All reaches the project", async () => {
    const { loadFiles } = await import("@/features/files/service");
    await place("selected-for-the-tests.pdf", "Selected", [otherId]);
    await place("all-project-for-the-tests.pdf", "AllProject");

    signedInAs = otherId;
    const theirs = (await loadFiles()).items.map((item) => item.n);
    expect(theirs).toContain("selected-for-the-tests.pdf");
    expect(theirs).toContain("all-project-for-the-tests.pdf");

    // Somebody not named by the grant does not see the Selected one.
    const third = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'files:read' and rp.effect = 'Allow'
         and p.status = 'Active' and ra.person_id <> $1 and ra.person_id <> $2
       order by ra.person_id limit 1`,
      [ownerId, otherId],
    );
    if (third.rowCount === 0) return;
    signedInAs = third.rows[0].id;
    const { loadDirectory } = await import("@/features/organisation/service");
    const others = (await loadFiles()).items.map((item) => item.n);
    // The grant is what they are missing, so the named file is not theirs to read.
    expect(others).not.toContain("selected-for-the-tests.pdf");
    // "All project" is everyone in the project, which is a narrower set than everyone.
    const reaches = (await loadDirectory()).projects.some((project) => project.k === projectKey);
    expect(others.includes("all-project-for-the-tests.pdf")).toBe(reaches);
  });

  it("UC-33.1-06 an agent outside the scope is refused, and the refusal is recorded", async () => {
    const { mayReadFile } = await import("@/features/files/service");
    signedInAs = ownerId;
    await place("agent-scope-for-the-tests.pdf", "OnlyMe");

    const agent = await testPool().query<{ id: string; code: string }>(
      "select id, code from ai.agent where is_system = false order by code limit 1",
    );
    const allowed = await mayReadFile("agent-scope-for-the-tests.pdf", {
      type: "Agent",
      id: agent.rows[0].id,
      label: agent.rows[0].code,
    });
    expect(allowed).toBe(false);

    // A denial is what an investigation looks for, so it is written down.
    const { rows } = await testPool().query<{ count: string }>(
      `select count(*) from audit.audit_entry
       where action = 'files:read' and object_label = $1 and outcome = 'Denied'
         and at > now() - interval '2 minutes'`,
      ["agent-scope-for-the-tests.pdf"],
    );
    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });

  it("UC-32.1-02 UC-33.1-08 the preview and the download read the file, for whoever may read it", async () => {
    const { FileRejected, readContent } = await import("@/features/files/service");
    await place("downloadable-for-the-tests.pdf", "OnlyMe");

    signedInAs = ownerId;
    const content = await readContent("downloadable-for-the-tests.pdf", "file");
    expect(content.contentType).toBe("application/pdf");
    expect(await new Response(content.body).text()).toBe("the bytes");

    // `UC-33.1-06`: the scope of use decides the bytes as well as the listing.
    signedInAs = otherId;
    await expect(readContent("downloadable-for-the-tests.pdf", "file")).rejects.toBeInstanceOf(FileRejected);

    const { rows } = await testPool().query<{ outcome: string }>(
      `select outcome from audit.audit_entry
       where object_label = $1 and action = 'files:read'
       order by at desc limit 1`,
      ["downloadable-for-the-tests.pdf"],
    );
    expect(rows[0]?.outcome).toBe("Denied");
  });

  it("UC-25.1-03 an attachment belongs to its item, and is read through it", async () => {
    const { FileRejected, attachFile, readContent } = await import("@/features/files/service");
    signedInAs = ownerId;

    const { rows: item } = await testPool().query<{ key: string }>(
      "select key from work.work_item order by key limit 1",
    );
    const key = item[0].key;
    const name = "attached-for-the-tests.md";
    await testPool().query("delete from work.attachment where file_name = $1", [name]);
    await attachFile({ ownerType: "WorkItem", ownerKey: key, name, dataUrl: `data:text/markdown;base64,${Buffer.from("# attached").toString("base64")}` });

    // It is listed on the item rather than among the project's files.
    const { rows: listed } = await testPool().query<{ count: number }>(
      `select count(*)::int as count from work.attachment a
       join work.work_item wi on wi.id = a.owner_id
       where wi.key = $1 and a.file_name = $2`,
      [key, name],
    );
    expect(listed[0].count).toBe(1);
    expect((await loadFilesNames()).includes(name)).toBe(false);

    const content = await readContent(name, "attachment", { type: "WorkItem", key });
    expect(await new Response(content.body).text()).toBe("# attached");

    // Reading one without saying which item it is on is refused rather than guessed at.
    await expect(readContent(name, "attachment")).rejects.toBeInstanceOf(FileRejected);

    await testPool().query("delete from work.attachment where file_name = $1", [name]);
  });

  it("attaching a file to a room also posts it as a normal entry in the room's own thread", async () => {
    const { attachFile } = await import("@/features/files/service");
    signedInAs = ownerId;

    const { rows: room } = await testPool().query<{ key: string; id: string }>(
      "select key, id from work.discussion_room order by key limit 1",
    );
    const roomKey = room[0].key;
    const name = "room-attachment-for-the-tests.md";
    await testPool().query("delete from work.attachment where file_name = $1", [name]);
    await testPool().query(
      "delete from work.room_message where room_id = $1 and content_json->>'attachment' = $2",
      [room[0].id, name],
    );

    await attachFile({
      ownerType: "Room",
      ownerKey: roomKey,
      name,
      dataUrl: `data:text/markdown;base64,${Buffer.from("# room attachment").toString("base64")}`,
    });

    // Not only in the Files panel: the upload is the room's own board, read through the
    // attachment row — but also a plain entry in the message thread an agent or a person
    // reads to follow what the room is about.
    const { rows: posted } = await testPool().query<{ en: string; attachment: string }>(
      `select content_json->>'en' as en, content_json->>'attachment' as attachment
       from work.room_message where room_id = $1 and content_json->>'attachment' = $2`,
      [room[0].id, name],
    );
    expect(posted).toHaveLength(1);
    expect(posted[0].attachment).toBe(name);
    expect(posted[0].en).toContain(name);

    await testPool().query("delete from work.room_message where room_id = $1 and content_json->>'attachment' = $2", [
      room[0].id,
      name,
    ]);
    await testPool().query("delete from work.attachment where file_name = $1", [name]);
  });

  it("UC-32.1-01 a generated artifact is created at version 1, produced by the agent that called", async () => {
    const { createArtifact, readContent } = await import("@/features/files/service");
    const { createWorkItem } = await import("@/features/work-items/service");
    signedInAs = ownerId;

    // A work item of this test's own, so this does not depend on seeded data existing.
    const workItemKey = await createWorkItem({
      projectKey,
      type: "Task",
      titleEn: "A work item for the artifact tests",
      titleAr: "بند عمل لاختبارات المخرجات",
      priority: "Medium",
    });
    const titleEn = "Expense Policy Brief";
    const content = Buffer.from("the rendered docx bytes").toString("base64");
    const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const created = await createArtifact({
      projectKey,
      titleEn,
      titleAr: titleEn,
      fileName: "expense-policy-brief.docx",
      dataUrl: `data:${mimeType};base64,${content}`,
      linkedToType: "WorkItem",
      linkedToKey: workItemKey,
    });
    expect(created.id).toBeTruthy();

    const stored = await testPool().query<{
      produced_by_type: string;
      produced_by_id: string;
      linked_to_type: string;
      version_number: number;
      mime_type: string;
    }>(
      `select a.produced_by_type, a.produced_by_id, a.linked_to_type, av.version_number, av.mime_type
       from work.artifact a join work.artifact_version av on av.id = a.current_version_id
       where a.id = $1`,
      [created.id],
    );
    expect(stored.rows[0].produced_by_type).toBe("Person");
    expect(stored.rows[0].produced_by_id).toBe(ownerId);
    expect(stored.rows[0].linked_to_type).toBe("WorkItem");
    expect(stored.rows[0].version_number).toBe(1);
    expect(stored.rows[0].mime_type).toBe(mimeType);

    // The bytes it stored are the ones it was given, read back the ordinary way.
    const read = await readContent(titleEn, "artifact");
    expect(await new Response(read.body).text()).toBe("the rendered docx bytes");

    await testPool().query("delete from work.artifact_version where artifact_id = $1", [created.id]);
    await testPool().query("delete from work.artifact where id = $1", [created.id]);
    await testPool().query(
      "delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = $1)",
      [workItemKey],
    );
    await testPool().query("delete from work.work_item where key = $1", [workItemKey]);
  });

  it("UC-32.1-01 a generated artifact names an item that does not exist, and stores nothing", async () => {
    const { createArtifact, FileRejected } = await import("@/features/files/service");
    signedInAs = ownerId;

    await expect(
      createArtifact({
        projectKey,
        titleEn: "Should not be created",
        titleAr: "Should not be created",
        fileName: "ghost.pdf",
        dataUrl: `data:application/pdf;base64,${Buffer.from("x").toString("base64")}`,
        linkedToType: "WorkItem",
        linkedToKey: "NO-SUCH-ITEM",
      }),
    ).rejects.toBeInstanceOf(FileRejected);

    const { rows } = await testPool().query("select 1 from work.artifact where name_en = $1", ["Should not be created"]);
    expect(rows.length).toBe(0);
  });

  it("UC-33.1-05 a quarantined file is kept for the record and read by nobody", async () => {
    const { FileRejected, readContent } = await import("@/features/files/service");
    await place("quarantined-for-the-tests.pdf", "AllProject");
    await testPool().query("update work.project_file set status = 'Quarantined' where name = $1", [
      "quarantined-for-the-tests.pdf",
    ]);

    signedInAs = ownerId;
    await expect(readContent("quarantined-for-the-tests.pdf", "file")).rejects.toBeInstanceOf(FileRejected);
  });

  it("UC-33.1-07 changing the scope changes who may read it, at once", async () => {
    const { loadFiles, setScopeOfUse } = await import("@/features/files/service");
    await place("scope-change-for-the-tests.pdf", "OnlyMe");

    signedInAs = otherId;
    expect((await loadFiles()).items.map((item) => item.n)).not.toContain("scope-change-for-the-tests.pdf");

    signedInAs = ownerId;
    await setScopeOfUse({ name: "scope-change-for-the-tests.pdf", scope: "Selected", grants: [otherId] });

    signedInAs = otherId;
    expect((await loadFiles()).items.map((item) => item.n)).toContain("scope-change-for-the-tests.pdf");
  });

  it("UC-33.1-07 D183 only the person who uploaded a file changes who may read it", async () => {
    const { setScopeOfUse } = await import("@/features/files/service");
    const { NotPermitted } = await import("@/lib/session");
    await place("someone-elses-private-file.pdf", "OnlyMe", [], otherId);

    // The owner holds files:write, and still may not widen another person's Only-me file.
    signedInAs = ownerId;
    await expect(setScopeOfUse({ name: "someone-elses-private-file.pdf", scope: "AllProject", grants: [] })).rejects.toBeInstanceOf(NotPermitted);
    expect(await loadFilesNames()).not.toContain("someone-elses-private-file.pdf");
    const { rows } = await testPool().query<{ scope: string }>(
      "select scope_of_use as scope from work.project_file where name = $1",
      ["someone-elses-private-file.pdf"],
    );
    expect(rows[0].scope).toBe("OnlyMe");
  });

  it("UC-32.1-04 deactivating takes an artifact out of use without deleting it", async () => {
    const { loadArtifacts, setFileStatus } = await import("@/features/files/service");
    signedInAs = ownerId;

    const { items } = await loadArtifacts();
    const active = items.find((item) => item.st === "Active");
    if (!active) return;

    await setFileStatus({ name: active.n, kind: "artifact", active: false });
    const after = await testPool().query<{ status: string }>(
      "select status from work.artifact where name_en = $1",
      [active.n],
    );
    expect(after.rows[0].status).toBe("Inactive");

    await setFileStatus({ name: active.n, kind: "artifact", active: true });
  });

  it("UC-32.1-05 deleting a file removes it from the project and keeps the audit record", async () => {
    const { deleteItem, loadFiles } = await import("@/features/files/service");
    signedInAs = ownerId;
    await place("delete-me-for-the-tests.pdf", "AllProject");

    await deleteItem({ name: "delete-me-for-the-tests.pdf", kind: "file", active: false });
    expect((await loadFiles()).items.map((item) => item.n)).not.toContain("delete-me-for-the-tests.pdf");

    const gone = await testPool().query("select 1 from work.project_file where name = $1", [
      "delete-me-for-the-tests.pdf",
    ]);
    expect(gone.rowCount).toBe(0);

    // The audit log is append-only, so the record that it existed outlives the row.
    const audited = await testPool().query<{ count: string }>(
      `select count(*) from audit.audit_entry
       where action = 'files:delete' and object_label = $1 and at > now() - interval '2 minutes'`,
      ["delete-me-for-the-tests.pdf"],
    );
    expect(Number(audited.rows[0].count)).toBeGreaterThan(0);
    files.length = 0;
  });

  it("UC-32.1-03 an artifact produced by a run carries the run to open", async () => {
    const { loadArtifacts } = await import("@/features/files/service");
    signedInAs = ownerId;

    const { items } = await loadArtifacts();
    const linked = await testPool().query<{ count: string }>(
      "select count(*) from work.artifact where run_id is not null",
    );
    // Every artifact a run produced offers that run; the rest offer nothing to open.
    expect(items.filter((item) => item.runKey !== undefined).length).toBe(Number(linked.rows[0].count));
    for (const item of items.filter((one) => one.runKey !== undefined)) {
      expect(item.runAgent).toBeDefined();
    }
  });

  it("UC-32.1-07 UC-33.1-08 the lists carry only what the person may see", async () => {
    const { loadArtifacts, loadFiles } = await import("@/features/files/service");
    signedInAs = ownerId;

    const artifacts = await loadArtifacts();
    const projectFiles = await loadFiles();
    expect(typeof artifacts.mayWrite).toBe("boolean");
    expect(typeof projectFiles.mayWrite).toBe("boolean");

    // Both lists carry what the cards and the list view draw, so switching between them
    // shows the same records rather than two different reads.
    for (const item of [...artifacts.items, ...projectFiles.items]) {
      expect(item.p.length).toBeGreaterThan(0);
      expect(item.s.length).toBeGreaterThan(0);
      expect(item.st.length).toBeGreaterThan(0);
    }
  });
  /** The version a file is on, which an edit has to name back. */
  const fileVersion = async (name: string) => {
    const { rows } = await testPool().query<{ version: number }>(
      "select version from work.project_file where name = $1",
      [name],
    );
    return rows[0].version;
  };

  it("UC-33.1-06 names the principals a narrowed scope of use takes off the file", async () => {
    const { updateFile } = await import("@/features/files/service");
    signedInAs = ownerId;
    await place("cascade-for-the-tests.pdf", "Selected", [otherId]);

    // Replacing the grants with an empty list takes the named reader off, and the diff
    // says who, because once the rows are gone nothing else can.
    const diff = await updateFile({
      name: "cascade-for-the-tests.pdf",
      kind: "file",
      expectedVersion: await fileVersion("cascade-for-the-tests.pdf"),
      scopeOfUse: "OnlyMe",
      grants: [],
    });
    expect(diff.cascade.grantsRemoved.length).toBe(1);
    expect(diff.before.scopeOfUse).toBe("Selected");
    expect(diff.after.scopeOfUse).toBe("OnlyMe");

    const left = await testPool().query(
      `select 1 from work.file_access_grant g
       join work.project_file f on f.id = g.file_id
       where f.name = 'cascade-for-the-tests.pdf'`,
    );
    expect(left.rowCount).toBe(0);
  });

  it("UC-33.1-06 refuses the scope of use to an agent until an approval binds it", async () => {
    const { updateFile } = await import("@/features/files/service");
    const { ApprovalRequired } = await import("@/lib/approval-binding");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    await place("agent-scope-for-the-tests.pdf", "OnlyMe");
    const version = await fileVersion("agent-scope-for-the-tests.pdf");

    // Who may read a file is not in the agent's own patch schema at all; reaching the
    // service directly is refused as well, so the schema is a convenience and this is
    // the control.
    const asAgent = runAs(ownerId, { id: "00000000-0000-4000-8000-00000000a9e7", label: "pa" }, () =>
      updateFile({
        name: "agent-scope-for-the-tests.pdf",
        kind: "file",
        expectedVersion: version,
        scopeOfUse: "AllProject",
      }),
    );
    await expect(asAgent).rejects.toBeInstanceOf(ApprovalRequired);

    const after = await testPool().query<{ scope_of_use: string; version: number }>(
      "select scope_of_use, version from work.project_file where name = $1",
      ["agent-scope-for-the-tests.pdf"],
    );
    expect(after.rows[0].scope_of_use).toBe("OnlyMe");
    expect(after.rows[0].version).toBe(version);

    // Taking the file out of use is ordinary work, and the same agent may do it.
    const deactivated = await runAs(ownerId, { id: "00000000-0000-4000-8000-00000000a9e7", label: "pa" }, () =>
      updateFile({
        name: "agent-scope-for-the-tests.pdf",
        kind: "file",
        expectedVersion: version,
        active: false,
      }),
    );
    expect(deactivated.after.active).toBe(false);
  });

  it("UC-33.1-06 lets one of two concurrent edits win, and tells the other to read again", async () => {
    const { updateFile, FileRejected } = await import("@/features/files/service");
    signedInAs = ownerId;
    await place("race-for-the-tests.pdf", "OnlyMe");
    const version = await fileVersion("race-for-the-tests.pdf");

    const results = await Promise.allSettled([
      updateFile({ name: "race-for-the-tests.pdf", kind: "file", expectedVersion: version, active: false }),
      updateFile({ name: "race-for-the-tests.pdf", kind: "file", expectedVersion: version, active: true }),
    ]);
    expect(results.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((one) => one.status === "rejected");
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(FileRejected);
  });

  it("UC-33.1-01 UC-33.1-02 an upload stores the bytes and the file under its scope and grants", async () => {
    const { uploadFile } = await import("@/features/files/service");
    signedInAs = ownerId;
    const name = "uploaded-for-the-tests.pdf";
    files.push(name);
    const bytes = new TextEncoder().encode("%PDF-1.4 a document for the tests");

    const outcome = await uploadFile({
      projectKey,
      name,
      dataUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
      scope: "Selected",
      grants: [otherId],
    });
    expect(outcome).toEqual({ id: expect.any(String), name, quarantined: null });

    const row = await testPool().query<{ id: string; content_ref: string; size: number; mime_type: string; scope_of_use: string; status: string }>(
      `select f.id, f.content_ref, f.size, f.mime_type, f.scope_of_use, f.status from work.project_file f
       join work.project p on p.id = f.project_id where f.name = $1 and p.key = $2`,
      [name, projectKey],
    );
    expect(row.rows[0]).toMatchObject({ size: bytes.byteLength, mime_type: "application/pdf", scope_of_use: "Selected", status: "Active" });
    expect(row.rows[0].id).toBe(outcome.id);
    expect(row.rows[0].content_ref.startsWith(`files/projects/${projectKey}/`)).toBe(true);
    expect(row.rows[0].content_ref.endsWith(`-${name}`)).toBe(true);
    expect(stored.get(row.rows[0].content_ref)?.bytes).toEqual(bytes);

    const grants = await testPool().query<{ principal_id: string }>(
      "select principal_id from work.file_access_grant where file_id = $1",
      [row.rows[0].id],
    );
    expect(grants.rows.map((grant) => grant.principal_id)).toEqual([otherId]);
  });

  it("UC-33.1-05 an upload whose bytes are an executable is kept, quarantined", async () => {
    const { uploadFile } = await import("@/features/files/service");
    signedInAs = ownerId;
    const name = "renamed-executable-for-the-tests.pdf";
    files.push(name);

    const outcome = await uploadFile({
      projectKey,
      name,
      dataUrl: `data:application/pdf;base64,${Buffer.from("MZ\u0090\u0000 not a pdf").toString("base64")}`,
      scope: "AllProject",
      grants: [],
    });
    expect(outcome.quarantined).toBeTruthy();

    const row = await testPool().query<{ status: string }>("select status from work.project_file where name = $1", [name]);
    expect(row.rows[0].status).toBe("Quarantined");
  });

  it("UC-33.1-04 refuses an unreadable upload, a path in the name, and a person who may not write files", async () => {
    const { FileRejected, uploadFile } = await import("@/features/files/service");
    const { NotPermitted } = await import("@/lib/session");
    const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}`;
    signedInAs = ownerId;

    await expect(
      uploadFile({ projectKey, name: "unreadable-for-the-tests.pdf", dataUrl: "not a data url", scope: "AllProject", grants: [] }),
    ).rejects.toBeInstanceOf(FileRejected);
    await expect(
      uploadFile({ projectKey, name: "../escaped-for-the-tests.pdf", dataUrl: pdf, scope: "AllProject", grants: [] }),
    ).rejects.toBeInstanceOf(FileRejected);

    // An Agent Designer holds no `files:write`.
    const designer = await testPool().query<{ id: string }>("select id from core.person where email = 'omar@tahseel.ae'");
    signedInAs = designer.rows[0].id;
    await expect(
      uploadFile({ projectKey, name: "denied-for-the-tests.pdf", dataUrl: pdf, scope: "AllProject", grants: [] }),
    ).rejects.toBeInstanceOf(NotPermitted);

    const none = await testPool().query(
      "select 1 from work.project_file where name = any($1)",
      [["unreadable-for-the-tests.pdf", "../escaped-for-the-tests.pdf", "denied-for-the-tests.pdf"]],
    );
    expect(none.rowCount).toBe(0);
  });
});
