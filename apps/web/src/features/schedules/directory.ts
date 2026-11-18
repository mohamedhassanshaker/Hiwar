"use server";

import { loadPublishedTypes, type PublishedType } from "@/features/requests/directory";
import { requirePermission, requireProjectPermission } from "@/lib/session";
import * as repository from "./repository";
import type { ScheduleForm } from "./repository";

/**
 * What the schedule modal needs before it can draw itself: the request types a firing may
 * raise and the groups it may be addressed to. Nothing else in the console needs either.
 */
export type ScheduleOptions = {
  requestTypes: { code: string; nameEn: string; nameAr: string }[];
  groups: { id: string; nameEn: string; nameAr: string }[];
};

/** The request types and groups the schedule modal offers. Requires `schedules:write`. */
export async function loadScheduleOptions(): Promise<ScheduleOptions> {
  await requirePermission("schedules:write");
  const [types, groups] = await Promise.all([loadPublishedTypes(), repository.listGroups()]);
  return {
    requestTypes: types.map((type: PublishedType) => ({ code: type.code, nameEn: type.nameEn, nameAr: type.nameAr })),
    groups,
  };
}

/** `UC-31.1-04`: the schedule the Edit link names, as the modal prefills it. Needs `schedules:write` in its project. */
export async function loadSchedule(id: string): Promise<ScheduleForm | null> {
  await requirePermission("schedules:write");
  const projectId = await repository.projectIdOf(id);
  if (!projectId) return null;
  await requireProjectPermission("schedules:write", projectId);
  return repository.readForEditing(id);
}
