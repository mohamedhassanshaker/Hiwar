import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { MEM, MEM_TREE, MEM_VER } from "./data/memory";
import { at } from "@/db/seed/clock";
import { ids } from "@/db/seed/ids";

/**
 * Data model sections 13 and 14: the memory tree with its versions and entries, and the
 * knowledge collections with their sources and documents. The vectors and the graph live
 * in pgvector and Neo4j (section 22); only the metadata is here.
 */

const MEMORY_STATUS: Record<string, string> = {
  Active: "Active",
  "Pending review": "PendingReview",
  "Needs attention": "NeedsAttention",
};

const SCOPE_KIND: Record<string, string> = {
  Organisation: "Organisation",
  "Business unit": "BusinessUnit",
  Agent: "Agent",
  Session: "Session",
};

/** Who owns each memory in the demo organisation. */
const MEMORY_OWNER: Record<string, [type: string, code: string]> = {
  procedures: ["Group", "finance-operations"],
  prefs: ["Group", "finance-operations"],
  glossary: ["Group", "platform-team"],
  oprules: ["Group", "platform-team"],
  monthend: ["Group", "finance-operations"],
  handoff: ["Agent", "exp"],
};

/** The scope each memory hangs off, taken from the tree the Memory screen draws. */
const MEMORY_SCOPE: Record<string, string> = {
  procedures: "agent/exp",
  prefs: "agent/exp",
  glossary: "org",
  oprules: "org",
  monthend: "unit/Finance",
  handoff: "session/SES-1042",
};

type SourceSeed = { key: string; type: string; name: string; documents: number; status: string; chunksEach: number };

/** One source list per collection; the Policies list is the one the prototype shows. */
const SOURCES: Record<string, SourceSeed[]> = {
  pol: [
    { key: "pol-1", type: "Upload", name: "FIN-POL-007 Travel & Expense Policy.pdf", documents: 1, status: "Indexed", chunksEach: 64 },
    { key: "pol-2", type: "McpResource", name: "SharePoint · /sites/finance/policies", documents: 118, status: "Indexed", chunksEach: 70 },
    { key: "pol-3", type: "UrlCrawl", name: "https://tahseel.ae/en/policies", documents: 21, status: "Indexed", chunksEach: 70 },
    { key: "pol-4", type: "Upload", name: "HR-POL-2026 Leave Policy.docx", documents: 1, status: "Error", chunksEach: 0 },
    { key: "pol-5", type: "Upload", name: "Procurement handbook v4.pdf", documents: 1, status: "Indexing", chunksEach: 0 },
  ],
  svc: [
    { key: "svc-1", type: "McpResource", name: "ServiceNow · service catalogue", documents: 302, status: "Indexed", chunksEach: 47 },
    { key: "svc-2", type: "UrlCrawl", name: "https://tahseel.ae/en/services", documents: 84, status: "Indexed", chunksEach: 48 },
  ],
  faq: [{ key: "faq-1", type: "Upload", name: "Customer FAQ pack 2026.docx", documents: 64, status: "Indexed", chunksEach: 17 }],
  run: [
    { key: "run-1", type: "McpResource", name: "Confluence · IT runbooks", documents: 180, status: "Indexed", chunksEach: 35 },
    { key: "run-2", type: "Upload", name: "Incident playbooks.zip", documents: 30, status: "Error", chunksEach: 35 },
  ],
  ven: [{ key: "ven-1", type: "Upload", name: "Vendor contract archive 2019–2026", documents: 482, status: "Indexing", chunksEach: 25 }],
};

/** Collection settings, as the prototype's Configuration tab shows them. */
const COLLECTIONS = [
  { code: "pol", nameEn: "Policies", nameAr: "السياسات", status: "Ready", project: "FIN", visibility: "Internal", entities: 1210, syncHours: 2, index: "Hybrid", chunk: "Semantic", size: 800, overlap: 120, embedding: "embedding-default", extraction: "classifier-typed", rerank: true, k: 8 },
  { code: "svc", nameEn: "Service catalogue", nameAr: "دليل الخدمات", status: "Ready", project: "CS", visibility: "Internal", entities: 3104, syncHours: 6, index: "Vector", chunk: "RecursiveByHeadings", size: 600, overlap: 80, embedding: "embedding-default", extraction: null, rerank: true, k: 6 },
  { code: "faq", nameEn: "Customer FAQs", nameAr: "الأسئلة الشائعة", status: "Ready", project: "CS", visibility: "Public", entities: 0, syncHours: 24, index: "Vector", chunk: "QaPairs", size: 400, overlap: 0, embedding: "embedding-default", extraction: null, rerank: false, k: 4 },
  { code: "run", nameEn: "IT runbooks", nameAr: "أدلة تشغيل التقنية", status: "Error", project: "IT", visibility: "Confidential", entities: 2080, syncHours: 72, index: "Hybrid", chunk: "FixedSize", size: 1000, overlap: 150, embedding: "embedding-default", extraction: "reasoning-default", rerank: true, k: 8 },
  { code: "ven", nameEn: "Vendor contracts", nameAr: "عقود الموردين", status: "Ingesting", project: "PRC", visibility: "Confidential", entities: 1016, syncHours: 0, index: "Hybrid", chunk: "Semantic", size: 800, overlap: 120, embedding: "local-private", extraction: "local-private", rerank: true, k: 10 },
] as const;

