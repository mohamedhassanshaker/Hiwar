import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { evaluate, type Grant, type Principal, type Scope } from "@/authz/evaluate";
import type { PermissionCode } from "@/authz/permissions";
import { insertAuditEntry } from "@/db/queries/audit";
import { NOT_PERMITTED_DIGEST } from "./digests";
import { logger } from "./logger";
import { selectAllProjectIds, selectGrants, selectOrgUnitPath, selectPerson, selectProjectIdsInScope } from "@/db/queries/identity";
import { auth } from "./auth";

/**
 * Who is asking, and what they may do. Every server component, server action and route
 * handler starts here: `requireSession()` for a screen, `requirePermission()` before a
 * change (requirement 27).
 */

export type Session = {
  personId: string;
  email: string;
  nameEn: string;
  nameAr: string;
  initials: string;
  principal: Principal;
  /**
   * Set when an agent is acting for this person through the platform MCP server. The
   * permission check is the person's, because the agent may do nothing they could not;
   * the audit row names the agent, because it is the one that called. `runId` is the run
   * token's own run, set only for an agent; an integration client calls without one.
   */
  actingAgent?: { id: string; label: string; runId?: string };
  /**
   * The fields of this call a person has already agreed to, when an approval was spent on
   * it (D20). Empty for a person in the console, who is the decision themselves.
   *
   * Set only by the MCP route, after the approval it names was claimed: a service reading
   * this is reading "somebody agreed to exactly this", not "the agent says so".
   */
  approvedFields: string[];
  /** The key of the approval spent on this call, so a record it changes can name it. */
  approvalKey?: string;
  /**
   * People whose permissions also have to allow a read, besides the acting person's.
   *
   * A room is the case this exists for (decision (f), D104). An agent answering in a
   * room posts to everyone in it, so what it may read is bounded by the least-privileged
   * human member — otherwise one member's question becomes another member's data leak.
   * Empty everywhere else, which is every path but an agent reading inside a room.
   *
   * A list of whole principals rather than one merged grant list: `evaluate` already
   * handles explicit deny and the org-unit hierarchy, and each person's `orgUnitPath`
   * differs, so merging the rows would be a second and weaker copy of both.
   */
  readFloor: Principal[];
};

/**
 * The person an agent or a platform caller is acting for, for the duration of one call.
 *
 * Stack specification 4.2, ownership rule: "The agent service changes domain data only
 * through the platform MCP server, so agents pass the same permission checks, validation
 * and audit as people." There is no cookie on that call — there is a run token — so the
 * identity it carries is established here and read by `getSession()` below. It is set only
 * through `runAs`: by the MCP route, an integration client's run, a scheduled firing and a
 * widget visitor's agent run. It never outlives the call.
 */
const acting = new AsyncLocalStorage<{
  personId: string;
  agent: { id: string; label: string; runId?: string };
  approvedFields: string[];
  approvalKey?: string;
  readFloor: Principal[];
}>();

/**
 * Runs `body` with `getSession()` answering as `personId`, acting through `agent`, with the approved
 * fields, approval key and read floor given in `options`. The identity ends when `body` settles.
 */
export function runAs<T>(
  personId: string,
  agent: { id: string; label: string; runId?: string },
  body: () => Promise<T>,
  options: { approvedFields?: string[]; approvalKey?: string; readFloor?: Principal[] } = {},
): Promise<T> {
  return acting.run(
    {
      personId,
      agent,
      approvedFields: options.approvedFields ?? [],
      ...(options.approvalKey ? { approvalKey: options.approvalKey } : {}),
      readFloor: options.readFloor ?? [],
    },
    body,
  );
}

/** Flattens the person's role assignments into the grants the evaluator reads. */
async function loadGrants(personId: string): Promise<Grant[]> {
  const rows = await selectGrants(personId);
  return rows.map((row) => ({
    permission: row.permission as PermissionCode,
    effect: row.effect as Grant["effect"],
    scope:
      row.scopeType === "Organisation"
        ? { type: "Organisation" }
        : row.scopeType === "OrgUnit"
          ? { type: "OrgUnit", id: row.scopeId as string }
          : { type: "Project", id: row.scopeId as string },
  }));
}

/** The org units the person's own unit sits under, nearest last. */
async function loadOrgUnitPath(orgUnitId: string | null): Promise<string[]> {
  return orgUnitId ? selectOrgUnitPath(orgUnitId) : [];
}

/** Who is signed in on this request, read once. */
const signedInPersonId = cache(async (): Promise<string | undefined> => (await auth())?.user?.id);

