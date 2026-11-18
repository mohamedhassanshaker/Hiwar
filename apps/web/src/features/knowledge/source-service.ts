import { readHeld } from "@/features/files/service";
import { audit } from "@/lib/audit";
import { buckets, objectStoreConfigured, putObject } from "@/lib/objects";
import { bytesOfDataUrl } from "@/lib/uploads";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { AddSourceInput } from "./schema";
import { KnowledgeRejected } from "./errors";
import { type IngestionOutcome, reindexCollection, removeFromIndex } from "./ingestion-service";

/**
 * `UC-57.1-04`: re-read one source.
 *
 * `UC-57.1-08`: a crawl that is blocked and a connector resource that cannot be reached both
 * surface as the ingestion run not starting. The source says Error with that reason rather
 * than sitting at Indexing for ever, which is indistinguishable from slow.
 */
export async function reindex(sourceId: string): Promise<IngestionOutcome> {
  const session = await requirePermission("knowledge:write");
  const source = await repository.readSource(sourceId);
  if (!source) throw new KnowledgeRejected("That source no longer exists.", "لم يعد هذا المصدر موجوداً.");

  await repository.reindex(sourceId, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "knowledge:reindex",
    objectType: "KnowledgeSource",
    objectId: sourceId,
  });

  const started = await reindexCollection(source.collectionId);
  if (!started.started) {
    await repository.setSourceStatus(sourceId, "Error", started.reason, session.personId);
  }
  return started;
}

/** The file types the parser can read (`UC-57.1-07`). */
const PARSEABLE = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/markdown",
  "text/plain",
]);

/**
 * What adding a source did: refused (`added` false), or added with its indexing started or
 * not. `reason` is why it was refused or why indexing did not start, in both languages.
 */
export type SourceOutcome = { added: boolean; indexing: boolean; reason: string | null; reasonAr: string | null };

const refused = (reason: string, reasonAr: string): SourceOutcome => ({ added: false, indexing: false, reason, reasonAr });

/**
 * `UC-57.1-01` … `-03` and `-07`: a source of documents for the collection.
 *
 * What may be added depends on the type: an upload has to be a file the parser can read, a
 * crawl has to name a URL the platform may fetch, and an MCP resource has to name a
 * connector that exists. A source the platform cannot read is refused here rather than
 * listed as Indexing for ever.
 */
export async function addSource(input: AddSourceInput): Promise<SourceOutcome> {
  const session = await requirePermission("knowledge:write");

  const collection = await repository.readCollectionConfig(input.collectionCode);
  if (!collection) throw new KnowledgeRejected("That collection no longer exists.", "لم تعد هذه المجموعة موجودة.");

  // `UC-57.2-05`: a collection at its ceiling takes no more documents.
  if (collection.currentSizeMb >= collection.maximumSizeMb) {
    return refused(
      `${input.collectionCode} is at its ${collection.maximumSizeMb} MB limit.`,
      `بلغت ${input.collectionCode} حدها البالغ ${collection.maximumSizeMb} ميغابايت.`,
    );
  }

  if (input.type === "Upload" && input.mimeType && !PARSEABLE.has(input.mimeType)) {
    return refused(`${input.mimeType} cannot be indexed.`, `لا يمكن فهرسة ${input.mimeType}.`);
  }
  if (input.type === "UrlCrawl") {
    const refusal = crawlRefusal(input.name);
    if (refusal) return refused(refusal.reason, refusal.reasonAr);
  }

  // `UC-57.1-01`: an upload's files are stored and become the source's documents, which
  // is what the ingestion run then reads. A crawl or an MCP resource finds its own.
  // A held file or artifact is read as the person, so one they may not read is refused (D266).
  const documents: { name: string; decoded: ReturnType<typeof bytesOfDataUrl> }[] = (input.documents ?? []).map((document) => ({
    name: document.name,
    decoded: bytesOfDataUrl(document.dataUrl),
  }));
  for (const held of input.heldFiles ?? []) {
    const read = await readHeld(held.kind, held.id);
    if (!read) {
      return refused(
        `${held.kind === "File" ? "File" : "Artifact"} ${held.id} is not one you may read.`,
        `${held.kind === "File" ? "الملف" : "المخرج"} ${held.id} ليس مما يمكنك قراءته.`,
      );
    }
    documents.push({ name: read.name, decoded: { mimeType: read.mimeType, bytes: read.bytes } });
  }
  const stored: repository.NewKnowledgeDocument[] = [];
  for (const document of documents) {
    const { decoded } = document;
    if (!decoded) return refused(`${document.name} could not be read.`, `تعذرت قراءة ${document.name}.`);
    if (!PARSEABLE.has(decoded.mimeType)) {
      return refused(`${decoded.mimeType} cannot be indexed.`, `لا يمكن فهرسة ${decoded.mimeType}.`);
    }
    if (!objectStoreConfigured()) throw new KnowledgeRejected("The document store is not available.", "مخزن المستندات غير متاح.");
    const reference = await putObject(
      buckets.rawDocuments,
      `${input.collectionCode}/${Date.now()}-${document.name}`,
      decoded.bytes,
      decoded.mimeType,
    );
    stored.push({
      title: document.name,
      rawRef: reference,
      checksum: `sha256:${await digestOf(decoded.bytes)}`,
      sizeBytes: decoded.bytes.byteLength,
    });
  }

  const source = await repository.addSource(input.collectionCode, input.type, input.name, stored, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "knowledge:write",
    objectType: "KnowledgeSource",
    objectLabel: input.name,
    detail: { collection: input.collectionCode, type: input.type },
  });
  // The source's own documents are stored, but nothing has read them yet: `reindexCollection`
  // is what actually starts the ingestion workflow, over every document the collection now
  // holds. Mirrors `reindex()` above — a source added here is otherwise "Indexing" for ever.
  const started = await reindexCollection(input.collectionCode);
  if (!started.started) {
    await repository.setSourceStatus(source.id, "Error", started.reason, session.personId);
  }
  return { added: true, indexing: started.started, reason: started.reason, reasonAr: started.reasonAr };
}

/** `UC-57.1-07`: why a start URL cannot be crawled, or null when it can. */
export function crawlRefusal(startUrl: string): { reason: string; reasonAr: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(startUrl);
  } catch {
    return { reason: "That is not a URL.", reasonAr: "هذا ليس عنوان URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { reason: "A crawl starts at an http or https address.", reasonAr: "يبدأ الزحف من عنوان http أو https." };
  }
  return null;
}

/** `UC-57.1-05`: a source and everything it put into every store. */
export async function removeSource(sourceId: string): Promise<void> {
  const session = await requirePermission("knowledge:write");
  const source = await repository.readSource(sourceId);
  if (!source) throw new KnowledgeRejected("That source no longer exists.", "لم يعد هذا المصدر موجوداً.");

  await removeFromIndex(source.collectionId, await repository.documentIdsOfSource(sourceId));
  const removed = await repository.removeSource(sourceId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "knowledge:write",
    objectType: "KnowledgeSource",
    objectId: sourceId,
    objectLabel: source.name,
    detail: { removed: true, documents: removed?.documents ?? 0, collection: source.collectionId },
  });
}

/** The digest a document is recognised by, so the same bytes are not indexed twice. */
async function digestOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
