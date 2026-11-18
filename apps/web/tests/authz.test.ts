import { describe, expect, it } from "vitest";

import { NotPermittedError, can, evaluate, permitted, require, type Grant, type Principal } from "@/authz/evaluate";
import { PERMISSION_CODES, PERMISSIONS, SYSTEM_ROLES } from "@/authz/permissions";

const person = (grants: Grant[], orgUnitPath: string[] = []): Principal => ({
  personId: "11111111-1111-1111-1111-111111111111",
  grants,
  orgUnitPath,
});

describe("permission catalogue", () => {
  it("describes every permission in both languages", () => {
    for (const code of PERMISSION_CODES) {
      expect(PERMISSIONS[code].en.length).toBeGreaterThan(0);
      expect(PERMISSIONS[code].ar.length).toBeGreaterThan(0);
    }
  });

  it("has the nine system roles of specification 7.3.2, and the widget visitor of D221", () => {
    expect(Object.keys(SYSTEM_ROLES)).toEqual([
      "PlatformOwner",
      "Administrator",
      "AgentDesigner",
      "Publisher",
      "WorkLead",
      "Member",
      "Approver",
      "Auditor",
      "Guest",
      "WidgetVisitor",
    ]);
  });

  it("grants every permission to the platform owner and none unknown to any role", () => {
    expect(SYSTEM_ROLES.PlatformOwner.allow).toEqual(PERMISSION_CODES);
    for (const [name, role] of Object.entries(SYSTEM_ROLES)) {
      const unknown = role.allow.filter((code) => !PERMISSION_CODES.includes(code));
      expect(unknown, `${name} names a permission that is not in the catalogue`).toEqual([]);
    }
  });

  it("keeps granting permissions with the platform owner alone", () => {
    const owners = Object.entries(SYSTEM_ROLES)
      .filter(([, role]) => role.allow.includes("permissions:write"))
      .map(([name]) => name);
    expect(owners).toEqual(["PlatformOwner"]);
  });
});

describe("permission evaluation (COM-07, COM-08)", () => {
  it("allows what an organisation-wide grant allows", () => {
    const principal = person([{ permission: "work_items:write", effect: "Allow", scope: { type: "Organisation" } }]);
    expect(can(principal, "work_items:write")).toBe(true);
    expect(can(principal, "work_items:write", { type: "Project", id: "p1" })).toBe(true);
  });

  it("refuses a permission nobody granted", () => {
    expect(evaluate(person([]), "settings:write")).toEqual({ allowed: false, reason: "no-grant" });
  });

  it("lets an explicit deny beat an allow at the same scope", () => {
    const principal = person([
      { permission: "settings:write", effect: "Allow", scope: { type: "Organisation" } },
      { permission: "settings:write", effect: "Deny", scope: { type: "Organisation" } },
    ]);
    expect(evaluate(principal, "settings:write")).toEqual({ allowed: false, reason: "denied-explicitly" });
  });

  it("lets a project-scoped deny beat an organisation-wide allow inside that project", () => {
    const principal = person([
      { permission: "requests:write", effect: "Allow", scope: { type: "Organisation" } },
      { permission: "requests:write", effect: "Deny", scope: { type: "Project", id: "restricted" } },
    ]);
    expect(can(principal, "requests:write", { type: "Project", id: "open" })).toBe(true);
    expect(can(principal, "requests:write", { type: "Project", id: "restricted" })).toBe(false);
  });

  it("keeps a project grant inside its own project", () => {
    const principal = person([{ permission: "rooms:write", effect: "Allow", scope: { type: "Project", id: "fin" } }]);
    expect(can(principal, "rooms:write", { type: "Project", id: "fin" })).toBe(true);
    expect(can(principal, "rooms:write", { type: "Project", id: "proc" })).toBe(false);
    expect(can(principal, "rooms:write")).toBe(false);
  });

  it("lets an org-unit grant reach what sits beneath that unit", () => {
    const principal = person(
      [{ permission: "work_items:read", effect: "Allow", scope: { type: "OrgUnit", id: "finance" } }],
      ["platform", "finance"],
    );
    expect(can(principal, "work_items:read", { type: "Project", id: "fin" })).toBe(true);
    expect(can(person([{ permission: "work_items:read", effect: "Allow", scope: { type: "OrgUnit", id: "finance" } }], ["procurement"]), "work_items:read", { type: "Project", id: "proc" })).toBe(false);
  });

  it("D330 judges a unit's record by that unit's path: a deny on one unit leaves its siblings alone", () => {
    // `requireOrgUnitPermission` evaluates with the target unit's path, nearest last.
    const admin = (path: string[]) =>
      person(
        [
          { permission: "agents:write", effect: "Allow", scope: { type: "Organisation" } },
          { permission: "agents:write", effect: "Deny", scope: { type: "OrgUnit", id: "finance" } },
        ],
        path,
      );
    expect(can(admin(["platform", "it"]), "agents:write", { type: "OrgUnit", id: "it" })).toBe(true);
    expect(can(admin(["platform", "finance"]), "agents:write", { type: "OrgUnit", id: "finance" })).toBe(false);

    const lead = (path: string[]) =>
      person([{ permission: "agents:write", effect: "Allow", scope: { type: "OrgUnit", id: "platform" } }], path);
    expect(can(lead(["platform", "it"]), "agents:write", { type: "OrgUnit", id: "it" })).toBe(true);
    expect(can(lead(["corporate", "legal"]), "agents:write", { type: "OrgUnit", id: "legal" })).toBe(false);
  });

  it("throws a NotPermittedError the error page and the audit entry can both read", () => {
    const principal = person([{ permission: "audit:read", effect: "Deny", scope: { type: "Organisation" } }]);
    expect(() => require(principal, "audit:read")).toThrow(NotPermittedError);
    try {
      require(principal, "audit:read");
    } catch (error) {
      expect(error).toBeInstanceOf(NotPermittedError);
      expect((error as NotPermittedError).permission).toBe("audit:read");
      expect((error as NotPermittedError).reason).toBe("denied-explicitly");
    }
  });

  it("returns the set a navigation menu hides items with", () => {
    const principal = person([
      { permission: "agents:read", effect: "Allow", scope: { type: "Organisation" } },
      { permission: "audit:read", effect: "Allow", scope: { type: "Organisation" } },
      { permission: "audit:read", effect: "Deny", scope: { type: "Organisation" } },
    ]);
    expect([...permitted(principal, ["agents:read", "audit:read", "settings:write"])]).toEqual(["agents:read"]);
  });

  it("gives an auditor read access and no write access", () => {
    const grants = SYSTEM_ROLES.Auditor.allow.map<Grant>((permission) => ({
      permission,
      effect: "Allow",
      scope: { type: "Organisation" },
    }));
    const auditor = person(grants);
    expect(can(auditor, "audit:read")).toBe(true);
    expect(can(auditor, "settings:write")).toBe(false);
    expect(can(auditor, "approvals:decide")).toBe(false);
  });
});