/** One person and their grants, read once per request for each person asked about. */
const personSession = cache(async (personId: string) => {
  const person = await selectPerson(personId);
  if (!person || person.status !== "Active") return null;
  const [grants, orgUnitPath] = await Promise.all([loadGrants(person.id), loadOrgUnitPath(person.orgUnitId)]);
  return {
    personId: person.id,
    email: person.email,
    nameEn: person.nameEn,
    nameAr: person.nameAr,
    initials: person.initials,
    principal: { personId: person.id, grants, orgUnitPath },
  };
});

/**
 * The session: the person `runAs` names while its body runs, otherwise the signed-in person.
 *
 * Resolved on every call rather than cached whole, because one request can read the signed-in
 * person's session and then act as another (a widget preview starting the deployment's agent,
 * D221); a cached session would hand the second the first's identity.
 */
export async function getSession(): Promise<Session | null> {
  const onBehalfOf = acting.getStore();
  const personId = onBehalfOf?.personId ?? (await signedInPersonId());
  if (!personId) return null;
  const person = await personSession(personId);
  if (!person) return null;
  return {
    ...person,
    actingAgent: onBehalfOf?.agent,
    approvedFields: onBehalfOf?.approvedFields ?? [],
    ...(onBehalfOf?.approvalKey ? { approvalKey: onBehalfOf.approvalKey } : {}),
    readFloor: onBehalfOf?.readFloor ?? [],
  };
}

/** The screen the request is for, put on the request by `src/proxy.ts`. */
async function currentPath(): Promise<string> {
  const path = (await headers()).get("x-pathname");
  return path && path.startsWith("/") ? path : "/dashboard";
}

/** COM-09: no session means back to sign-in, returning to the same screen afterwards. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(await currentPath())}`);
  return session;
}

/**
 * COM-07 and COM-08: the gate every server action and route handler calls. A refusal is
 * audited before it is thrown, so an attempt to force an action leaves a trail.
 *
 * At the organisation (the default) it asks whether the person holds the permission at all:
 * an org-unit grant passes, because the principal's `orgUnitPath` is the person's own unit.
 * A record that belongs to a project or an org unit is checked in that scope, which this
 * hands to `requireProjectPermission` or `requireOrgUnitPermission` (D330).
 */
export async function requirePermission(permission: PermissionCode, scope: Scope = { type: "Organisation" }): Promise<Session> {
  if (scope.type === "Project") return requireProjectPermission(permission, scope.id);
  if (scope.type === "OrgUnit") return requireOrgUnitPermission(permission, scope.id);
  const session = await requireSession();
  // The acting person first, then the floor: a read inside a room is bounded by what
  // every human member may see, so that an answer posted to all of them cannot carry
  // more than the least-privileged of them could have asked for themselves (D104).
  const decision = floored(evaluate(session.principal, permission, scope), session, permission, scope);
  if (!decision.allowed) return refuse(session, permission, scope, decision.reason);
  return session;
}

/**
 * `requirePermission` for a record that belongs to a project: the project has to be one that
 * `visibleProjectIds(permission)` reaches, which counts membership and the project's org unit.
 */
export async function requireProjectPermission(permission: PermissionCode, projectId: string): Promise<Session> {
  const session = await requirePermission(permission);
  const reachable = await visibleProjectIds(permission);
  if (reachable === null || reachable.includes(projectId)) return session;
  return refuse(session, permission, { type: "Project", id: projectId }, "no-grant");
}

/**
 * `requirePermission` for a record that belongs to an org unit (an agent, a new project): a
 * grant on that unit or on a unit above it covers it, as `UC-41.2-03` scopes an assignment.
 */
export async function requireOrgUnitPermission(permission: PermissionCode, orgUnitId: string): Promise<Session> {
  const session = await requirePermission(permission);
  const scope: Scope = { type: "OrgUnit", id: orgUnitId };
  // Evaluated against the target unit and every unit above it, so a grant or a Deny on any
  // of them applies here and a Deny on an unrelated unit does not.
  const path = await selectOrgUnitPath(orgUnitId);
  const decision = evaluate({ ...session.principal, orgUnitPath: path }, permission, scope);
  if (decision.allowed) return session;
  return refuse(session, permission, scope, decision.reason);
}

/**
 * `requirePermission` for a record that belongs to no project or unit and changes what every
 * unit uses (a skill, a request type, every schedule at once): only an organisation-wide
 * grant allows it (D330).
 */
export async function requireOrganisationPermission(permission: PermissionCode): Promise<Session> {
  const session = await requirePermission(permission);
  // With no unit path an org-unit or project grant covers nothing at the organisation.
  const decision = evaluate({ ...session.principal, orgUnitPath: [] }, permission);
  if (decision.allowed) return session;
  return refuse(session, permission, { type: "Organisation" }, decision.reason);
}

