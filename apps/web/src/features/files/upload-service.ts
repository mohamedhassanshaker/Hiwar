import { audit } from "@/lib/audit";
import { buckets, getObject, objectStoreConfigured, putObject } from "@/lib/objects";
import { requirePermission, requireProjectPermission, visibleProjectIds } from "@/lib/session";
import { bytesOfDataUrl, quarantineReason, uploadRefusal } from "@/lib/uploads";
import { noteAttachmentInRoom } from "@/features/rooms/service";
import * as repository from "./repository";
import type { AttachFileInput, AttachHeldInput, CreateArtifactInput, SearchHeldInput, UploadFileInput } from "./schema";
import { FileRejected } from "./errors";

/**
 * `UC-33.1-01` … `-05`: store an uploaded file under the scope it was given.
 *
 * The bytes are checked before anything is stored, and checked again for what they actually
 * are: a file whose content contradicts its name is held rather than served back, because
 * the platform hands these files to agents as context. Requires `files:write` in the project.
 */
export async function uploadFile(input: UploadFileInput): Promise<{ id: string; name: string; quarantined: string | null }> {
  const session = await requirePermission("files:write");
  const projectId = await repository.projectIdByKey(input.projectKey);
  if (!projectId) throw new FileRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  await requireProjectPermission("files:write", projectId);

  const decoded = bytesOfDataUrl(input.dataUrl);
  if (!decoded) throw new FileRejected("That file could not be read.", "تعذّرت قراءة هذا الملف.");

  const refusal = uploadRefusal({ name: input.name, mimeType: decoded.mimeType, size: decoded.bytes.byteLength });
  if (refusal) throw new FileRejected(refusal.en, refusal.ar);

  if (!objectStoreConfigured()) throw new FileRejected("The file store is not available.", "مخزن الملفات غير متاح.");

  // `UC-33.1-05`: a flagged file is kept but not usable, and the person is told why.
  const quarantined = quarantineReason(decoded.mimeType, decoded.bytes);

  const contentRef = await putObject(
    buckets.files,
    `projects/${input.projectKey}/${Date.now()}-${input.name}`,
    decoded.bytes,
    decoded.mimeType,
  );

  const id = await repository.insertFile({
    projectKey: input.projectKey,
    name: input.name,
    contentRef,
    size: decoded.bytes.byteLength,
    mimeType: decoded.mimeType,
    scopeOfUse: input.scope,
    status: quarantined ? "Quarantined" : "Active",
    grants: input.grants,
    uploadedBy: session.personId,
  });

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "files:write",
    objectType: "ProjectFile",
    objectLabel: input.name,
    detail: { project: input.projectKey, scope: input.scope, quarantined: quarantined?.en ?? null },
  });
  return { id, name: input.name, quarantined: quarantined?.en ?? null };
}

/**
 * A file or an artifact the platform holds, read for another feature to copy (D266): the
 * person must be able to read it — its project and, for a file, its scope of use — as for
 * `attachHeld`. Null when it is not one they may read.
 */
export async function readHeld(
  kind: "File" | "Artifact",
  id: string,
): Promise<{ name: string; mimeType: string; bytes: Uint8Array } | null> {
  const session = await requirePermission("files:read");
  const held = await repository.readableHeld(kind, id, await visibleProjectIds("files:read"), session.personId);
  if (!held) return null;
  if (!objectStoreConfigured()) throw new FileRejected("The file store is not available.", "مخزن الملفات غير متاح.");
  const object = await getObject(held.contentRef);
  if (!object) throw new FileRejected("That file's content is missing.", "محتوى هذا الملف مفقود.");
  return { name: held.name, mimeType: held.mimeType, bytes: new Uint8Array(await new Response(object.body).arrayBuffer()) };
}

/**
 * `UC-25.1-03`: attach a file to a request or a work item.
 *
 * It belongs to the item, not to the project's files: whoever may see the item may read it,
 * and it is listed on the item rather than on the Files screen. The same type and size rules
 * apply, because they are about what the platform will store at all.
 */
