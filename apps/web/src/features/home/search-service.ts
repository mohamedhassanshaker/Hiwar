import type { PermissionCode } from "@/authz/permissions";
import { can, requireSession, visibleProjectIds } from "@/lib/session";
import * as repository from "./repository";
import type { SearchInput } from "./schema";
import type { SearchGroup, SearchHit, SearchKind } from "./types";

/**
 * S-02 and requirement 40: what the search palette shows.
 *
 * The eight kinds are the ones specification 6.1 lists, in that order. Each is gated by the
 * permission that gates its own screen, and the four that belong to a project are limited
 * to the projects the person may see (`COM-07`, `UC-02.1-06`), so a record outside their
 * reach is neither listed nor counted. Nothing is filtered on the client.
 */
const SEARCH_KINDS: { kind: SearchKind; permission: PermissionCode; headingEn: string; headingAr: string }[] = [
  { kind: "room", permission: "rooms:read", headingEn: "Discussion rooms", headingAr: "اجتماعات العمل" },
  { kind: "workItem", permission: "work_items:read", headingEn: "Work items", headingAr: "بنود العمل" },
  { kind: "request", permission: "requests:read", headingEn: "Requests", headingAr: "الطلبات" },
  { kind: "agent", permission: "agents:read", headingEn: "Agents", headingAr: "الوكلاء" },
  { kind: "skill", permission: "skills:read", headingEn: "Skills", headingAr: "المهارات" },
  { kind: "connector", permission: "connectors:read", headingEn: "Connectors", headingAr: "التكامل" },
  { kind: "knowledge", permission: "knowledge:read", headingEn: "Knowledge", headingAr: "قاعدة المعرفة" },
  { kind: "artifact", permission: "files:read", headingEn: "Artifacts", headingAr: "المخرجات" },
];

/** The hits of one kind; a project-bound kind is limited to the projects its read permission reaches. */
async function hitsOf(kind: SearchKind, term: string): Promise<SearchHit[]> {
  switch (kind) {
    case "room":
      return repository.searchRooms(term, await visibleProjectIds("rooms:read"));
    case "workItem":
      return repository.searchWorkItems(term, await visibleProjectIds("work_items:read"));
    case "request":
      return repository.searchRequests(term, await visibleProjectIds("requests:read"));
    case "artifact":
      return repository.searchArtifacts(term, await visibleProjectIds("files:read"));
    case "agent":
      return repository.searchAgents(term);
    case "skill":
      return repository.searchSkills(term);
    case "connector":
      return repository.searchConnectors(term);
    case "knowledge":
      return repository.searchKnowledge(term);
  }
}

/**
 * The palette's groups for `term`, in `SEARCH_KINDS` order. A kind the person may not read, or
 * one with no hits, is left out. An empty term returns no groups.
 */
export async function search({ term }: SearchInput): Promise<SearchGroup[]> {
  await requireSession();
  if (term.length === 0) return [];

  const groups = await Promise.all(
    SEARCH_KINDS.map(async (entry) => {
      if (!(await can(entry.permission))) return null;
      const hits = await hitsOf(entry.kind, term);
      return hits.length === 0 ? null : { kind: entry.kind, headingEn: entry.headingEn, headingAr: entry.headingAr, hits };
    }),
  );
  return groups.filter((group): group is SearchGroup => group !== null);
}
