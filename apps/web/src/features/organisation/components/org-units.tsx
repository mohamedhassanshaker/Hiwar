"use client";

import { useEffect, useState, useTransition } from "react";

import type { OrgUnitEvent, OrgUnitRow } from "@/features/organisation/types";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/overlay";
import { Ic } from "@/components/ui/icon";
import { Who } from "@/components/ui/avatar";
import { orgUnitHistory, removeOrgUnit } from "@/features/organisation/actions";
import { EditOrgUnitModal, NewOrgUnitModal, type OrgUnitOption } from "@/features/organisation/components/org-unit-modals";
import { useMay } from "@/components/shared/directory";
import { useAwp } from "@/hooks/use-awp";
import { DataTable } from "@/components/shared/layout";

/** A unit's lead, or a dash when it has none: a lead is optional. */
function Lead({ id }: { id: string }) {
  const { aName } = useAwp();
  if (!id) return <span className="awp-muted">—</span>;
  return (
    <div className="awp-row">
      <Who id={id} s={24} />
      {aName(id)}
    </div>
  );
}

/**
 * `UC-42.1-04`: one org unit, what has happened to it, editing it and removing it.
 *
 * The history is the audit log read back for this unit.
 */
function OrgUnitDrawer({ unit, onEdit, onClose }: { unit: OrgUnitRow; onEdit: () => void; onClose: () => void }) {
  const { t, lang, why } = useAwp();
  const may = useMay();
  const [history, setHistory] = useState<OrgUnitEvent[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void orgUnitHistory(unit.code).then((events) => {
      if (live) setHistory(events);
    });
    return () => {
      live = false;
    };
  }, [unit.code]);

  const remove = () =>
    start(async () => {
      setProblem(null);
      const result = await removeOrgUnit({ id: unit.id, code: unit.code });
      // `UC-42.1-04`: what is still in the way is a message on the drawer, not a crash.
      if (result.ok) onClose();
      else setProblem(why(result));
    });

  return (
    <Drawer
      title={t(unit.nameEn, unit.nameAr)}
      sub={<span className="awp-mono">{unit.code}</span>}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Close", "إغلاق")} onClick={onClose} />
          {may("organisation:write") && (
            <>
              <Btn type="secondary" label={t("Edit org unit", "تعديل الوحدة")} icon="PencilEdit01" disabled={pending} onClick={onEdit} />
              <Btn type="danger" label={t("Delete org unit", "حذف الوحدة")} disabled={pending} onClick={remove} />
            </>
          )}
        </>
      }
    >
      {problem && <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{problem}</p>}
      <dl className="awp-kv" style={{ margin: 0 }}>
        <dt>{t("Lead", "القائد")}</dt>
        <dd><Lead id={unit.lead} /></dd>
        <dt>{t("People", "الأشخاص")}</dt>
        <dd>{unit.people}</dd>
        <dt>{t("Agents", "الوكلاء")}</dt>
        <dd>{unit.agents}</dd>
        <dt>{t("Projects", "المشاريع")}</dt>
        <dd>{unit.projects}</dd>
      </dl>
      <div>
        <b>{t("History", "السجل")}</b>
        {history === null ? (
          <p className="awp-small awp-muted" style={{ margin: "8px 0 0" }}>{t("Loading…", "جارٍ التحميل…")}</p>
        ) : history.length === 0 ? (
          <p className="awp-small awp-muted" style={{ margin: "8px 0 0" }}>
            {t("Nothing has happened yet.", "لم يحدث شيء بعد.")}
          </p>
        ) : (
          <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {history.map((event) => (
              <li key={`${event.at}-${event.action}`} className="awp-small">
                <span className="awp-mono">{event.action}</span> · {event.actorLabel} ·{" "}
                {new Date(event.at).toLocaleString(lang === "ar" ? "ar-AE" : "en-AE")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

/**
 * S-42: the org units table, child units indented under the roots, with each unit's lead and
 * counts. A unit's name opens its drawer; New org unit and Edit org unit are offered to
 * holders of `organisation:write`.
 */
export function OrgUnits({ units, options }: { units: OrgUnitRow[]; options: OrgUnitOption[] }) {
  const { t } = useAwp();
  const may = useMay();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  // By id, so the drawer and the edit read the row the server sent back after a save.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = units.find((unit) => unit.id === openId) ?? null;

  return (
    <div className="awp-page">
      <PageHead
        title={t("Org units", "الوحدات التنظيمية")}
        sub={t(
          "Departments and teams. People and agents belong to org units and report up a line.",
          "الأقسام والفرق. ينتمي الموظفين والوكلاء إلى الوحدات ويتبعون تسلسلاً.",
        )}
      >
        {may("organisation:write") && (
          <Btn label={t("New org unit", "وحدة جديدة")} icon="AddCircle" onClick={() => setCreating(true)} />
        )}
      </PageHead>
      <Card pad={false}>
        <DataTable
          rows={units}
          cols={[
            {
              h: t("Unit", "الوحدة"),
              r: (u) => (
                <div className="awp-row" style={{ paddingInlineStart: u.isRoot ? 0 : 20 }}>
                  <Ic n="Folder2" s={18} />
                  <Lnk onClick={() => setOpenId(u.id)}>{t(u.nameEn, u.nameAr)}</Lnk>
                </div>
              ),
            },
            { h: t("Lead", "القائد"), r: (u) => <Lead id={u.lead} /> },
            { h: t("People", "الأشخاص"), end: true, r: (u) => u.people },
            { h: t("Agents", "الوكلاء"), end: true, r: (u) => u.agents },
            { h: t("Projects", "المشاريع"), end: true, r: (u) => u.projects },
          ]}
        />
      </Card>
      {open && !editing && <OrgUnitDrawer unit={open} onEdit={() => setEditing(true)} onClose={() => setOpenId(null)} />}
      {open && editing && (
        <EditOrgUnitModal unit={open} units={units} options={options} onClose={() => setEditing(false)} />
      )}
      {creating && <NewOrgUnitModal options={options} onClose={() => setCreating(false)} />}
    </div>
  );
}
