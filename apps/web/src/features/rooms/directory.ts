"use server";

import { requirePermission } from "@/lib/session";
import * as repository from "./repository";

/**
 * `UC-22.2-05`: which agents a project allows, so the room's participant picker offers
 * only those. `null` means the project has no allow-list, which is every agent.
 */
export async function allowedAgentsFor(projectKey: string): Promise<string[] | null> {
  await requirePermission("rooms:write");
  return repository.allowedAgentCodesForProject(projectKey);
}
