import type { PermissionCode } from "./permissions";

/**
 * The permission-set evaluator.
 *
 * Specification section 9: "Permission sets, not role names; explicit deny wins." A
 * person's role assignments are flattened into grants — one per permission, per scope —
 * and this module answers one question: may this principal do this, here?
 *
 * Scope follows `RoleAssignment.ScopeType` (data model section 3). An Organisation grant
 * covers everything; an OrgUnit or Project grant covers only its own id. A `Deny` beats
 * every `Allow`, at any scope: a deny on the organisation stops a project-scoped allow,
 * and a deny on one project stops an organisation-wide allow inside that project.
 */

export type Scope =
  | { type: "Organisation" }
  | { type: "OrgUnit"; id: string }
  | { type: "Project"; id: string };

export type Grant = {
  permission: PermissionCode;
  effect: "Allow" | "Deny";
  scope: Scope;
};

/** What a caller knows about the signed-in person when it asks. */
export type Principal = {
  personId: string;
  grants: readonly Grant[];
  /**
   * The org units the person's own unit sits under, nearest last. A check on a project's or a
   * unit's record uses that record's scope instead (`requireProjectPermission`,
   * `requireOrgUnitPermission` in `lib/session.ts`, D330).
   */
  orgUnitPath?: readonly string[];
};

export type Decision = {
  allowed: boolean;
  /** Why, in a form the audit entry and the "You don't have access" page can both use. */
  reason: "allowed" | "denied-explicitly" | "no-grant";
};

/**
 * Whether a grant applies at `at`. An Organisation grant covers every scope, a Project grant
 * only that project, and an OrgUnit grant that unit and any scope whose `orgUnitPath` holds it.
 */
function coversScope(grant: Grant, at: Scope, orgUnitPath: readonly string[]): boolean {
  if (grant.scope.type === "Organisation") return true;
  if (grant.scope.type === "Project") return at.type === "Project" && at.id === grant.scope.id;
  // An org-unit grant covers that unit and anything beneath it.
  if (at.type === "OrgUnit" && at.id === grant.scope.id) return true;
  return orgUnitPath.includes(grant.scope.id);
}

/**
 * The decision. `at` defaults to the organisation, which is what a screen with no project
 * or unit context asks about.
 */
export function evaluate(
  principal: Principal,
  permission: PermissionCode,
  at: Scope = { type: "Organisation" },
): Decision {
  const path = principal.orgUnitPath ?? [];
  const relevant = principal.grants.filter((grant) => grant.permission === permission && coversScope(grant, at, path));

  if (relevant.some((grant) => grant.effect === "Deny")) {
    return { allowed: false, reason: "denied-explicitly" };
  }
  if (relevant.some((grant) => grant.effect === "Allow")) {
    return { allowed: true, reason: "allowed" };
  }
  return { allowed: false, reason: "no-grant" };
}

/** Whether `evaluate` allows the permission at `at` (the organisation when omitted). */
export function can(principal: Principal, permission: PermissionCode, at?: Scope): boolean {
  return evaluate(principal, permission, at).allowed;
}

/**
 * Every permission this principal holds *somewhere*, for deciding whether to draw a control.
 *
 * A screen cannot ask `evaluate` per scope: it is rendering a button, not performing an
 * action, and the scope is often the thing the person has not chosen yet. The question a
 * control can answer is narrower — could this person ever do this? — so an Allow at any
 * scope counts, and only an Organisation-wide Deny removes it, because that is the one
 * scope that covers every target.
 *
 * This hides controls; it never grants anything. The server action still calls
 * `requirePermission` at the real scope, so a person who may write in one org unit sees the
 * control everywhere and is refused where they may not.
 */
export function permittedAnywhere(principal: Principal): PermissionCode[] {
  const deniedOutright = new Set(
    principal.grants
      .filter((grant) => grant.effect === "Deny" && grant.scope.type === "Organisation")
      .map((grant) => grant.permission),
  );
  const allowed = new Set(
    principal.grants
      .filter((grant) => grant.effect === "Allow" && !deniedOutright.has(grant.permission))
      .map((grant) => grant.permission),
  );
  return [...allowed].sort();
}

/**
 * Thrown by `require`. The route's `error.tsx` turns it into COM-07's "You don't have
 * access" page; the action layer audits it as a denied attempt (COM-08).
 */
export class NotPermittedError extends Error {
  constructor(
    readonly permission: PermissionCode,
    readonly scope: Scope,
    readonly reason: Decision["reason"],
  ) {
    super(`not permitted: ${permission}`);
    this.name = "NotPermittedError";
  }
}

/**
 * The gate every server action, route handler and MCP tool calls before it does anything.
 * It throws rather than returning, so a caller cannot forget to check the result.
 */
export function require(principal: Principal, permission: PermissionCode, at: Scope = { type: "Organisation" }): void {
  const decision = evaluate(principal, permission, at);
  if (!decision.allowed) throw new NotPermittedError(permission, at, decision.reason);
}

/** The set a navigation menu uses to hide what the person may not reach (COM-07). */
export function permitted(principal: Principal, permissions: readonly PermissionCode[], at?: Scope): Set<PermissionCode> {
  return new Set(permissions.filter((permission) => can(principal, permission, at)));
}
