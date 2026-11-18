import { audit } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/concurrency";
import { requireOrganisationPermission } from "@/lib/session";
import { validateFlow } from "./flow";
import type { AttributeDefinition } from "./types";
import * as repository from "./repository";
import type {
  AttributeInput,
  CreateRequestTypeInput,
  PublishRequestTypeInput,
  RemoveAttributeInput,
  SaveDraftInput,
  UpdateAttributeInput,
} from "./schema";
import { FlowNotPublishable, RequestTypeRejected } from "./errors";

/**
 * `UC-30.4-01`: publish the draft, once its flow has no hole. `UC-30.2-05` … `-08` are what "valid" means, and they
 * are checked here rather than on the screen because a published version is pinned by every
 * request raised against it and is immutable from then on — a flow with a hole strands those
 * requests permanently.
 *
 * Saving a draft is never blocked: a designer has to be able to leave work half-finished.
 *
 * @throws {FlowNotPublishable} when publishing a draft whose flow has a hole.
 */
export async function publishRequestType(input: PublishRequestTypeInput): Promise<void> {
  const session = await requireOrganisationPermission("request_types:write");

  // The draft is what publishing promotes, so it is also what the flow rules judge. Reading
  // the type's published version instead would clear a draft on the strength of the version
  // it replaces, which is the one case these rules exist for.
  const versionId = await repository.existingDraftOf(input.code);
  if (!versionId) throw new RequestTypeRejected("There is no draft to publish.", "لا توجد مسودة لنشرها.");
  const detail = await repository.readVersionDetail(versionId);
  const problems = validateFlow(detail?.steps ?? [], detail?.attributes ?? []);
  if (problems.length) throw new FlowNotPublishable(problems);

  await repository.publishVersion(versionId, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "request_types:write",
    objectType: "RequestType",
    objectLabel: input.code,
    detail: { status: "Published" },
  });
}

/** `UC-27.2-02` and `-03`: a new request type, opened on an empty draft. */
export async function createRequestType(input: CreateRequestTypeInput): Promise<string> {
  const session = await requireOrganisationPermission("request_types:write");
  try {
    await repository.createRequestType({ ...input, personId: session.personId });
  } catch (problem) {
    // The code is unique by index, so a duplicate fails here rather than producing a second
    // type nothing can tell apart.
    if (isUniqueViolation(problem)) {
      throw new RequestTypeRejected(
        `The code ${input.code} is already in use.`,
        `الرمز ${input.code} مستخدم بالفعل.`,
      );
    }
    throw problem;
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "request_types:write",
    objectType: "RequestType",
    objectLabel: input.code,
    detail: { created: true, decomposition: input.decomposition },
  });
  return input.code;
}

/**
 * Delete a request type with all its versions. Its requests go with it only when the caller
 * asks (`withRequests`); either way it is refused while anything outside it still points at
 * it or at those requests, so nothing is left pointing at a type that is gone.
 */
export async function deleteRequestType(code: string, withRequests = false): Promise<void> {
  const session = await requireOrganisationPermission("request_types:write");
  const blockers = await repository.requestTypeDeleteBlockers(code);
  if (!blockers) throw new RequestTypeRejected("That request type no longer exists.", "لم يعد نوع الطلب هذا موجوداً.");

  const counted = (rows: [number, string, string][]) => rows.filter(([count]) => count > 0);
  const inUse = counted([
    [withRequests ? 0 : blockers.requests, "requests", "طلبات"],
    [blockers.workItems, "work items", "بنود عمل"],
    [blockers.schedules, "schedules", "جدولات"],
    [blockers.storylineSteps, "storyline steps", "خطوات قصص"],
    [withRequests ? blockers.approvals : 0, "approvals on its requests", "موافقات على طلباته"],
    [withRequests ? blockers.deploymentConversations : 0, "deployment conversations", "محادثات نشر"],
    [withRequests ? blockers.childRequests : 0, "child requests of other types", "طلبات فرعية من أنواع أخرى"],
    [withRequests ? blockers.scheduleRuns : 0, "schedule runs", "تشغيلات جدولة"],
  ]);
  if (inUse.length) {
    const offer = !withRequests && blockers.requests > 0;
    throw new RequestTypeRejected(
      `The request type ${code} cannot be deleted: ${inUse.map(([count, en]) => `${count} ${en}`).join(", ")} still use it.` +
        (offer ? " Delete it with its requests to remove those too." : ""),
      `لا يمكن حذف نوع الطلب ${code}: لا تزال ${inUse.map(([count, , ar]) => `${count} ${ar}`).join("، ")} تستخدمه.` +
        (offer ? " احذفه مع طلباته لإزالتها أيضاً." : ""),
    );
  }

  await repository.deleteRequestType(code, withRequests);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "request_types:write",
    objectType: "RequestType",
    objectLabel: code,
    detail: { deleted: true, requestsDeleted: withRequests ? blockers.requests : 0 },
  });
}

