import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { visibleOrgUnitIds } from "@/lib/session";
import * as repository from "./repository";
import { MemoryRejected } from "./errors";

/** The flag that decides whether a memory write is masked before it is stored. */
export const PII_FILTER = FEATURE_FLAGS.piiFilterOnMemoryWrites;

/** Every memory scope this person may read (D68), which every read and change is bounded by. */
export async function readableScopes(personId: string): Promise<string[]> {
  return repository.scopePathsVisibleTo(personId, await visibleOrgUnitIds("memory:read"));
}

/**
 * `UC-55.2-04` and D18: whoever proposed the newest version may not also decide it.
 *
 * Both proposer kinds, not only `Person`. A version proposed by an agent used to pass
 * this check whatever was asking, so the same agent could have approved its own
 * proposal — separation of duties that only recognised half the principals it has.
 */
export function proposedBySelf(
  memory: { proposedByType: string | null; proposedById: string | null },
  session: { personId: string; actingAgent?: { id: string } },
): boolean {
  if (memory.proposedByType === "Person") return memory.proposedById === session.personId;
  if (memory.proposedByType === "Agent") return memory.proposedById === session.actingAgent?.id;
  return false;
}

/**
 * D68: a change is confined to the scopes the person may read.
 *
 * The permission alone is not enough. `memory:write` says what kind of thing somebody
 * may do; it says nothing about whose memory, and a private scope belongs to one person
 * however wide their grant is.
 */
export async function assertReachable(personId: string, path: string): Promise<void> {
  const scope = await repository.scopeOfMemory(path);
  if (!scope) throw new MemoryRejected("That memory no longer exists.", "لم تعد هذه الذاكرة موجودة.");
  if (scope.scopePersonId !== null && scope.scopePersonId !== personId) {
    throw new MemoryRejected("That memory belongs to somebody else.", "هذه الذاكرة تخص شخصاً آخر.");
  }
  const scopes = await repository.scopePathsVisibleTo(personId, await visibleOrgUnitIds("memory:write"));
  if (!scopes.includes(scope.scopePath)) {
    throw new MemoryRejected("That memory is out of your reach.", "هذه الذاكرة خارج نطاق صلاحيتك.");
  }
}