export async function attachFile(input: AttachFileInput): Promise<{ name: string }> {
  const session = await requirePermission("files:write");

  const owner = await repository.attachmentOwner(input.ownerType, input.ownerKey);
  if (!owner) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
  const visible = await visibleProjectIds("files:write");
  if (visible !== null && !visible.includes(owner.projectId)) {
    throw new FileRejected("That item is not yours to change.", "ليس لك صلاحية تغيير هذا البند.");
  }

  const decoded = bytesOfDataUrl(input.dataUrl);
  if (!decoded) throw new FileRejected("That file could not be read.", "تعذّرت قراءة هذا الملف.");
  const refusal = uploadRefusal({ name: input.name, mimeType: decoded.mimeType, size: decoded.bytes.byteLength });
  if (refusal) throw new FileRejected(refusal.en, refusal.ar);
  // `UC-25.1-05`: a file the scanner flags is not attached at all, rather than attached and
  // unreadable: an attachment carries no status of its own for a screen to explain.
  const quarantined = quarantineReason(decoded.mimeType, decoded.bytes);
  if (quarantined) throw new FileRejected(quarantined.en, quarantined.ar);

  if (!objectStoreConfigured()) throw new FileRejected("The file store is not available.", "مخزن الملفات غير متاح.");
  const contentRef = await putObject(
    buckets.attachments,
    `${input.ownerKey}/${input.name}`,
    decoded.bytes,
    decoded.mimeType,
  );

  await repository.insertAttachment({
    ownerType: input.ownerType,
    ownerId: owner.id,
    fileName: input.name,
    contentRef,
    size: decoded.bytes.byteLength,
    mimeType: decoded.mimeType,
    uploadedBy: session.personId,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "files:write",
    objectType: input.ownerType,
    objectLabel: input.ownerKey,
    detail: { attached: input.name },
  });
  // An attachment to a room reads as a normal entry in its own transcript, not only as a row
  // in the Files panel — the owner's own feedback on the gap: an agent reading the discussion
  // to decide what it is about would otherwise never know the file is there.
  if (input.ownerType === "Room") await noteAttachmentInRoom(input.ownerKey, input.name, session.personId);
  return { name: input.name };
}

/** `UC-25.1-03`: the files or artifacts the person may read that a picker can attach. */
export async function searchHeld(input: SearchHeldInput): Promise<repository.HeldItem[]> {
  const session = await requirePermission("files:read");
  return repository.searchHeld(input.kind, input.q, await visibleProjectIds("files:read"), session.personId, 20);
}

/**
 * `UC-25.1-03`, `UC-23.1-07`: attach a file or an artifact the platform already holds to a
 * request, a work item or a room.
 *
 * The person has to be able to read it — its project and, for a file, its scope of use —
 * and to change the item. The bytes are copied, so the attachment belongs to the item and
 * outlives the file or artifact it came from.
 */
export async function attachHeld(input: AttachHeldInput): Promise<{ name: string }> {
  const session = await requirePermission("files:write");

  const owner = await repository.attachmentOwner(input.ownerType, input.ownerKey);
  if (!owner) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
  const writable = await visibleProjectIds("files:write");
  if (writable !== null && !writable.includes(owner.projectId)) {
    throw new FileRejected("That item is not yours to change.", "ليس لك صلاحية تغيير هذا البند.");
  }
  const held = await repository.readableHeld(input.kind, input.id, await visibleProjectIds("files:read"), session.personId);
  if (!held) {
    throw new FileRejected(
      `That ${input.kind === "File" ? "file" : "artifact"} is not one you may read.`,
      `هذا ${input.kind === "File" ? "الملف" : "المخرج"} ليس مما يمكنك قراءته.`,
    );
  }

  if (!objectStoreConfigured()) throw new FileRejected("The file store is not available.", "مخزن الملفات غير متاح.");
  const object = await getObject(held.contentRef);
  if (!object) throw new FileRejected("That file's content is missing.", "محتوى هذا الملف مفقود.");
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  const contentRef = await putObject(buckets.attachments, `${input.ownerKey}/${held.name}`, bytes, held.mimeType);

  await repository.insertAttachment({
    ownerType: input.ownerType,
    ownerId: owner.id,
    fileName: held.name,
    contentRef,
    size: bytes.byteLength,
    mimeType: held.mimeType,
    uploadedBy: session.personId,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "files:write",
    objectType: input.ownerType,
    objectLabel: input.ownerKey,
    detail: { attached: held.name, from: input.kind, id: input.id },
  });
  if (input.ownerType === "Room") await noteAttachmentInRoom(input.ownerKey, held.name, session.personId);
  return { name: held.name };
}

