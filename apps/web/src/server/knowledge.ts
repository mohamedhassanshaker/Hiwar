import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { deleteChunks, ingest } from "./agent-service";
import { Refused } from "./api";
import { audit } from "./audit";
import { env } from "./env";
import { publish } from "./live";
import { notify } from "./notifications";
import { orgPlan } from "./plans";
import type { MemberContext } from "./session";

/** KNO-001 and KNO-002. */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
};

function filesDir(): string {
  return path.resolve(process.cwd(), env().FILES_DIR);
}

export async function listSources(orgId: string) {
  return db.query.sources.findMany({ where: eq(schema.sources.orgId, orgId), orderBy: desc(schema.sources.createdAt) });
}

export async function storageUsed(orgId: string): Promise<number> {
  const [{ bytes }] = await db
    .select({ bytes: sql<number>`coalesce(sum(${schema.sources.bytes}), 0)::bigint` })
    .from(schema.sources)
    .where(eq(schema.sources.orgId, orgId));
  return Number(bytes);
}

/** FR-017: refuses a file that would pass the plan's knowledge storage. */
async function checkStorage(member: MemberContext, adding: number): Promise<void> {
  const { limits } = await orgPlan(member.org);
  if ((await storageUsed(member.org.id)) + adding > limits.storageGb * 1024 ** 3) {
    throw new Refused(`This would pass the ${limits.storageGb} GB of knowledge storage on your plan. Upgrade to add more.`, 402, { upgrade: true });
  }
}

async function startIngest(source: typeof schema.sources.$inferSelect): Promise<void> {
  try {
    await ingest({
      org_id: source.orgId,
      source_id: source.id,
      type: source.type,
      file: source.details.file,
      mime: source.details.mime,
      url: source.details.url,
      depth: source.details.depth,
      domains: source.details.domains,
      question: source.details.question,
      answer: source.details.answer,
    });
  } catch (problem) {
    await setStatus(source.id, { status: "failed", reason: "The preparation service is not reachable. Try again." });
    console.error(problem);
  }
}

export async function addFile(member: MemberContext, file: File): Promise<void> {
  const ext = path.extname(file.name).toLowerCase();
  if (!FILE_TYPES[ext]) throw new Refused(`${file.name}: use PDF, DOCX, TXT, MD or CSV.`, 415);
  if (file.size > MAX_FILE_BYTES) throw new Refused(`${file.name} is larger than 25 MB.`, 413);
  await checkStorage(member, file.size);
  const [source] = await db
    .insert(schema.sources)
    .values({ orgId: member.org.id, name: file.name, type: "file", bytes: file.size, details: { mime: FILE_TYPES[ext] } })
    .returning();
  const relative = path.join(member.org.id, `${source.id}${ext}`);
  await mkdir(path.join(filesDir(), member.org.id), { recursive: true });
  await writeFile(path.join(filesDir(), relative), Buffer.from(await file.arrayBuffer()));
  const [stored] = await db
    .update(schema.sources)
    .set({ details: { mime: FILE_TYPES[ext], file: relative.replace(/\\/g, "/") } })
    .where(eq(schema.sources.id, source.id))
    .returning();
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Knowledge", action: "Added a source", item: file.name, change: `File · ${(file.size / 1024 / 1024).toFixed(1)} MB` });
  await startIngest(stored);
}

export const websiteInput = z.object({
  url: z.string().url("Enter the full address, for example https://example.com/help."),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  domains: z.array(z.string().trim().min(1)).max(10),
});

export async function addWebsite(member: MemberContext, input: z.infer<typeof websiteInput>): Promise<void> {
  // FR-017: a crawl's size is known only after it runs, so a crawl is refused once storage is full.
  await checkStorage(member, 1);
  const url = new URL(input.url);
  if (!/^https?:$/.test(url.protocol)) throw new Refused("Only http and https addresses can be crawled.");
  const [source] = await db
    .insert(schema.sources)
    .values({
      orgId: member.org.id,
      name: `${url.host}${url.pathname === "/" ? "" : url.pathname}`,
      type: "website",
      details: { url: url.toString(), depth: input.depth, domains: input.domains.length ? input.domains : [url.hostname] },
    })
    .returning();
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Knowledge", action: "Added a source", item: source.name, change: `Website · depth ${input.depth}` });
  await startIngest(source);
}

