import { evaluate, type Principal, type Scope } from "@/authz/evaluate";
import type { PermissionCode } from "@/authz/permissions";
import { selectGrants, selectOrgUnitPath, selectPerson } from "@/db/queries/identity";

import * as repository from "./repository";

/**
 * The least-privileged read in a discussion room (spec section 11, option (a)).
 *
 * A mission started in a room acts with the requester's identity, and the room's posts are
 * visible to every member. Reading with the requester's own permissions would therefore
 * publish, to the whole room, whatever the best-connected member happens to be allowed to
 * see. So a read made from inside a room is bounded by the least-privileged human member:
 * the agent may read only what every person in the room could read for themselves. Writes
 * are not bounded this way — they stay the requester's permissions and the agent's grant,
 * plus the requester's approval — because a write is an act attributed to one person, not
 * something disclosed to the room.
 *
 * Two things decide where this lives. Authorisation is enforced in trusted code at the
 * resource, so the rule has to be part of the decision the server already makes about a
 * permission, not an instruction an agent is asked to observe. And `evaluate()` is the one
 * function that answers "may this principal do this, here?", already handling explicit
 * deny and the org-unit scope hierarchy. Composing whole decisions — allowed only if every
 * member is allowed — is therefore exactly "what every member may see" by construction,
 * where merging grant rows into one list would be a second, weaker copy of the same rule.
 *
 * The floor is resolved per call from the run's own row rather than carried in the run
 * token, because room membership changes while a mission runs: a signed claim minted at
 * the start would keep granting what a member who joined since may not see.
 *
 * Which calls get a floor is the tool's declared tier, not a guess from the permission
 * name: the platform catalogue already states that a `T0` tool only reads, and that
 * declaration is server-owned and cannot be lowered by an agent's configuration.
 */

/** The principals a read has to satisfy as well as the requester's own. Empty is no floor. */
export type ReadFloor = Principal[];

/** A principal that holds nothing, so a floor containing it allows nothing. */
const NOTHING: Principal = { personId: "", grants: [], orgUnitPath: [] };

/**
 * Whether every principal in the floor allows this, which is the least-privileged member's
 * answer. An empty floor allows, because there is no member to be bounded by.
 */
export function floorAllows(floor: ReadFloor, permission: PermissionCode, at?: Scope): boolean {
  return floor.every((principal) => evaluate(principal, permission, at).allowed);
}

/** One person as the evaluator needs them. A person who is gone or suspended holds nothing. */
async function principalFor(personId: string): Promise<Principal> {
  const person = await selectPerson(personId);
  if (!person || person.status !== "Active") return NOTHING;
  const [grants, orgUnitPath] = await Promise.all([
    selectGrants(person.id),
    person.orgUnitId ? selectOrgUnitPath(person.orgUnitId) : Promise.resolve([]),
  ]);
  return {
    personId: person.id,
    grants: grants.map((row) => ({
      permission: row.permission as PermissionCode,
      effect: row.effect as "Allow" | "Deny",
      scope:
        row.scopeType === "Organisation"
          ? { type: "Organisation" }
          : row.scopeType === "OrgUnit"
            ? { type: "OrgUnit", id: row.scopeId as string }
            : { type: "Project", id: row.scopeId as string },
    })),
    orgUnitPath,
  };
}

/** The floor a room imposes: every human member of it, the requester included. */
export async function readFloorForRoom(roomId: string): Promise<ReadFloor> {
  const members = await repository.humanMemberIds(roomId);
  return Promise.all(members.map(principalFor));
}

/**
 * The floor in force for one run, resolved from the run's own row.
 *
 * A run outside a room has no floor. A run whose room has been deleted gets a floor that
 * allows nothing: the room it was bounded by is unreadable, so the bound cannot be
 * established, and the safe reading of an unestablished bound is the tightest one.
 *
 * No permission check of its own: it is called by the server to decide a permission, before
 * there is an acting session to check.
 */
export async function readFloorForRun(runId: string): Promise<ReadFloor> {
  const context = await repository.roomContextOfRun(runId);
  if (!context || context.contextType !== "Room") return [];
  if (!context.roomId) return [NOTHING];
  return readFloorForRoom(context.roomId);
}
