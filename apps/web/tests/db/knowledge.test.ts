import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-56 to S-58 against the database: collections, their sources and the retrieval test.
 *
 * What a collection is configured as decides what the ingestion run does with every
 * document in it, so the rules that bound that configuration are what is checked here.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";

process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
/** The document store lives in the cluster; here it is a map, keyed as it would be. */
const stored = new Map<string, Uint8Array>();
vi.mock("@/lib/objects", () => ({
  buckets: { rawDocuments: "raw-docs", files: "files", artifacts: "artifacts", attachments: "attachments" },
  objectStoreConfigured: () => true,
  putObject: async (bucket: string, key: string, bytes: Uint8Array) => {
    stored.set(`${bucket}/${key}`, bytes);
    return `${bucket}/${key}`;
  },
  deleteObject: async (reference: string) => {
    stored.delete(reference);
  },
  getObject: async (reference: string) => {
    const bytes = stored.get(reference);
    return bytes ? { body: new Blob([new Uint8Array(bytes)]).stream() } : null;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("knowledge", () => {
  let ownerId = "";
  let projectKey = "";
  const created: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    projectKey = project.rows[0].key;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (created.length > 0) {
      await testPool().query(
        `delete from ai.retrieval_test where collection_id in (
           select id from ai.knowledge_collection where collection_id = any($1))`,
        [created],
      );
      await testPool().query("delete from ai.knowledge_collection where collection_id = any($1)", [created]);
      created.length = 0;
    }
  });

  afterAll(async () => {
    await testPool().query("delete from ai.route where alias like 'test-embedding-%'");
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** An embedding route of this test's own: a collection embeds only with one (D257). */
  const embeddingRoute = async (name: string) => {
    const alias = `test-embedding-${name}`;
    await testPool().query("insert into ai.route (alias, kind) values ($1, 'Embedding') on conflict (alias) do nothing", [alias]);
    return alias;
  };

  /** A collection of this test's own, so nothing here configures a seeded one. */
  const makeCollection = async () => {
    const { createCollection } = await import("@/features/knowledge/service");
    const collectionId = `test-${Date.now().toString(36)}`;
    await createCollection({
      collectionId,
      nameEn: "A collection for the tests",
      nameAr: "مجموعة للاختبارات",
      projectKey,
      visibility: "Internal",
    });
    created.push(collectionId);
    return collectionId;
  };

  const baseConfig = (collectionId: string, over: Record<string, unknown> = {}) => ({
    collectionId,
    visibility: "Internal" as const,
    indexType: "Hybrid" as const,
    chunking: { technique: "Semantic", size: 800, overlap: 80 },
    preprocessing: { ocr: true, arabicNormalisation: true, stripHeadersFooters: true, maskPii: true },
    embeddingRoute: "embedding-default",
    extractionRoute: "reasoning-default",
    retrieval: { topK: 8, minimumScore: 0.35, rerank: true },
    syncSchedule: "Manual" as const,
    maximumSizeMb: 1024,
    ...over,
  });

  it("UC-56.2-01 UC-56.2-02 a collection is created, and a duplicate id is refused", async () => {
    const { createCollection } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    const { rows } = await testPool().query<{ status: string; visibility: string }>(
      "select status, visibility from ai.knowledge_collection where collection_id = $1",
      [collectionId],
    );
    expect(rows[0].status).toBe("Ready");
    expect(rows[0].visibility).toBe("Internal");

    await expect(
      createCollection({
        collectionId,
        nameEn: "The same id again",
        nameAr: "نفس المعرّف",
        projectKey,
        visibility: "Internal",
      }),
    ).rejects.toThrow();
  });

  it("UC-56.2-02 D257 the route pickers list embedding and chat routes by kind, without needing a collection to exist", async () => {
    const { routeAliases } = await import("@/features/knowledge/service");
    signedInAs = ownerId;

    // The first collection an install ever creates has no earlier one to borrow this list
    // from — `routeAliases` must not depend on any `ai.knowledge_collection` row existing.
    const routes = await routeAliases();
    const kinds = await testPool().query<{ alias: string; kind: string }>("select alias, kind from ai.route");
    const kindOf = new Map(kinds.rows.map((row) => [row.alias, row.kind]));
    expect(routes.embedding.length).toBeGreaterThan(0);
    expect(routes.chat.length).toBeGreaterThan(0);
    expect(routes.embedding.every((alias) => kindOf.get(alias) === "Embedding")).toBe(true);
    expect(routes.chat.every((alias) => ["Standard", "Typesafe"].includes(kindOf.get(alias) ?? ""))).toBe(true);
  });

  it("D257 a collection refuses a route that does not embed as its embedding route", async () => {
    const { routeAliases, saveCollectionConfig, loadCollection } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    const { chat } = await routeAliases();

    await expect(saveCollectionConfig(baseConfig(collectionId, { embeddingRoute: chat[0] }))).rejects.toThrow(
      `${chat[0]} is not an embedding route`,
    );
    expect((await loadCollection(collectionId))?.config.embeddingRoute).toBe("embedding-default");
  });

  it("UC-57.2-01 UC-57.2-03 the configuration is saved as a whole and read back", async () => {
    const { loadCollection, saveCollectionConfig } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    const outcome = await saveCollectionConfig(
      baseConfig(collectionId, {
        chunking: { technique: "Recursive", size: 1200, overlap: 120 },
        retrieval: { topK: 12, minimumScore: 0.5, rerank: false },
        syncSchedule: "Daily",
        maximumSizeMb: 2048,
        // A collection starts on `baseConfig`'s own default route, so proving a change is
        // reported needs a genuinely different one.
        embeddingRoute: await embeddingRoute("second"),
      }),
    );
    expect(outcome.reindexNeeded).toBe(true);

    const loaded = await loadCollection(collectionId);
    expect(loaded?.config.chunking).toEqual({ technique: "Recursive", size: 1200, overlap: 120 });
    expect(loaded?.config.retrieval).toEqual({ topK: 12, minimumScore: 0.5, rerank: false });
    expect(loaded?.config.syncSchedule).toBe("Daily");
    expect(loaded?.config.maximumSizeMb).toBe(2048);
    expect(loaded?.mayWrite).toBe(true);
  });

  it("UC-57.2-02 changing the embedding route is reported as a re-index, and keeping it is not", async () => {
    const { saveCollectionConfig } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    // A freshly created collection already carries `baseConfig`'s own default route
    // (`createCollection`'s own initial value, same as what `saveCollectionConfig` would
    // write), so saving that unchanged is correctly not a re-index — only an actual
    // change away from it is: vectors from two models cannot be compared.
    const second = await embeddingRoute("second");
    expect((await saveCollectionConfig(baseConfig(collectionId))).reindexNeeded).toBe(false);
    expect((await saveCollectionConfig(baseConfig(collectionId, { embeddingRoute: second }))).reindexNeeded).toBe(true);
    expect((await saveCollectionConfig(baseConfig(collectionId, { embeddingRoute: second }))).reindexNeeded).toBe(false);
    expect(
      (await saveCollectionConfig(baseConfig(collectionId, { embeddingRoute: await embeddingRoute("third") }))).reindexNeeded,
    ).toBe(true);
  });

  it("UC-57.2-04 an overlap at or above the chunk size is refused", async () => {
    const { KnowledgeRejected, saveCollectionConfig } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    // Every chunk would contain the whole of the one before it.
    await expect(
      saveCollectionConfig(baseConfig(collectionId, { chunking: { technique: "Fixed", size: 400, overlap: 400 } })),
    ).rejects.toBeInstanceOf(KnowledgeRejected);

    // And a collection with no embedding route cannot be indexed at all.
    await expect(
      saveCollectionConfig(baseConfig(collectionId, { embeddingRoute: "" })),
    ).rejects.toBeInstanceOf(KnowledgeRejected);
  });

  it("UC-57.1-07 a file the parser cannot read and a bad URL are both refused", async () => {
    const { addSource, crawlRefusal } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    const refused = await addSource({
      collectionCode: collectionId,
      type: "Upload",
      name: "archive.zip",
      mimeType: "application/zip",
    });
    expect(refused.added).toBe(false);
    expect(refused.reason).toMatch(/cannot be indexed/i);

    const badUrl = await addSource({ collectionCode: collectionId, type: "UrlCrawl", name: "not a url" });
    expect(badUrl.added).toBe(false);

    // A crawl starts at an address the platform can fetch.
    expect(crawlRefusal("https://tahseel.ae/en/services")).toBeNull();
    expect(crawlRefusal("ftp://tahseel.ae")?.reason).toMatch(/http/i);
    expect(crawlRefusal("not a url")?.reason).toMatch(/not a URL/i);
  });

  it("D349 an opened collection's sources are one page of what matches, newest first, counted the same way", async () => {
    const { loadKnowledge } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    const other = await makeCollection();
    await testPool().query(
      `insert into ai.knowledge_source (collection_id, type, name, status, created_at)
       select c.id, 'Upload', n.name, 'Indexed', now() - make_interval(mins => n.ord::int)
       from ai.knowledge_collection c, unnest($2::text[]) with ordinality as n(name, ord) where c.collection_id = $1`,
      [collectionId, ["tariff-schedule.pdf", "tariff-annex.pdf", "handbook.pdf"]],
    );
    await testPool().query(
      `insert into ai.knowledge_source (collection_id, type, name, status)
       select c.id, 'Upload', 'tariff-elsewhere.pdf', 'Indexed' from ai.knowledge_collection c where c.collection_id = $1`,
      [other],
    );

    const all = await loadKnowledge(collectionId);
    expect(all.sourceTotal).toBe(3);
    expect(all.sources[collectionId].map((source) => source.n)).toEqual(["tariff-schedule.pdf", "tariff-annex.pdf", "handbook.pdf"]);
    // No other collection's sources are read with it.
    expect(Object.keys(all.sources)).toEqual([collectionId]);

    // A word in the name narrows the rows and the total, and only within this collection.
    const tariff = await loadKnowledge(collectionId, { q: "tariff" });
    expect(tariff.sourceTotal).toBe(2);
    expect(tariff.sources[collectionId].map((source) => source.n)).toEqual(["tariff-schedule.pdf", "tariff-annex.pdf"]);

    // Page 2 continues where page 1 stopped.
    const second = await loadKnowledge(collectionId, {}, { limit: 2, offset: 2 });
    expect(second.sources[collectionId].map((source) => source.n)).toEqual(["handbook.pdf"]);
    expect(second.sourceTotal).toBe(3);

    // Nothing opened, nothing read.
    expect((await loadKnowledge()).sources).toEqual({});
  });

  it("UC-57.1-01 UC-57.1-05 a source is added and removed with everything it put in", async () => {
    const { addSource, loadKnowledge, removeSource } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    const added = await addSource({
      collectionCode: collectionId,
      type: "Upload",
      name: "policy.pdf",
      mimeType: "application/pdf",
    });
    expect(added.added).toBe(true);

    const { sources } = await loadKnowledge(collectionId);
    const mine = (sources[collectionId] ?? []).find((source) => source.n === "policy.pdf");
    expect(mine).toBeDefined();

    // D258: the index is cleared of the source's documents before their rows go.
    const documents = await testPool().query<{ id: string }>(
      `insert into ai.knowledge_document (source_id, title, raw_ref, size_bytes, status)
       values ($1, 'policy.pdf', 'files/policy.pdf', 10, 'Indexed') returning id`,
      [mine?.id],
    );
    const asked: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return { ok: true, status: 200, json: async () => ({ chunks: 0 }), text: async () => "" } as Response;
    }) as typeof fetch;
    await removeSource(mine?.id ?? "");
    expect(asked).toEqual([
      {
        url: `http://agent-service.test/ingestion/collections/${collectionId}/removals`,
        method: "POST",
        body: { doc_ids: documents.rows.map((row) => row.id) },
      },
    ]);
    const after = await testPool().query(
      `select 1 from ai.knowledge_source src
       join ai.knowledge_collection c on c.id = src.collection_id
       where c.collection_id = $1 and src.name = 'policy.pdf'`,
      [collectionId],
    );
    expect(after.rowCount).toBe(0);
  });

  it("UC-57.1-01 adding a source starts ingestion rather than leaving it Indexing for ever", async () => {
    // Nothing in this suite runs the agent service, so the ingestion call that `addSource`
    // now makes fails to connect — which is the distinguishing signal from the defect this
    // guards: before the fix, the source stayed "Indexing" silently; the fix reaches the same
    // failure path `reindex()` already uses and marks the source Error with why.
    const { addSource, loadKnowledge } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    await addSource({ collectionCode: collectionId, type: "Upload", name: "handbook.pdf", mimeType: "application/pdf" });

    const { sources } = await loadKnowledge(collectionId);
    const mine = (sources[collectionId] ?? []).find((source) => source.n === "handbook.pdf");
    expect(mine?.st).toBe("Error");
    expect(mine?.why).toBeTruthy();
  });

  it("D266 a source takes a file the person holds by its id, and refuses an id they may not read", async () => {
    const { addSource } = await import("@/features/knowledge/service");
    const { uploadFile } = await import("@/features/files/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({}), text: async () => "" }) as Response) as typeof fetch;

    const name = `held-${Date.now().toString(36)}-for-the-tests.pdf`;
    const file = await uploadFile({
      projectKey,
      name,
      dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4 a held document").toString("base64")}`,
      scope: "OnlyMe",
      grants: [],
    });
    try {
      const added = await addSource({ collectionCode: collectionId, type: "Upload", name, heldFiles: [{ kind: "File", id: file.id }] });
      expect(added).toMatchObject({ added: true });
      const documents = await testPool().query<{ title: string; size_bytes: number }>(
        `select d.title, d.size_bytes from ai.knowledge_document d
         join ai.knowledge_source s on s.id = d.source_id
         join ai.knowledge_collection c on c.id = s.collection_id where c.collection_id = $1`,
        [collectionId],
      );
      expect(documents.rows).toEqual([{ title: name, size_bytes: Buffer.from("%PDF-1.4 a held document").byteLength }]);

      // An id that names nothing this person may read is refused, and adds nothing.
      const refused = await addSource({
        collectionCode: collectionId,
        type: "Upload",
        name: "not-mine.pdf",
        heldFiles: [{ kind: "File", id: "0199a000-0000-7000-8000-000000000000" }],
      });
      expect(refused).toMatchObject({ added: false });
      expect(refused.reason).toMatch(/not one you may read/);
    } finally {
      await testPool().query("delete from work.project_file where id = $1", [file.id]);
    }
  });

  it("UC-57.1-01 UC-56.2-04 a source added while ingestion cannot start says so, with the reason", async () => {
    const { addSource } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    const stalled = await addSource({ collectionCode: collectionId, type: "UrlCrawl", name: "https://tahseel.ae/a" });
    expect(stalled).toMatchObject({ added: true, indexing: false, reason: "The ingestion service did not answer." });
    expect(stalled.reasonAr).toBeTruthy();

    globalThis.fetch = (async () => ({ ok: true, json: async () => ({}), text: async () => "" }) as Response) as typeof fetch;
    const started = await addSource({ collectionCode: collectionId, type: "UrlCrawl", name: "https://tahseel.ae/b" });
    expect(started).toMatchObject({ added: true, indexing: true, reason: null });
  });

  it("UC-57.1-04 re-indexing one source says whether its indexing started", async () => {
    const { addSource, loadKnowledge, reindex } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({}), text: async () => "" }) as Response) as typeof fetch;
    await addSource({ collectionCode: collectionId, type: "UrlCrawl", name: "https://tahseel.ae/c" });
    const source = ((await loadKnowledge(collectionId)).sources[collectionId] ?? [])[0];

    expect(await reindex(source.id)).toMatchObject({ started: true, reason: null });

    globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" }) as Response) as typeof fetch;
    const refused = await reindex(source.id);
    expect(refused).toMatchObject({ started: false, reason: "The ingestion service refused the run (503)." });
    expect(refused.reasonAr).toContain("503");
  });

  it("UC-57.2-05 a collection at its size limit takes no more documents", async () => {
    const { addSource, saveCollectionConfig } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    // A ceiling of 1 MB against a collection that already holds something.
    await saveCollectionConfig(baseConfig(collectionId, { maximumSizeMb: 1 }));
    await testPool().query(
      `insert into ai.knowledge_source (collection_id, type, name, document_count, status)
       select c.id, 'Upload', 'big.pdf', 1, 'Indexed' from ai.knowledge_collection c where c.collection_id = $1`,
      [collectionId],
    );
    const source = await testPool().query<{ id: string }>(
      `select src.id from ai.knowledge_source src
       join ai.knowledge_collection c on c.id = src.collection_id
       where c.collection_id = $1 limit 1`,
      [collectionId],
    );
    await testPool().query(
      `insert into ai.knowledge_document (source_id, title, raw_ref, size_bytes, status)
       values ($1, 'big.pdf', 'files/big.pdf', 2097152, 'Indexed')`,
      [source.rows[0].id],
    );

    const refused = await addSource({
      collectionCode: collectionId,
      type: "Upload",
      name: "another.pdf",
      mimeType: "application/pdf",
    });
    expect(refused.added).toBe(false);
    expect(refused.reason).toMatch(/limit/i);
  });

  it("UC-56.2-04 an ingestion that will not start leaves the collection in Error with the reason", async () => {
    const { reindexCollection } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    const outcome = await reindexCollection(collectionId);
    expect(outcome.started).toBe(false);
    expect(outcome.reason).toMatch(/did not answer/i);

    const { rows } = await testPool().query<{ status: string }>(
      "select status from ai.knowledge_collection where collection_id = $1",
      [collectionId],
    );
    expect(rows[0].status).toBe("Error");
  });

  it("UC-57.1-06 a re-index hands the ingestion the collection's own configuration", async () => {
    const { reindexCollection, saveCollectionConfig } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    await saveCollectionConfig(
      baseConfig(collectionId, { chunking: { technique: "Fixed", size: 500, overlap: 50 }, indexType: "Vector" }),
    );

    let sent: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return { ok: true, json: async () => ({ workflow_id: "w-1" }), text: async () => "" } as Response;
    }) as typeof fetch;

    const outcome = await reindexCollection(collectionId);
    expect(outcome.started).toBe(true);
    const config = (sent as unknown as { config: Record<string, unknown> }).config;
    expect(config.chunking).toEqual({ technique: "Fixed", size: 500, overlap: 50 });
    // A Vector index extracts no graph, which is what the configuration said.
    expect(config.extract_graph).toBe(false);

    const { rows } = await testPool().query<{ status: string }>(
      "select status from ai.knowledge_collection where collection_id = $1",
      [collectionId],
    );
    expect(rows[0].status).toBe("Ingesting");
  });

  it("UC-58.1-01 UC-58.1-04 a retrieval test records what it found, including nothing", async () => {
    const { testRetrieval } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ passages: [{ ref: "doc#1", text: "The per-diem is AED 450.", score: 0.81 }], facts: [] }),
        text: async () => "",
      }) as Response) as typeof fetch;

    const found = await testRetrieval({
      query: "What is the hotel per-diem in Riyadh?",
      collectionId,
      mode: "Hybrid",
      limit: 8,
    });
    expect(found.ok).toBe(true);
    expect(found.ok && found.passages[0].score).toBe(0.81);

    const { rows } = await testPool().query<{ query: string; mode: string }>(
      `select rt.query, rt.mode from ai.retrieval_test rt
       join ai.knowledge_collection c on c.id = rt.collection_id where c.collection_id = $1`,
      [collectionId],
    );
    expect(rows[0].mode).toBe("Hybrid");

    // `UC-58.1-04`: nothing above the minimum score is an answer, not a failure.
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ passages: [], facts: [] }), text: async () => "" }) as Response) as typeof fetch;
    const empty = await testRetrieval({ query: "nothing matches this", collectionId, mode: "Vector", limit: 8 });
    expect(empty.ok).toBe(true);
    expect(empty.ok && empty.passages).toEqual([]);
  });

  it("D151 an agent's knowledge_search reaches only the collections its agent is granted", async () => {
    const { searchKnowledge } = await import("@/features/knowledge/service");
    const { startRun } = await import("@/features/agents/service");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    const granted = await makeCollection();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const other = await makeCollection();

    globalThis.fetch = (async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;
    const runId = await startRun({ agentCode: "pa", prompt: "Search", screen: "/knowledge", surface: "AssistantPanel" });
    const run = (
      await testPool().query<{ agent_id: string; agent_version_id: string }>("select agent_id, agent_version_id from ai.run where id = $1", [runId])
    ).rows[0];
    await testPool().query(
      `insert into ai.agent_knowledge_access (agent_version_id, collection_id)
       select $1, id from ai.knowledge_collection where collection_id = $2`,
      [run.agent_version_id, granted],
    );

    const asked: string[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      asked.push((JSON.parse(String(init?.body)) as { collection_id: string }).collection_id);
      return { ok: true, json: async () => ({ passages: [{ ref: "d#1", text: "x", score: 0.9 }], facts: [] }), text: async () => "" } as Response;
    }) as typeof fetch;
    const asAgent = <T,>(body: () => Promise<T>) => runAs(ownerId, { id: run.agent_id, label: "knowledge_search", runId }, body);

    try {
      const found = await asAgent(() => searchKnowledge({ query: "per-diem", mode: "Hybrid", limit: 8 }));
      expect(found.ok).toBe(true);
      expect(asked).toEqual([granted]);

      // A collection the person may read but the agent is not granted is not the agent's.
      const refused = await asAgent(() => searchKnowledge({ query: "per-diem", collectionId: other, mode: "Hybrid", limit: 8 }));
      expect(refused.ok).toBe(false);
      expect(asked).toEqual([granted]);
    } finally {
      await testPool().query(
        "delete from ai.agent_knowledge_access where agent_version_id = $1 and collection_id in (select id from ai.knowledge_collection where collection_id = $2)",
        [run.agent_version_id, granted],
      );
    }
  });

  it("UC-58.1-06 a retrieval route that is down is reported, not returned as empty", async () => {
    const { testRetrieval } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => "" }) as Response) as typeof fetch;
    const found = await testRetrieval({ query: "anything", collectionId, mode: "Vector", limit: 8 });
    expect(found.ok).toBe(false);
    expect(found.ok === false && found.reason).toMatch(/unavailable/i);
  });

  it("UC-58.1-05 a collection the person may not read is left out of All collections", async () => {
    const { collectionIdsVisibleTo } = await import("@/features/knowledge/repository");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    // With no project reachable, only the collections that belong to no project remain.
    const none = await collectionIdsVisibleTo([]);
    expect(none).not.toContain(collectionId);

    // `null` is every project, which is what an organisation-wide grant gives.
    expect(await collectionIdsVisibleTo(null)).toBeNull();
  });

  it("UC-57.1-02 UC-57.1-03 a crawl and an MCP resource are sources like any other", async () => {
    const { addSource, loadKnowledge } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    const crawl = await addSource({
      collectionCode: collectionId,
      type: "UrlCrawl",
      name: "https://tahseel.ae/en/services",
    });
    expect(crawl.added).toBe(true);

    const resource = await addSource({
      collectionCode: collectionId,
      type: "McpResource",
      name: "m365:/sites/procurement/Shared Documents",
    });
    expect(resource.added).toBe(true);

    const { sources } = await loadKnowledge(collectionId);
    const kinds = (sources[collectionId] ?? []).map((source) => source.kind);
    expect(kinds).toContain("UrlCrawl");
    expect(kinds).toContain("McpResource");
  });

  it("UC-56.1-01 UC-57.2-01 a saved configuration is what the collection list then shows", async () => {
    const { loadCollection, loadKnowledge, saveCollectionConfig } = await import("@/features/knowledge/service");
    const { listCollections } = await import("@/features/knowledge/repository");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    await saveCollectionConfig(
      baseConfig(collectionId, {
        indexType: "Vector",
        chunking: { technique: "FixedSize", size: 512, overlap: 64 },
        extractionRoute: null,
        retrieval: { topK: 5, minimumScore: 0.4, rerank: false },
      }),
    );

    // The configuration screen reads it back as it was saved...
    const loaded = await loadCollection(collectionId);
    expect(loaded?.config.indexType).toBe("Vector");
    expect(loaded?.config.chunking.technique).toBe("FixedSize");
    expect(loaded?.config.retrieval.topK).toBe(5);

    // ...and so does the card, which is the same record read a second way. Two sets of
    // names for one record meant every card fell back to its defaults after a save.
    const card = (await listCollections()).find((one) => one.id === collectionId);
    expect(card?.idx).toBe("Vector");
    expect(card?.chunk).toBe("FixedSize");
    expect(card?.size).toBe(512);
    expect(card?.overlap).toBe(64);
    expect(card?.k).toBe(5);
    expect(card?.rr).toBe(false);
    expect(card?.emb).toBe("embedding-default");
    // Where the index lives follows from what kind it is.
    expect(card?.store).toBe("pgvector");

    // The screen that lists every collection shows the same.
    const listed = (await loadKnowledge()).collections.find((one) => one.id === collectionId);
    expect(listed?.idx).toBe("Vector");
  });

  it("UC-57.1-01 an upload's files become the source's documents", async () => {
    const { addSource, loadKnowledge } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    const body = Buffer.from("# Handbook. The per-diem rule.").toString("base64");
    const outcome = await addSource({
      collectionCode: collectionId,
      type: "Upload",
      name: "handbook.md",
      documents: [
        { name: "handbook.md", dataUrl: `data:text/markdown;base64,${body}` },
        { name: "appendix.md", dataUrl: `data:text/markdown;base64,${body}` },
      ],
    });
    expect(outcome.added).toBe(true);

    // The source carries them, and they are what an ingestion run then reads.
    const source = ((await loadKnowledge(collectionId)).sources[collectionId] ?? [])[0];
    expect(source?.docs).toBe(2);

    const { rows } = await testPool().query<{ title: string; raw_ref: string; status: string; size_bytes: number }>(
      `select d.title, d.raw_ref, d.status, d.size_bytes from ai.knowledge_document d
       join ai.knowledge_source s on s.id = d.source_id
       join ai.knowledge_collection c on c.id = s.collection_id
       where c.collection_id = $1 order by d.title`,
      [collectionId],
    );
    expect(rows.map((row) => row.title)).toEqual(["appendix.md", "handbook.md"]);
    expect(rows.every((row) => row.raw_ref.startsWith("raw-docs/"))).toBe(true);
    expect(rows.every((row) => row.status === "Indexing")).toBe(true);
    expect(rows.every((row) => row.size_bytes > 0)).toBe(true);

    // `UC-57.1-07`: a file nothing can parse is refused rather than stored.
    const refused = await addSource({
      collectionCode: collectionId,
      type: "Upload",
      name: "archive.zip",
      documents: [{ name: "archive.zip", dataUrl: "data:application/zip;base64,UEsFBg==" }],
    });
    expect(refused.added).toBe(false);
  });

  it("UC-56.2-04 UC-57.1-01 what a finished run produced is what the collection then says", async () => {
    const { addSource, loadKnowledge, recordIngestionOutcome } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    await addSource({
      collectionCode: collectionId,
      type: "Upload",
      name: "handbook.md",
      documents: [
        {
          name: "handbook.md",
          dataUrl: `data:text/markdown;base64,${Buffer.from("# Handbook").toString("base64")}`,
        },
      ],
    });
    await testPool().query("update ai.knowledge_collection set status = 'Ingesting' where collection_id = $1", [
      collectionId,
    ]);

    // The agent service owns the run; this is what it hands back when the run has ended.
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ collection_id: collectionId, documents: 1, chunks: 12, entities: 4, failures: [] }),
        text: async () => "",
      }) as Response) as typeof fetch;

    const recorded = await recordIngestionOutcome(collectionId);
    expect(recorded).toEqual({ documents: 1, chunks: 12, entities: 4, failures: [] });

    const after = (await loadKnowledge()).collections.find((one) => one.id === collectionId);
    expect(after?.st).toBe("Ready");
    expect(after?.ents).toBe(4);
    expect(after?.chunks).toBe(12);
    expect(after?.syncedAt).not.toBeNull();

    const sources = (await loadKnowledge(collectionId)).sources[collectionId] ?? [];
    expect(sources[0]?.st).toBe("Indexed");

    // `UC-56.2-04`: a run that could not read everything says Error and keeps what it got.
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ collection_id: collectionId, documents: 0, chunks: 0, entities: 0, failures: ["handbook.pdf: unreadable"] }),
        text: async () => "",
      }) as Response) as typeof fetch;
    await recordIngestionOutcome(collectionId);
    expect((await loadKnowledge()).collections.find((one) => one.id === collectionId)?.st).toBe("Error");

    // Between runs there is nothing to record, and nothing is written.
    globalThis.fetch = (async () => ({ ok: false, status: 404, text: async () => "" }) as Response) as typeof fetch;
    expect(await recordIngestionOutcome(collectionId)).toBeNull();
  });

  it("UC-57.1-04 UC-57.1-08 a re-index marks the source, and one that cannot be read says Error", async () => {
    const { addSource, loadKnowledge, reindex } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    await addSource({ collectionCode: collectionId, type: "Upload", name: "handbook.pdf", mimeType: "application/pdf" });

    const { sources } = await loadKnowledge(collectionId);
    const source = (sources[collectionId] ?? [])[0];

    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ workflow_id: "w-1" }), text: async () => "" }) as Response) as typeof fetch;
    await reindex(source.id);
    const indexing = await testPool().query<{ status: string }>(
      "select status from ai.knowledge_source where id = $1",
      [source.id],
    );
    expect(indexing.rows[0].status).toBe("Indexing");

    // `UC-57.1-08`: a crawl that is blocked or a resource that cannot be reached stops the
    // ingestion run, and the source says so rather than indexing for ever.
    globalThis.fetch = (async () => {
      throw new Error("the crawl was blocked");
    }) as typeof fetch;
    await reindex(source.id);

    const failed = await testPool().query<{ status: string; last_error: string | null }>(
      "select status, last_error from ai.knowledge_source where id = $1",
      [source.id],
    );
    expect(failed.rows[0].status).toBe("Error");
    expect(failed.rows[0].last_error).toBeTruthy();
  });

  it("UC-57.1-09 OCR off is carried into the ingestion run, where it decides what is read", async () => {
    const { reindexCollection, saveCollectionConfig } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    await saveCollectionConfig(baseConfig(collectionId, { preprocessing: { ocr: false, arabicNormalisation: true, stripHeadersFooters: true, maskPii: true } }));

    let sent: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return { ok: true, json: async () => ({ workflow_id: "w-1" }), text: async () => "" } as Response;
    }) as typeof fetch;
    await reindexCollection(collectionId);

    // A scanned PDF indexed without OCR yields no text, which is what the warning is about.
    expect((sent as unknown as { config: { ocr: boolean } }).config.ocr).toBe(false);
  });

  it("UC-57.2-06 somebody who may not write the collection is told so rather than refused on save", async () => {
    const { loadCollection } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    expect((await loadCollection(collectionId))?.mayWrite).toBe(true);

    const reader = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'knowledge:read' and rp.effect = 'Allow' and p.status = 'Active'
         and not exists (
           select 1 from core.role_assignment ra2
           join core.role r2 on r2.id = ra2.role_id
           join core.role_permission rp2 on rp2.role_id = r2.id
           join core.permission perm2 on perm2.id = rp2.permission_id
           where ra2.person_id = ra.person_id and perm2.code = 'knowledge:write'
         )
       order by ra.person_id limit 1`,
    );
    if (reader.rowCount === 0) return;
    signedInAs = reader.rows[0].id;
    expect((await loadCollection(collectionId))?.mayWrite).toBe(false);
  });

  it("UC-58.1-02 UC-58.1-03 the mode and the scope are what the query is run with", async () => {
    const { testRetrieval } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();

    const asked: { collection: string; mode: string }[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { collection_id: string; mode: string };
      asked.push({ collection: body.collection_id, mode: body.mode });
      return { ok: true, json: async () => ({ passages: [], facts: [] }), text: async () => "" } as Response;
    }) as typeof fetch;

    await testRetrieval({ query: "per diem", collectionId, mode: "Vector", limit: 8 });
    await testRetrieval({ query: "per diem", collectionId, mode: "Graph", limit: 8 });
    expect(asked.map((one) => one.mode)).toEqual(["Vector", "Graph"]);
    expect(asked.every((one) => one.collection === collectionId)).toBe(true);

    // `UC-58.1-03`: no collection means every one this person may read, so the query goes
    // to more than the one that was named before.
    asked.length = 0;
    await testRetrieval({ query: "per diem", mode: "Vector", limit: 8 });
    expect(asked.length).toBeGreaterThan(1);
  });

  it("a retrieval test embeds its query with the collection's own route, not the platform default", async () => {
    const { testRetrieval } = await import("@/features/knowledge/service");
    const { saveCollectionConfig } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    // A passage is only comparable to a query vector embedded with the same route ingestion
    // used — sending the platform-wide default instead would compare vectors from two
    // different models, exactly the bug this guards against.
    const route = await embeddingRoute("nemotron");
    await saveCollectionConfig(baseConfig(collectionId, { embeddingRoute: route }));

    let sentRoute = "";
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { embedding_route?: string };
      sentRoute = body.embedding_route ?? "";
      return { ok: true, json: async () => ({ passages: [], facts: [] }), text: async () => "" } as Response;
    }) as typeof fetch;

    await testRetrieval({ query: "per diem", collectionId, mode: "Vector", limit: 8 });
    expect(sentRoute).toBe(route);
  });
  /** The version a collection is on, which an edit has to name back. */
  const collectionVersion = async (collectionId: string) => {
    const { loadCollection } = await import("@/features/knowledge/service");
    const loaded = await loadCollection(collectionId);
    return loaded?.config.version ?? 0;
  };

  it("UC-57.2 names the documents a changed embedding route makes the collection read again", async () => {
    const { addSource, updateKnowledgeCollection } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    // Nothing here runs the ingestion service, so the run does not start; the document is
    // stored either way, which is what the cascade counts.
    await addSource({
      collectionCode: collectionId,
      type: "Upload",
      name: "handbook.txt",
      mimeType: "text/plain",
      documents: [{ name: "handbook.txt", dataUrl: "data:text/plain;base64,aGFuZGJvb2s=" }],
    });

    // Renaming how it is chunked takes nothing with it.
    const retune = await updateKnowledgeCollection({
      collectionId,
      expectedVersion: await collectionVersion(collectionId),
      chunking: { technique: "Recursive", size: 1000, overlap: 100 },
    });
    expect(retune.cascade.reindexRequired).toBe(false);
    expect(retune.before.chunking).toMatchObject({ size: 800 });
    expect(retune.after.chunking).toMatchObject({ size: 1000 });

    // A new embedding route discards the index, and the diff says over how many documents.
    const rerouted = await updateKnowledgeCollection({
      collectionId,
      expectedVersion: await collectionVersion(collectionId),
      embeddingRoute: await embeddingRoute("second"),
    });
    expect(rerouted.cascade.reindexRequired).toBe(true);
    expect(rerouted.cascade.reindexDocuments).toBe(1);
  });

  it("UC-57.2 refuses a sensitive field to an agent until an approval binds it", async () => {
    const { updateKnowledgeCollection } = await import("@/features/knowledge/service");
    const { ApprovalRequired } = await import("@/lib/approval-binding");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    const version = await collectionVersion(collectionId);

    // The owner may widen who reads the collection; the agent acting for them may not do
    // it unattended.
    const asAgent = runAs(ownerId, { id: "00000000-0000-4000-8000-00000000a9e7", label: "pa" }, () =>
      updateKnowledgeCollection({ collectionId, expectedVersion: version, visibility: "Public" }),
    );
    await expect(asAgent).rejects.toBeInstanceOf(ApprovalRequired);

    // Refused before anything was written, which is what makes a retry after approval safe.
    const after = await testPool().query<{ visibility: string; version: number }>(
      "select visibility, version from ai.knowledge_collection where collection_id = $1",
      [collectionId],
    );
    expect(after.rows[0].visibility).toBe("Internal");
    expect(after.rows[0].version).toBe(version);
  });

  it("UC-57.2 lets one of two concurrent edits win, and tells the other to read again", async () => {
    const { updateKnowledgeCollection, KnowledgeRejected } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    const version = await collectionVersion(collectionId);

    const results = await Promise.allSettled([
      updateKnowledgeCollection({ collectionId, expectedVersion: version, maximumSizeMb: 2048 }),
      updateKnowledgeCollection({ collectionId, expectedVersion: version, maximumSizeMb: 4096 }),
    ]);
    expect(results.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((one) => one.status === "rejected");
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(KnowledgeRejected);
  });

  it("a collection delete is preceded by what it takes with it, and then takes all of it", async () => {
    const { KnowledgeRejected, collectionCounts, deleteCollection } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    await testPool().query(
      `insert into ai.knowledge_source (collection_id, type, name, document_count, status)
       select c.id, 'Upload', 'counted.pdf', 2, 'Indexed' from ai.knowledge_collection c where c.collection_id = $1`,
      [collectionId],
    );
    const source = await testPool().query<{ id: string }>(
      `select src.id from ai.knowledge_source src
       join ai.knowledge_collection c on c.id = src.collection_id
       where c.collection_id = $1`,
      [collectionId],
    );
    for (const title of ["one.pdf", "two.pdf"]) {
      await testPool().query(
        `insert into ai.knowledge_document (source_id, title, raw_ref, size_bytes, status)
         values ($1, $2, 'files/counted.pdf', 10, 'Indexed')`,
        [source.rows[0].id, title],
      );
    }

    expect(await collectionCounts(collectionId)).toEqual({ sources: 1, documents: 2 });

    // D258: the index refusing leaves the collection whole, with the reason.
    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => "" }) as Response) as typeof fetch;
    await expect(deleteCollection(collectionId)).rejects.toThrow("refused the removal (503)");
    expect(await collectionCounts(collectionId)).toEqual({ sources: 1, documents: 2 });

    const asked: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      asked.push(`${init?.method} ${String(url)}`);
      return { ok: true, status: 204, text: async () => "" } as Response;
    }) as typeof fetch;
    await deleteCollection(collectionId);
    expect(asked).toEqual([`DELETE http://agent-service.test/ingestion/collections/${collectionId}`]);
    const gone = await testPool().query(
      "select 1 from ai.knowledge_collection where collection_id = $1",
      [collectionId],
    );
    expect(gone.rowCount).toBe(0);
    const orphans = await testPool().query("select 1 from ai.knowledge_source where id = $1", [source.rows[0].id]);
    expect(orphans.rowCount).toBe(0);
    const { rows } = await testPool().query<{ action: string; object_label: string; detail_json: unknown }>(
      "select action, object_label, detail_json from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(rows[0]).toMatchObject({ action: "knowledge:delete", object_label: collectionId });
    expect(rows[0].detail_json).toMatchObject({ sources: 1, documents: 2 });

    // A collection that is already gone is named as gone rather than deleted twice.
    await expect(deleteCollection(collectionId)).rejects.toBeInstanceOf(KnowledgeRejected);
  });

  it("somebody who may only read sees a collection's counts but cannot delete", async () => {
    const { collectionCounts, deleteCollection } = await import("@/features/knowledge/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    const collectionId = await makeCollection();
    const reader = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    signedInAs = reader.rows[0].id;

    expect(await collectionCounts(collectionId)).toEqual({ sources: 0, documents: 0 });
    await expect(deleteCollection(collectionId)).rejects.toBeInstanceOf(NotPermitted);
    const kept = await testPool().query(
      "select 1 from ai.knowledge_collection where collection_id = $1",
      [collectionId],
    );
    expect(kept.rowCount).toBe(1);
  });

  it("UC-56.2-03 the progress shown is what the running ingestion reports, and unknown when it cannot say", async () => {
    const { ingestionProgress } = await import("@/features/knowledge/service");
    signedInAs = ownerId;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return { ok: true, json: async () => ({ stage: "embedding", done: 3, total: 7 }), text: async () => "" } as Response;
    }) as typeof fetch;

    expect(await ingestionProgress("a collection/1")).toEqual({ stage: "embedding", done: 3, total: 7 });
    expect(asked).toEqual([`${process.env.AGENT_SERVICE_URL}/ingestion/runs/a%20collection%2F1`]);

    globalThis.fetch = (async () => ({ ok: false, status: 404, text: async () => "" }) as Response) as typeof fetch;
    expect(await ingestionProgress("a-collection")).toEqual({ stage: "unknown", done: 0, total: 0 });

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    expect(await ingestionProgress("a-collection")).toEqual({ stage: "unknown", done: 0, total: 0 });
  });

  it("UC-56.2-03 the progress is not read for somebody who is not signed in", async () => {
    const { ingestionProgress } = await import("@/features/knowledge/service");
    signedInAs = "";
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return { ok: true, json: async () => ({}), text: async () => "" } as Response;
    }) as typeof fetch;

    await expect(ingestionProgress("a-collection")).rejects.toThrow();
    expect(called).toBe(false);
  });
});
