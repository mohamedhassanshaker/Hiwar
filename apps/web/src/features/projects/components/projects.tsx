"use client";

import { useState } from "react";

import { useMay, useProjects } from "@/components/shared/directory";
import { DataTable, FilterBar, Sel } from "@/components/shared/layout";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { StTag } from "@/components/shared/status-tags";
import { Bar } from "@/components/ui/metrics";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Who } from "@/components/ui/avatar";
import { type ProjectsScreen } from "@/features/projects/types";
import { useAwp } from "@/hooks/use-awp";
import { useScreenParams } from "@/lib/routes";
import { type Project } from "@/types/directory";
import { Detail } from "./project-detail";

/**
 * S-20 the project list and S-21 the project detail.
 *
 * The policy editor writes the whole policy at once, because that is how the project stores
 * it: a half-saved policy — a sensitivity raised but the connectors not yet narrowed — is a
 * state the platform must never be in.
 */

export function Projects({ details, connectors, agents, mayWrite }: ProjectsScreen) {
  const { t, aName } = useAwp();
  const { open } = useModals();
  const may = useMay();
  const projects = useProjects();
  const p = useScreenParams();
  const [sel, setSel] = useState<Project | null>(() => (p.open ? projects.find((x) => x.k === p.open) || null : null));
  // `UC-20.2-01`: the address re-selects the project when it changes — a project just created
  // arrives as `?open=` on this same screen, and opens once the list holds it (D165).
  const [openedKey, setOpenedKey] = useState(sel ? p.open : undefined);
  const wanted = p.open ? projects.find((x) => x.k === p.open) : undefined;
  if (p.open && p.open !== openedKey && wanted) {
    setOpenedKey(p.open);
    setSel(wanted);
  }
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("any");
  const [unit, setUnit] = useState("any");

  // The project as the server now has it, not as it was when it was opened.
  const shown = sel ? (projects.find((x) => x.k === sel.k) ?? sel) : null;
  if (shown && details[shown.k]) return <Detail project={shown} detail={details[shown.k]} connectors={connectors} agents={agents} mayWrite={mayWrite} onBack={() => setSel(null)} />;

  const units = [...new Set(projects.map((project) => project.unit).filter(Boolean))];
  const rows = projects.filter(
    (project) =>
      (q === "" || `${project.k}${project.n}${project.nAr}`.toLowerCase().includes(q.toLowerCase())) &&
      (status === "any" || project.st === status) &&
      (unit === "any" || project.unit === unit),
  );

  return (
    <div className="awp-page">
      <PageHead
        title={t("Projects", "المشاريع")}
        sub={t(
          "Containers for work with their own members and policies. Discussion rooms, work items, requests, artifacts and files belong to a project.",
          "حاويات للعمل بأعضائها وسياساتها. تنتمي اجتماعات العمل وبنود العمل والطلبات والمخرجات والملفات إلى مشروع.",
        )}
      >
        {/* `UC-20.2-05`: a person who may not create a project is not offered the button. */}
        {may("projects:write") && (
          <Btn label={t("New Project", "مشروع جديد")} icon="AddCircle" onClick={() => open("project")} />
        )}
      </PageHead>
      <Card pad={false}>
        <FilterBar>
          <input
            className="awp-input"
            style={{ maxWidth: 280 }}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={t("Search projects", "ابحث في المشاريع")}
          />
          <Sel
            value={status}
            onChange={setStatus}
            w={200}
            opts={[["any", t("Any status", "أي حالة")], ...[...new Set(projects.map((project) => project.st))].map((s) => [s, s] as [string, string])]}
          />
          {units.length > 1 && (
            <Sel
              value={unit}
              onChange={setUnit}
              w={220}
              opts={[["any", t("Any org unit", "أي وحدة")], ...units.map((u) => [u, u] as [string, string])]}
            />
          )}
          <span style={{ flex: 1 }} />
          <span className="awp-small awp-muted">
            {rows.length} {t("projects", "مشاريع")}
          </span>
        </FilterBar>
        <DataTable
          onRow={setSel}
          rows={rows}
          cols={[
            {
              h: t("Project", "المشروع"),
              r: (p) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{t(p.n, p.nAr)}</div>
                  <div className="awp-small awp-muted awp-mono">{p.k}</div>
                </div>
              ),
            },
            { h: t("Status", "الحالة"), r: (p) => <StTag s={p.st} /> },
            { h: t("Owner", "المستخدم"), r: (p) => (<div className="awp-row"><Who id={p.own} s={24} />{aName(p.own)}</div>) },
            { h: t("Org unit", "الوحدة"), r: (p) => p.unit || "—" },
            { h: t("Sensitivity", "التصنيف"), r: (p) => <StTag s={p.sens} dot={false} /> },
            {
              h: t("Progress", "التقدم"),
              r: (p) => (
                <div className="awp-row" style={{ minWidth: 140 }}>
                  <div style={{ flex: 1 }}>
                    <Bar h={6} parts={[{ v: p.prog, c: "var(--action-primary-bg)" }]} />
                  </div>
                  <span className="awp-small">{p.prog}%</span>
                </div>
              ),
            },
            { h: t("Work items", "بنود العمل"), end: true, r: (p) => p.items },
          ]}
        />
        {rows.length === 0 && (
          <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }} role="status">
            {t("No projects match.", "لا توجد مشاريع مطابقة.")}
          </p>
        )}
      </Card>
    </div>
  );
}