export const faqInput = z.object({ question: z.string().trim().min(3).max(500), answer: z.string().trim().min(1).max(4000) });

export async function addFaq(member: MemberContext, input: z.infer<typeof faqInput>, origin = "Added a source"): Promise<void> {
  const [source] = await db
    .insert(schema.sources)
    .values({ orgId: member.org.id, name: input.question.slice(0, 120), type: "faq", bytes: input.question.length + input.answer.length, details: input })
    .returning();
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Knowledge", action: origin, item: source.name, change: "FAQ entry" });
  await startIngest(source);
}

async function ownSource(orgId: string, sourceId: string) {
  const source = await db.query.sources.findFirst({ where: and(eq(schema.sources.id, sourceId), eq(schema.sources.orgId, orgId)) });
  if (!source) throw new Refused("This source does not exist.", 404);
  return source;
}

/** Re-crawl (websites), Retry (failed) and Replace (files, with the new file) all prepare again. */
export async function reprocess(member: MemberContext, sourceId: string, replacement?: File): Promise<void> {
  const source = await ownSource(member.org.id, sourceId);
  let details = source.details;
  let bytes = source.bytes;
  if (replacement) {
    if (source.type !== "file") throw new Refused("Only files can be replaced.");
    const ext = path.extname(replacement.name).toLowerCase();
    if (!FILE_TYPES[ext]) throw new Refused("Use PDF, DOCX, TXT, MD or CSV.", 415);
    if (replacement.size > MAX_FILE_BYTES) throw new Refused("The file is larger than 25 MB.", 413);
    await checkStorage(member, replacement.size - source.bytes);
    const relative = path.join(member.org.id, `${source.id}${ext}`);
    await writeFile(path.join(filesDir(), relative), Buffer.from(await replacement.arrayBuffer()));
    details = { mime: FILE_TYPES[ext], file: relative.replace(/\\/g, "/") };
    bytes = replacement.size;
  }
  const [updated] = await db
    .update(schema.sources)
    .set({ status: "queued", reason: null, details, bytes, updatedAt: new Date(), name: replacement?.name ?? source.name })
    .where(eq(schema.sources.id, source.id))
    .returning();
  const action = replacement ? "Replaced a source" : source.type === "website" ? "Re-crawled a source" : "Retried a source";
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Knowledge", action, item: updated.name });
  await startIngest(updated);
}

/** FR-018: a disabled source is not retrieved and its chunks do not count as searchable. */
export async function setEnabled(member: MemberContext, sourceId: string, enabled: boolean): Promise<void> {
  const source = await ownSource(member.org.id, sourceId);
  await db.update(schema.sources).set({ enabled, updatedAt: new Date() }).where(eq(schema.sources.id, source.id));
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Knowledge", action: enabled ? "Enabled a source" : "Disabled a source", item: source.name });
}

/** FR-014: after confirmation; past conversations keep their citations (stored on the message). */
export async function deleteSource(member: MemberContext, sourceId: string): Promise<string> {
  const source = await ownSource(member.org.id, sourceId);
  await deleteChunks(member.org.id, source.id).catch((problem) => console.error("chunk delete failed", problem));
  await db.delete(schema.sources).where(eq(schema.sources.id, source.id));
  if (source.details.file) await unlink(path.join(filesDir(), source.details.file)).catch(() => undefined);
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Knowledge", action: "Deleted a source", item: source.name, change: `${source.chunks} chunks removed` });
  return source.name;
}

export const statusInput = z.object({
  status: z.enum(["processing", "ready", "failed"]),
  chunks: z.number().int().min(0).optional(),
  reason: z.string().max(500).optional(),
  languages: z.string().max(60).optional(),
  bytes: z.number().int().min(0).nullish(),
});

