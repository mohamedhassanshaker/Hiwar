import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Server actions are a network boundary and first render calls none of them, so each is a
// stub that would refuse if it ever were called.
vi.mock("@/features/organisation/actions", () =>
  Object.fromEntries(
    [
      "changePersonPlacement",
      "createOrgUnit",
      "editOrgUnit",
      "invitePeople",
      "loadRolePermissionsAction",
      "orgUnitHistory",
      "removeOrgUnit",
      "setRolePermissions",
      "suspendPerson",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

// The people filters live in the URL (D349).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/people",
  useSearchParams: () => new URLSearchParams(),
}));

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ToastProvider } from "@/components/shared/toast";
import { People } from "@/features/organisation/components/people";
import { OrgUnits } from "@/features/organisation/components/org-units";
import { branchOf } from "@/features/organisation/components/org-unit-modals";
import type { OrgUnitRow, PersonRow, RoleRow } from "@/features/organisation/types";
import { PreferencesProvider } from "@/lib/preferences";

/** S-41 and S-42 on first render, held as snapshots (see `tests/screen-render.test.tsx`). */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects: [], may }}>
        <ToastProvider>{node}</ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-41 people and roles", () => {
  const person = (over: Partial<PersonRow>): PersonRow => ({
    id: "p1",
    email: "qa@example.test",
    name: "Quality Analyst",
    nameAr: "محلل الجودة",
    ini: "QA",
    photo: null,
    jobTitle: "Analyst",
    jobTitleAr: "محلل",
    unit: "Operations",
    unitId: "u1",
    signInMethod: "SSO",
    status: "Active",
    roleCode: "Member",
    roleNameEn: "Member",
    roleNameAr: "عضو",
    scopeType: "Organisation",
    scopeId: null,
    ...over,
  });
  const people = [
    person({}),
    person({ id: "p2", email: "new@example.test", name: "New Starter", nameAr: "موظف جديد", ini: "NS", status: "Invited" }),
    person({ id: "p3", email: "gone@example.test", name: "Former Lead", nameAr: "قائد سابق", ini: "FL", status: "Suspended", unit: "", unitId: null }),
  ];
  const roles: RoleRow[] = [
    { code: "Member", nameEn: "Member", nameAr: "عضو", members: 2, organisationWide: true },
    { code: "WorkLead", nameEn: "Work Lead", nameAr: "قائد العمل", members: 1, organisationWide: false },
  ];
  const props = {
    people,
    page: { page: 1, total: people.length, size: 50 },
    filters: { q: "", status: "all" },
    roles,
    units: [{ id: "u1", code: "OPS", nameEn: "Operations", nameAr: "العمليات" }],
    roleChoices: roles.map(({ code, nameEn, nameAr }) => ({ code, nameEn, nameAr })),
    permissions: { "rooms:read": { en: "Read rooms", ar: "قراءة الغرف" } },
  };

  it("offers invitations to somebody who administers permissions", () => {
    expect(renderScreen(<People {...props} />, ["permissions:write"])).toMatchSnapshot();
  });

  it("is read-only without permissions:write", () => {
    expect(renderScreen(<People {...props} />)).toMatchSnapshot();
  });
});

describe("S-42 org units", () => {
  const units: OrgUnitRow[] = [
    { id: "u0", code: "ROOT", nameEn: "Tahseel", nameAr: "تحصيل", isRoot: true, parentId: null, lead: "p1", version: 1, people: 7, agents: 4, projects: 3 },
    { id: "u1", code: "OPS", nameEn: "Operations", nameAr: "العمليات", isRoot: false, parentId: "u0", lead: "p1", version: 1, people: 3, agents: 2, projects: 1 },
  ];
  const options = units.map(({ id, code, nameEn, nameAr }) => ({ id, code, nameEn, nameAr }));

  it("offers a new unit to somebody who may change the organisation", () => {
    expect(renderScreen(<OrgUnits units={units} options={options} />, ["organisation:write"])).toMatchSnapshot();
  });

  it("is read-only without organisation:write", () => {
    expect(renderScreen(<OrgUnits units={units} options={options} />)).toMatchSnapshot();
  });

  it("should_show_a_dash_when_a_unit_has_no_lead", () => {
    const leaderless = [{ ...units[0], lead: "" }];
    expect(renderScreen(<OrgUnits units={leaderless} options={options} />)).toContain("—");
  });

  it("should_exclude_the_unit_and_everything_under_it_from_its_parent_choices", () => {
    const tree: OrgUnitRow[] = [
      ...units,
      { ...units[1], id: "u2", code: "DESK", parentId: "u1" },
      { ...units[1], id: "u3", code: "FIN", parentId: "u0" },
    ];
    expect([...branchOf(tree, "u1")].sort()).toEqual(["u1", "u2"]);
    expect([...branchOf(tree, "u2")]).toEqual(["u2"]);
  });
});