/** The permission that reads each kind of item an artifact may be linked to. */
const LINK_READ_PERMISSION = { WorkItem: "work_items:read", Request: "requests:read", Room: "rooms:read" } as const;

/**
 * `UC-32.1-01`: create a new, versioned artifact — what a run (or a person) just produced,
 * not a file uploaded from somewhere else.
 *
 * `session.actingAgent` is what makes this the same call whether a person drags a file in
 * or a run's `generate_document` result reaches here over the platform MCP server: the
 * person is always who the permission and the project visibility are checked against, and
 * the agent, when there is one, is who the artifact says actually produced it.
 *
 * Requires `files:write` in the artifact's project and, for a linked item, its read permission
 * in the item's project.
 */
export async function createArtifact(input: CreateArtifactInput): Promise<{ id: string; contentRef: string }> {
  const session = await requirePermission("files:write");

  const decoded = bytesOfDataUrl(input.dataUrl);
  if (!decoded) throw new FileRejected("That file could not be read.", "تعذّرت قراءة هذا الملف.");
  const refusal = uploadRefusal({ name: input.fileName, mimeType: decoded.mimeType, size: decoded.bytes.byteLength });
  if (refusal) throw new FileRejected(refusal.en, refusal.ar);
  const quarantined = quarantineReason(decoded.mimeType, decoded.bytes);
  if (quarantined) throw new FileRejected(quarantined.en, quarantined.ar);
  if (!objectStoreConfigured()) throw new FileRejected("The file store is not available.", "مخزن الملفات غير متاح.");

  let linkedToId: string | null = null;
  let linkedProjectKey: string | null = null;
  if (input.linkedToType && input.linkedToKey) {
    const linked = await repository.linkedToOwner(input.linkedToType, input.linkedToKey);
    if (!linked) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
    await requireProjectPermission(LINK_READ_PERMISSION[input.linkedToType], linked.projectId);
    linkedToId = linked.id;
    linkedProjectKey = linked.projectKey;
  }
  // A linked artifact stands in its item's project unless one is named.
  const projectKey = input.projectKey ?? linkedProjectKey;
  if (!projectKey) {
    throw new FileRejected("Name the project, or the item the artifact belongs to.", "حدّد المشروع أو البند الذي يتبع له الملف.");
  }
  const projectId = await repository.projectIdByKey(projectKey);
  if (!projectId) throw new FileRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  await requireProjectPermission("files:write", projectId);

  const contentRef = await putObject(
    buckets.artifacts,
    `${projectKey}/${Date.now()}-${input.fileName}`,
    decoded.bytes,
    decoded.mimeType,
  );

  const created = await repository.insertArtifact({
    projectId,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    producedByType: session.actingAgent ? "Agent" : "Person",
    producedById: session.actingAgent?.id ?? session.personId,
    runId: input.runId ?? null,
    linkedToType: input.linkedToType ?? null,
    linkedToId,
    contentRef,
    size: decoded.bytes.byteLength,
    mimeType: decoded.mimeType,
    actedBy: session.personId,
  });

  await audit({
    actor: session.actingAgent
      ? { type: "Agent", id: session.actingAgent.id, label: session.actingAgent.label }
      : { type: "Person", id: session.personId, label: session.nameEn },
    action: "files:write",
    objectType: "Artifact",
    objectLabel: input.titleEn,
    detail: { project: projectKey, linkedTo: input.linkedToKey ?? null },
  });
  return { id: created.id, contentRef };
}

/**
 * The names of artifacts linked to one item since a given moment — what a run that just
 * finished produced there, for the reply that names it.
 *
 * No permission check of its own: the caller is a run already authorised to post into the
 * context it names (`agents/run-service.ts`'s `finishRun`), and this only reads what that
 * run itself just wrote through `createArtifact` above.
 */
export async function artifactsProducedSince(
  linkedToType: string,
  linkedToId: string,
  since: Date,
): Promise<string[]> {
  const rows = await repository.artifactsLinkedSince(linkedToType, linkedToId, since);
  return rows.map((row) => row.nameEn);
}
