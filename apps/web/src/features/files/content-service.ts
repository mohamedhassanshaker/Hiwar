import { audit } from "@/lib/audit";
import { extractDocumentText } from "@/lib/documents";
import { getObject } from "@/lib/objects";
import { ALLOWED_UPLOAD_TYPES } from "@/lib/uploads";
import { requirePermission, visibleProjectIds } from "@/lib/session";
import * as repository from "./repository";
import { FileRejected } from "./errors";
import { PREVIEWABLE, type Preview } from "./types";

/**
 * `UC-32.1-02` and `UC-33.1-08`: the bytes of one file or artifact, for the preview and the
 * download.
 *
 * Served through the console rather than as a link to the store, because the store has no
 * route of its own and a check the browser could skip is not a check. A file carries a scope
 * of use, so the read is decided on the file's own terms as well as on the project's.
 *
 * @throws {FileRejected} when it is gone, quarantined, or outside this reader's scope.
 */
export async function readContent(
  name: string,
  kind: "artifact" | "file" | "attachment",
  owner?: { type: "Request" | "WorkItem" | "Room"; key: string },
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; size: number | null }> {
  const session = await requirePermission("files:read");

  if (kind === "attachment") return readAttachment(name, owner, session.personId);

  const stored = await repository.contentOf(name, kind);
  if (!stored) throw new FileRejected("That file no longer exists.", "لم يعد هذا الملف موجوداً.");

  // `UC-32.1-07`: a project this person cannot see has no readable content either.
  const visible = await visibleProjectIds("files:read");
  if (visible !== null && !visible.includes(stored.projectId)) {
    throw new FileRejected("That file is not yours to read.", "ليس لك صلاحية قراءة هذا الملف.");
  }

  // A file carries a scope of use of its own; an artifact belongs to its project alone.
  if (kind === "file") {
    const allowed = await mayReadFile(name, {
      type: "Person",
      id: session.personId,
      label: session.nameEn,
    });
    if (!allowed) throw new FileRejected("That file is not yours to read.", "ليس لك صلاحية قراءة هذا الملف.");
  }

  // `UC-33.1-05`: a quarantined file is kept for the record and read by nobody.
  if (stored.status === "Quarantined") throw new FileRejected("That file was quarantined by the virus scan.", "عُزل هذا الملف في فحص الفيروسات.");

  const object = await getObject(stored.contentRef);
  if (!object) throw new FileRejected("That file is no longer in the store.", "لم يعد هذا الملف في المخزن.");
  // The length is the object's own, not the row's: a `content-length` that disagrees with
  // the body leaves the browser waiting for bytes that never arrive.
  return { body: object.body, contentType: stored.mimeType || object.contentType, size: object.size };
}

/** The office formats the preview reads as text through the document parser. */
const READ_AS_TEXT = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/**
 * `UC-32.1-02`: what the preview draws, decided from the stored type rather than from what
 * the screen that opened it knew. A type the browser draws is drawn from `/api/files`; a
 * Word, Excel or PowerPoint file is read by the agent service's document parser, the one a
 * receipt goes through, and shown as Markdown with its tables.
 *
 * @throws {FileRejected} as `readContent` does.
 */
export async function previewOf(
  name: string,
  kind: "artifact" | "file" | "attachment",
  owner?: { type: "Request" | "WorkItem" | "Room"; key: string },
): Promise<Preview> {
  const content = await readContent(name, kind, owner);
  if (!READ_AS_TEXT.has(content.contentType)) {
    await content.body.cancel();
    return PREVIEWABLE.has(content.contentType) ? { mode: "inline" } : { mode: "none" };
  }
  const bytes = Buffer.from(await new Response(content.body).arrayBuffer());
  // The parser reads the format from the extension, which an artifact's name often lacks.
  const extension = ALLOWED_UPLOAD_TYPES.get(content.contentType) ?? "";
  const named = name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
  const read = await extractDocumentText(named, bytes.toString("base64"));
  return read.ok ? { mode: "text", text: read.text } : { mode: "none", reason: read.reason, reasonAr: read.reasonAr };
}

/**
 * An attachment's bytes: its item decides who may read it.
 *
 * There is no scope of use on an attachment, because it is part of the thing it is attached
 * to. Seeing the request or the work item is what grants it.
 */
async function readAttachment(
  name: string,
  owner: { type: "Request" | "WorkItem" | "Room"; key: string } | undefined,
  personId: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; size: number | null }> {
  if (!owner) throw new FileRejected("An attachment is read through the item it is on.", "يُقرأ المرفق من خلال البند المرفق به.");

  const item = await repository.attachmentOwner(owner.type, owner.key);
  if (!item) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
  const visible = await visibleProjectIds("files:read");
  if (visible !== null && !visible.includes(item.projectId)) {
    await audit({
      actor: { type: "Person", id: personId, label: owner.key },
      action: "files:read",
      objectType: owner.type,
      objectLabel: name,
      outcome: "Denied",
      detail: { reason: "outside the project the item belongs to" },
    });
    throw new FileRejected("That file is not yours to read.", "ليس لك صلاحية قراءة هذا الملف.");
  }

  const stored = await repository.attachmentContentOf(item.id, name);
  if (!stored) throw new FileRejected("That file no longer exists.", "لم يعد هذا الملف موجوداً.");
  const object = await getObject(stored.contentRef);
  if (!object) throw new FileRejected("That file is no longer in the store.", "لم يعد هذا الملف في المخزن.");
  return { body: object.body, contentType: stored.mimeType || object.contentType, size: object.size };
}

/**
 * `UC-33.1-06`: whether one principal may read a file, and the record of a refusal.
 *
 * Called with the agent's own id when a run asks for a file, so an agent outside the scope
 * is refused on the file's own terms rather than on the permissions of the person it acts
 * for. A denial is audited, because a denial is what an investigation looks for.
 */
export async function mayReadFile(name: string, principal: { type: "Person" | "Agent"; id: string; label: string }): Promise<boolean> {
  const allowed = await repository.fileReadableBy(name, principal.id);
  if (!allowed) {
    await audit({
      actor: { type: principal.type, id: principal.id, label: principal.label },
      action: "files:read",
      objectType: "ProjectFile",
      objectLabel: name,
      outcome: "Denied",
      detail: { reason: "outside the file's scope of use" },
    });
  }
  return allowed;
}