/** The agent service's callback: Processing, then Ready or Failed with a reason (FR-007). */
export async function setStatus(sourceId: string, input: z.infer<typeof statusInput>): Promise<void> {
  const [source] = await db
    .update(schema.sources)
    .set({
      status: input.status,
      chunks: input.status === "ready" ? (input.chunks ?? 0) : input.status === "failed" ? 0 : sql`${schema.sources.chunks}`,
      // Websites count the text they yielded against knowledge storage.
      bytes: input.bytes ?? sql`${schema.sources.bytes}`,
      reason: input.status === "failed" ? (input.reason ?? "Preparation failed.") : null,
      languages: input.languages ?? sql`${schema.sources.languages}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.sources.id, sourceId))
    .returning();
  if (!source) return;
  if (input.status === "failed") await notify(source.orgId, "source_failed", `${source.name} failed: ${source.reason}`, "/knowledge", source.id);
  await publish(`org:${source.orgId}`, { type: "sources" });
}

// ---------------------------------------------------------------- unanswered questions (KNO-002)

export function questionKey(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "the", "a", "an", "is", "are", "do", "does", "you", "your", "i", "me", "to", "of", "and", "in", "on", "for", "my", "can",
  "what", "how", "it", "be", "with", "at", "or", "from", "this", "that", "have", "please", "there", "any",
  "في", "من", "على", "هل", "ما", "عن", "الى", "او", "مع", "انا", "عندكم", "ممكن",
]);

/** The content words of a question, for grouping differently worded questions (KNO-002 FR-008). */
export function questionTerms(text: string): Set<string> {
  return new Set(
    questionKey(text)
      .split(" ")
      .map((w) => (w.length > 4 && /^[a-z]+$/.test(w) ? w.replace(/(ing|es|s)$/, "") : w.replace(/^ال/, "")))
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Two questions are the same when most of their content words are shared (Jaccard 0.6 or more). */
export function sameQuestion(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / (a.size + b.size - shared) >= 0.6;
}

/** Records a low-confidence question; a dismissed one comes back when asked again (FR-008). */
export async function recordUnanswered(orgId: string, question: string, language: string, suggestion?: string): Promise<void> {
  let key = questionKey(question);
  if (key.length < 3) return;
  const terms = questionTerms(question);
  const known = await db
    .select({ key: schema.unansweredQuestions.key, question: schema.unansweredQuestions.question })
    .from(schema.unansweredQuestions)
    .where(and(eq(schema.unansweredQuestions.orgId, orgId), isNull(schema.unansweredQuestions.answeredAt)));
  const similar = known.find((k) => k.key === key || sameQuestion(terms, questionTerms(k.question)));
  if (similar) key = similar.key;
  const now = new Date().toISOString();
  await db
    .insert(schema.unansweredQuestions)
    .values({ orgId, question, key, language, suggestedAnswer: suggestion ?? null, asks: [now] })
    .onConflictDoUpdate({
      target: [schema.unansweredQuestions.orgId, schema.unansweredQuestions.key],
      set: {
        asks: sql`(${schema.unansweredQuestions.asks} || ${JSON.stringify([now])}::jsonb)`,
        lastAskedAt: new Date(),
        dismissedAt: null,
        answeredAt: null,
      },
    });
}

export async function listUnanswered(orgId: string) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const rows = await db.query.unansweredQuestions.findMany({
    where: and(eq(schema.unansweredQuestions.orgId, orgId), isNull(schema.unansweredQuestions.dismissedAt), isNull(schema.unansweredQuestions.answeredAt), gte(schema.unansweredQuestions.lastAskedAt, new Date(Date.now() - 90 * 86_400_000))),
    orderBy: desc(schema.unansweredQuestions.lastAskedAt),
  });
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    language: r.language === "ar" ? "Arabic" : "English",
    suggestion: r.suggestedAnswer ?? "",
    weekCount: r.asks.filter((a) => new Date(a) >= weekAgo).length,
    lastAskedAt: r.lastAskedAt,
  }));
}

export async function answerQuestion(member: MemberContext, id: string, answer: string): Promise<void> {
  if (!answer.trim()) throw new Refused("Write an answer first.");
  const row = await db.query.unansweredQuestions.findFirst({ where: and(eq(schema.unansweredQuestions.id, id), eq(schema.unansweredQuestions.orgId, member.org.id)) });
  if (!row) throw new Refused("This question is no longer waiting.", 404);
  await addFaq(member, { question: row.question, answer: answer.trim() }, "Added an FAQ from unanswered questions");
  await db.update(schema.unansweredQuestions).set({ answeredAt: new Date() }).where(eq(schema.unansweredQuestions.id, id));
}

export async function dismissQuestion(member: MemberContext, id: string): Promise<void> {
  await db
    .update(schema.unansweredQuestions)
    .set({ dismissedAt: new Date() })
    .where(and(eq(schema.unansweredQuestions.id, id), eq(schema.unansweredQuestions.orgId, member.org.id)));
}
