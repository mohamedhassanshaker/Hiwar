"use client";

import { useState, useTransition } from "react";

import type { PersonRow, RoleRow } from "@/features/organisation/types";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PersonAv } from "@/components/ui/avatar";
import { Chips, Tabs } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { useMay } from "@/components/shared/directory";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import type { ServerPage } from "@/lib/paging";
import { DataTable, FilterBar } from "@/components/shared/layout";
import { RolePermissionsModal } from "./role-permissions-modal";
import { InvitePeopleModal, PersonModal, type Choice, type UnitChoice } from "./people-modals";
import { RegistrationModal } from "./registration-modal";

/**
 * People & roles: a People tab and a Roles tab. A holder of `permissions:write` may invite
 * people, open a person to edit them, and edit a role's permissions, which are loaded when the
 * role is opened; anybody else sees the tables only (`UC-41.2-04`). People are searched by
 * name or address and filtered by status on the server, a page at a time (D349).
 */
export function People({
  people,
  page,
  filters,
  roles,
  units,
  roleChoices,
  permissions,
}: {
  people: PersonRow[];
  page: ServerPage;
  /** The search text and the status (`all` for every one) the URL holds. */
  filters: { q: string; status: string };
  roles: RoleRow[];
  units: UnitChoice[];
  roleChoices: Choice[];
  permissions: Record<string, { en: string; ar: string }>;
}) {
  const { t, nm } = useAwp();
  const may = useMay();
  const [tab, setTab] = useState("people");
  const filter = useFilterQuery();
  const [search, setSearch] = useState(filters.q);
  const [inviting, setInviting] = useState(false);
  const [selected, setSelected] = useState<PersonRow | null>(null);
  const [deciding, setDeciding] = useState<PersonRow | null>(null);
  const [editing, setEditing] = useState<{
    role: RoleRow;
    effects: Record<string, "Allow" | "Deny">;
    locked: string | null;
  } | null>(null);
  const [, startLoad] = useTransition();

  // `UC-41.2-04`: without permissions:write there is nothing on this screen to change.
  const mayAdminister = may("permissions:write");
  // D393: a registration waiting for approval opens its own dialog, for whoever may decide it.
  const mayApprove = may("registrations:approve");

  const openRole = (role: RoleRow) =>
    startLoad(async () => {
      const { loadRolePermissionsAction } = await import("@/features/organisation/actions");
      const result = await loadRolePermissionsAction({ roleCode: role.code });
      setEditing({ role, effects: result.effects, locked: result.locked });
    });

  const statusTone = (status: string) =>
    status === "Active" ? "success" : status === "Invited" ? "brand" : status === "Pending" ? "warning" : "neutral";

  return (
    <div className="awp-page">
      <PageHead
        title={t("People & roles", "الأشخاص والأدوار")}
        sub={t(
          "Authorisation is evaluated on permission sets, never role names. Explicit deny wins.",
          "تُقيّم الصلاحيات على مجموعات الأذونات وليس أسماء الأدوار. الرفض الصريح يتقدم.",
        )}
      >
        {mayAdminister && (
          <Btn label={t("Invite people", "دعوة أشخاص")} icon="AddCircle" onClick={() => setInviting(true)} />
        )}
      </PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "people", label: t("People", "الأشخاص"), count: page.total },
          { id: "roles", label: t("Roles", "الأدوار"), count: roles.length },
        ]}
      />
      {tab === "people" && (
        <Card pad={false}>
          <FilterBar>
            <input
              className="awp-input"
              style={{ flex: "1 1 240px", maxWidth: 360 }}
              value={search}
              placeholder={t("Search by name or email", "ابحث بالاسم أو البريد")}
              aria-label={t("Search people", "ابحث في الأشخاص")}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") filter.set("q", search.trim());
              }}
              onBlur={() => filter.set("q", search.trim())}
            />
            <Chips
              value={filters.status}
              onChange={(id) => filter.set("status", id)}
              items={[
                { id: "all", label: t("Every status", "كل الحالات") },
                { id: "Active", label: t("Active", "نشط") },
                { id: "Invited", label: t("Invited", "مدعوّ") },
                { id: "Pending", label: t("Pending approval", "بانتظار الاعتماد") },
                { id: "Suspended", label: t("Suspended", "معلّق") },
              ]}
            />
          </FilterBar>
          <DataTable
            rows={people}
            rowKey={(p) => p.id}
            server={{ ...page, onPage: (next) => filter.set("page", String(next)) }}
            empty={t("No people match these filters.", "لا يوجد أشخاص يطابقون هذه المرشحات.")}
            onRow={mayAdminister || mayApprove ? (p) => (p.status === "Pending" ? mayApprove && setDeciding(p) : mayAdminister && setSelected(p)) : undefined}
            cols={[
              {
                h: t("Name", "الاسم"),
                r: (p) => (
                  <div className="awp-row" style={{ gap: 10 }}>
                    <PersonAv p={p} s={32} />
                    <div>
                      <div style={{ fontWeight: 500 }}>{nm(p)}</div>
                      <div className="awp-small awp-muted">{p.email}</div>
                    </div>
                  </div>
                ),
              },
              { h: t("Role", "الدور"), r: (p) => t(p.roleNameEn, p.roleNameAr) },
              { h: t("Organization", "الجهة"), r: (p) => p.unit },
              { h: t("Sign-in", "تسجيل الدخول"), r: (p) => p.signInMethod },
              {
                h: t("Status", "الحالة"),
                r: (p) => <Tg tone={statusTone(p.status)} dot label={p.status} />,
              },
            ]}
          />
        </Card>
      )}
      {tab === "roles" && (
        <Card pad={false}>
          <DataTable
            rows={roles}
            cols={[
              { h: t("Role", "الدور"), r: (r) => <b>{t(r.nameEn, r.nameAr)}</b> },
              { h: t("Members", "الأعضاء"), r: (r) => r.members },
              {
                h: t("Scope", "النطاق"),
                r: (r) => (r.organisationWide ? t("Organisation", "الجهة") : t("Org unit / project", "الوحدة / المشروع")),
              },
              {
                h: "",
                end: true,
                r: (r) =>
                  mayAdminister ? (
                    <Lnk onClick={() => openRole(r)}>{t("Edit permissions", "تعديل الأذونات")}</Lnk>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}
      {inviting && (
        <InvitePeopleModal units={units} roles={roleChoices} onClose={() => setInviting(false)} />
      )}
      {deciding && (
        <RegistrationModal person={deciding} units={units} roles={roleChoices} mayChooseRole={mayAdminister} onClose={() => setDeciding(null)} />
      )}
      {selected && (
        <PersonModal
          person={selected}
          units={units}
          roles={roleChoices}
          onClose={() => setSelected(null)}
        />
      )}
      {editing && (
        <RolePermissionsModal
          role={editing.role}
          catalogue={permissions}
          effects={editing.effects}
          locked={editing.locked}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