const hoursAgo = (hours: number) => at(hours * 60);

export async function seedKnowledge(db: Database): Promise<void> {
  await db.insert(s.memoryScope).values([
    { id: ids.memoryScope("org"), kind: "Organisation", refId: ids.organisation, parentScopeId: null, path: "org" },
    { id: ids.memoryScope("unit/Finance"), kind: SCOPE_KIND["Business unit"], refId: ids.orgUnit("Finance"), parentScopeId: ids.memoryScope("org"), path: "unit/Finance" },
    { id: ids.memoryScope("agent/exp"), kind: "Agent", refId: ids.agent("exp"), parentScopeId: ids.memoryScope("org"), path: "agent/exp" },
    { id: ids.memoryScope("session/SES-1042"), kind: "Session", refId: ids.room("SES-1042"), parentScopeId: ids.memoryScope("org"), path: "session/SES-1042" },
  ]);

  await db.insert(s.memory).values(
    Object.entries(MEM).map(([key, entry]) => {
      const [ownerType, ownerCode] = MEMORY_OWNER[key];
      const leaf = MEM_TREE.flatMap((group) => group.kids).find((kid) => kid.id === key);
      return {
        id: ids.memory(key),
        scopeId: ids.memoryScope(MEMORY_SCOPE[key]),
        titleEn: leaf ? leaf.n[0] : entry.title[0],
        titleAr: leaf ? leaf.n[1] : entry.title[1],
        path: `${MEMORY_SCOPE[key]}/${key}`,
        // The breadcrumb the detail pane shows above the title.
        accessJson: { labelEn: entry.access[0], labelAr: entry.access[1], pathEn: entry.path[0], pathAr: entry.path[1] },
        ownerType,
        ownerId: ownerType === "Group" ? ids.group(ownerCode) : ids.agent(ownerCode),
        status: MEMORY_STATUS[entry.st],
        writePolicyJson: { requiresReview: entry.scope === "Organisation" },
        // `UC-55.2-03`: the one the tree marks is past its review date, not approaching it.
        // The rest are due in two months.
        reviewDueAt: hoursAgo(entry.warn ? 24 : -24 * 60),
        lastReviewedAt: hoursAgo(entry.warn ? 24 * 89 : 24 * 3),
        currentVersion: entry.v,
      };
    }),
  );

  /** The agent a memory hangs off, when its branch of the tree is an agent's. */
  const agentOf = (key: string) =>
    MEM_TREE.find((group) => group.kids.some((kid) => kid.id === key))?.agent ?? null;

  // The Memory screen's version history is the `procedures` memory; every other memory
  // carries just its current version.
  await db.insert(s.memoryVersion).values(
    Object.entries(MEM).flatMap(([key, entry]) => {
      // `UC-55.2-01`: a memory waiting for review was proposed by the agent whose memory it
      // is, which is what the screen says and what makes the reviewer somebody else.
      const proposer = entry.st === "Pending review" ? (agentOf(key) ?? "u3") : "u3";
      const history = key === "procedures" ? MEM_VER : [[entry.v, "", proposer, ["Current version", "الإصدار الحالي"]] as const];
      return history.map(([versionNumber, , authorCode, note]) => ({
        id: ids.memoryVersion(`${key}:${versionNumber}`),
        memoryId: ids.memory(key),
        versionNumber: Number(versionNumber),
        contentRef: `memory/${key}/${versionNumber}.md`,
        content: null,
        changeNote: (note as readonly string[])[0],
        createdByType: authorCode.startsWith("u") ? "Person" : "Agent",
        createdById: authorCode.startsWith("u") ? ids.person(authorCode) : ids.agent(authorCode),
        restoredFromVersion: null,
      }));
    }),
  );

  await db.insert(s.memoryEntry).values(
    Object.entries(MEM).flatMap(([key, entry]) =>
      entry.items.map((item, index) => ({
        id: ids.memoryEntry(`${key}:${index}`),
        memoryVersionId: ids.memoryVersion(`${key}:${entry.v}`),
        // The first line is the heading the Memory screen shows above the body.
        text: `${item[0][0]}\n${item[1][0]}`,
        sourceType: item[2][0].includes("RUN-") ? "AgentRun" : item[2][0].includes("approved") || item[2][0].includes("Approved") ? "Person" : "Document",
        sourceRef: item[2][0],
      })),
    ),
  );

  await db.insert(s.memoryReview).values([
    {
      id: ids.memory("review:prefs"),
      memoryId: ids.memory("prefs"),
      memoryVersionId: ids.memoryVersion("prefs:3"),
      proposedByAgentId: ids.agent("exp"),
      reviewerPersonId: ids.person("u3"),
      decision: null,
      decidedAt: null,
    },
  ]);

  await db.insert(s.knowledgeCollection).values(
    COLLECTIONS.map((c) => ({
      id: ids.collection(c.code),
      collectionId: c.code,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      projectId: ids.project(c.project),
      visibility: c.visibility,
      status: c.status,
      // The names the configuration screen writes and the list reads. One shape, so a
      // collection reads back as what it was seeded as rather than as the defaults.
      indexConfigJson: { type: c.index, syncSchedule: "Manual", maximumSizeMb: 1024 },
      chunkingConfigJson: {
        technique: c.chunk,
        size: c.size,
        overlap: c.overlap,
        ocr: true,
        arabicNormalisation: true,
        stripHeadersFooters: true,
        maskPii: true,
      },
      modelsConfigJson: { embeddingRoute: c.embedding, extractionRoute: c.extraction },
      retrievalConfigJson: { topK: c.k, minimumScore: 0.35, rerank: c.rerank },
      lastSyncAt: hoursAgo(c.syncHours),
      entityCount: c.entities,
    })),
  );

  await db.insert(s.knowledgeSource).values(
    Object.entries(SOURCES).flatMap(([code, sources]) =>
      sources.map((source) => ({
        id: ids.knowledgeSource(source.key),
        collectionId: ids.collection(code),
        type: source.type,
        name: source.name,
        configJson: {},
        documentCount: source.documents,
        status: source.status,
      })),
    ),
  );

  await db.insert(s.knowledgeDocument).values(
    Object.values(SOURCES).flatMap((sources) =>
      sources.flatMap((source) =>
        Array.from({ length: source.documents }, (_unused, index) => ({
          id: ids.knowledgeSource(`${source.key}:doc:${index}`),
          sourceId: ids.knowledgeSource(source.key),
          title: source.documents === 1 ? source.name : `${source.name} — ${index + 1}`,
          rawRef: `knowledge/${source.key}/${index}.bin`,
          checksum: `sha256:${source.key}:${index}`,
          status: source.status,
          chunkCount: source.chunksEach,
        })),
      ),
    ),
  );

  await db.insert(s.ingestionJob).values([
    {
      id: ids.collection("job:ven"),
      collectionId: ids.collection("ven"),
      sourceId: ids.knowledgeSource("ven-1"),
      kind: "Ingest",
      progress: 62,
      status: "Running",
      startedAt: hoursAgo(0.5),
      endedAt: null,
      temporalWorkflowId: "ingest-ven-1",
      error: null,
    },
    {
      id: ids.collection("job:run"),
      collectionId: ids.collection("run"),
      sourceId: ids.knowledgeSource("run-2"),
      kind: "Reindex",
      progress: 100,
      status: "Failed",
      startedAt: hoursAgo(72),
      endedAt: hoursAgo(71),
      temporalWorkflowId: "reindex-run-2",
      error: "docling: unsupported archive member",
    },
  ]);

  await db.insert(s.retrievalTest).values([
    {
      id: ids.collection("test:pol"),
      collectionId: ids.collection("pol"),
      query: "What is the per-diem for Riyadh?",
      mode: "Hybrid",
      durationMs: 412,
      resultsJson: {
        passages: [
          { ref: "FIN-POL-007 §4.2", text: "Riyadh per-diem is AED 900 per night from 1 October 2026." },
          { ref: "FIN-POL-007 §4.5", text: "Receipts are required above AED 50." },
        ],
        facts: [{ subject: "Riyadh", predicate: "per_diem", object: "AED 900" }],
      },
      runBy: ids.person("u3"),
      runAt: hoursAgo(3),
    },
  ]);
}