/** Audits a refused permission check and throws it as `NotPermitted`. */
async function refuse(session: Session, permission: PermissionCode, scope: Scope, reason: string): Promise<never> {
  await insertAuditEntry({
    actorType: "Person",
    actorId: session.personId,
    actorLabel: session.nameEn,
    action: permission,
    objectType: scope.type,
    objectId: scope.type === "Organisation" ? null : scope.id,
    objectLabel: null,
    detailJson: { reason },
    outcome: "Denied",
  });
  logger().warn({ personId: session.personId, permission, scope: scope.type, reason }, "permission refused");
  throw new NotPermitted(permission, reason);
}

/** Thrown by `requirePermission`. The route group's `error.tsx` turns it into COM-07. */
export class NotPermitted extends Error {
  readonly code = "NOT_PERMITTED";
  /** Survives Next.js's sanitising of server errors, so the boundary knows what this is. */
  readonly digest = NOT_PERMITTED_DIGEST;
  constructor(
    readonly permission: PermissionCode,
    readonly reason: string,
  ) {
    super(`not permitted: ${permission}`);
    this.name = "NotPermitted";
  }
}

/** Whether the signed-in person may do something — used to hide navigation and buttons. */
export async function can(permission: PermissionCode, scope?: Scope): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  return floored(evaluate(session.principal, permission, scope), session, permission, scope).allowed;
}

/**
 * One decision, narrowed by every person in the read floor.
 *
 * Composing whole decisions rather than merging grants: `evaluate` already resolves
 * explicit deny and the org-unit scope hierarchy, and "what every member may see" is
 * exactly the conjunction of their answers.
 */
function floored(
  decision: { allowed: boolean; reason: string },
  session: Session,
  permission: PermissionCode,
  scope?: Scope,
): { allowed: boolean; reason: string } {
  if (!decision.allowed || session.readFloor.length === 0) return decision;
  const blocked = session.readFloor.some((member) => !evaluate(member, permission, scope).allowed);
  return blocked
    ? { allowed: false, reason: `room_read_floor: not everyone in this room may ${permission}` }
    : decision;
}

/**
 * `COM-07` for project-scoped records: the projects the signed-in person may see through
 * one read permission. `null` means every project — an organisation-wide allow with no
 * project-level deny — which lets a caller skip the `in (…)` clause altogether.
 *
 * A project is in scope when an organisation-wide grant covers it, when the person is one
 * of its members, when it sits in an org unit the person holds the permission in, or when
 * the grant names the project itself. An explicit `Deny` removes it either way.
 */
export async function visibleProjectIds(permission: PermissionCode): Promise<string[] | null> {
  const session = await getSession();
  if (!session) return [];

  const grants = session.principal.grants.filter((grant) => grant.permission === permission);
  if (grants.some((grant) => grant.effect === "Deny" && grant.scope.type === "Organisation")) return [];

  const denied = new Set(
    grants.filter((grant) => grant.effect === "Deny" && grant.scope.type === "Project").map((grant) => (grant.scope as { id: string }).id),
  );
  const allows = grants.filter((grant) => grant.effect === "Allow");

  if (allows.some((grant) => grant.scope.type === "Organisation")) {
    if (denied.size === 0) return null;
    return (await selectAllProjectIds()).filter((id) => !denied.has(id));
  }

  const units = allows.filter((grant) => grant.scope.type === "OrgUnit").map((grant) => (grant.scope as { id: string }).id);
  const named = allows.filter((grant) => grant.scope.type === "Project").map((grant) => (grant.scope as { id: string }).id);
  const reachable = await selectProjectIdsInScope(session.personId, units);
  return [...new Set([...reachable, ...named])].filter((id) => !denied.has(id));
}

/**
 * The org units a permission reaches for the signed-in person, or `null` for all of them.
 *
 * The sibling of `visibleProjectIds` for the things that hang off an org unit rather than a
 * project — a business unit's memory, for one. A `Deny` at the organisation means none.
 */
export async function visibleOrgUnitIds(permission: PermissionCode): Promise<string[] | null> {
  const session = await getSession();
  if (!session) return [];

  const grants = session.principal.grants.filter((grant) => grant.permission === permission);
  if (grants.some((grant) => grant.effect === "Deny" && grant.scope.type === "Organisation")) return [];

  const denied = new Set(
    grants
      .filter((grant) => grant.effect === "Deny" && grant.scope.type === "OrgUnit")
      .map((grant) => (grant.scope as { id: string }).id),
  );
  const allows = grants.filter((grant) => grant.effect === "Allow");
  if (allows.some((grant) => grant.scope.type === "Organisation")) return denied.size === 0 ? null : [];

  return allows
    .filter((grant) => grant.scope.type === "OrgUnit")
    .map((grant) => (grant.scope as { id: string }).id)
    .filter((id) => !denied.has(id));
}