/** The draft a designer change applies to, made from the published version if needed. */
export async function draftOf(code: string): Promise<string> {
  const versionId = await repository.draftVersionOf(code);
  if (!versionId) throw new RequestTypeRejected("That request type no longer exists.", "لم يعد نوع الطلب هذا موجوداً.");
  return versionId;
}

/** `UC-30.1-01`: save the draft. The published version is untouched. */
export async function saveDraft(input: SaveDraftInput): Promise<void> {
  const session = await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  await repository.saveDraftGeneral(
    versionId,
    {
      categoryEn: input.categoryEn,
      decomposition: input.decomposition,
      slaValue: input.slaValue,
      slaUnit: input.slaUnit,
      defaultProjectKey: input.defaultProjectKey,
      intakeChannels: input.intakeChannels,
      entryModes: input.entryModes,
    },
    session.personId,
  );
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "request_types:write",
    objectType: "RequestType",
    objectLabel: input.code,
    detail: { draft: true, entryModes: input.entryModes, intakeChannels: input.intakeChannels },
  });
}

/**
 * `UC-30.3-01` and `-02`: an attribute of the draft. Its key is unique within the version. It
 * is asked on the request form, or at one step of the draft (D304).
 */
export async function addAttribute(input: AttributeInput): Promise<void> {
  await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  const step = input.stepName
    ? (await repository.stepsOfVersion(versionId)).find((one) => one.nameEn === input.stepName)
    : null;
  if (input.stepName && !step) {
    throw new RequestTypeRejected(`No step named ${input.stepName}.`, `لا توجد خطوة باسم ${input.stepName}.`);
  }
  try {
    await repository.addAttribute(versionId, {
      key: input.key,
      labelEn: input.labelEn,
      labelAr: input.labelAr,
      dataType: input.dataType,
      required: input.required,
      enumValues: input.dataType === "Enum" ? input.enumValues : null,
      stepId: step?.id ?? null,
    });
  } catch (problem) {
    if (isUniqueViolation(problem)) {
      throw new RequestTypeRejected(
        `There is already an attribute called ${input.key}.`,
        `توجد سمة باسم ${input.key} بالفعل.`,
      );
    }
    throw problem;
  }
}

/**
 * D304: change one attribute of the draft: its labels, type, required flag, a list's choices,
 * where it is asked or its place in the order (D316). Its key stays, because requests store
 * values under it. Returns it before and after.
 */
export async function updateAttribute(
  input: UpdateAttributeInput,
): Promise<{ before: AttributeDefinition; after: AttributeDefinition }> {
  await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  const before = (await repository.attributesOfVersion(versionId)).find((one) => one.key === input.key);
  if (!before) throw new RequestTypeRejected(`There is no attribute ${input.key}.`, `لا توجد سمة ${input.key}.`);

  const dataType = input.dataType ?? before.dataType;
  const enumValues = dataType === "Enum" ? (input.enumValues !== undefined ? input.enumValues : before.enumValues) : null;
  if (dataType === "Enum" && !enumValues?.length) {
    throw new RequestTypeRejected("A list needs at least one choice.", "تحتاج القائمة إلى خيار واحد على الأقل.");
  }
  let stepId: string | null | undefined;
  if (input.stepName !== undefined) {
    const step = input.stepName === null ? null : (await repository.stepsOfVersion(versionId)).find((one) => one.nameEn === input.stepName);
    if (input.stepName !== null && !step) {
      throw new RequestTypeRejected(`No step named ${input.stepName}.`, `لا توجد خطوة باسم ${input.stepName}.`);
    }
    stepId = step?.id ?? null;
  }
  const written = await repository.updateAttribute(versionId, input.key, {
    ...(input.labelEn === undefined ? {} : { labelEn: input.labelEn }),
    ...(input.labelAr === undefined ? {} : { labelAr: input.labelAr }),
    ...(input.dataType === undefined ? {} : { dataType: input.dataType }),
    ...(input.required === undefined ? {} : { required: input.required }),
    enumValues,
    ...(stepId === undefined ? {} : { stepId }),
    ...(input.position === undefined ? {} : { position: input.position }),
  });
  if (!written) throw new RequestTypeRejected(`There is no attribute ${input.key}.`, `لا توجد سمة ${input.key}.`);
  const after = (await repository.attributesOfVersion(versionId)).find((one) => one.key === input.key) as AttributeDefinition;
  return { before, after };
}

/** `UC-30.3-03`: remove an attribute from the draft. Values on open requests are kept. */
export async function removeAttribute(input: RemoveAttributeInput): Promise<void> {
  await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  await repository.removeAttribute(versionId, input.key);
}
