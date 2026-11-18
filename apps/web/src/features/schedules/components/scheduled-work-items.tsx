"use client";

import { orThrow } from "@/lib/outcome";
import { useOptimistic, useState } from "react";

import { useProjOpts } from "@/components/shared/forms";
import { DataTable, FilterBar, Sel } from "@/components/shared/layout";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { deleteSchedule, runNow, setAllSchedulesActive, setScheduleActive } from "@/features/schedules/actions";
import { type Schedule } from "@/features/schedules/types";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { formatDay, formatTime } from "@/i18n";
import type { ServerPage } from "@/lib/paging";

/**
 * S-31: the work items the platform creates on a schedule or an event.
 *
 * Every control here reaches the server. A toggle that only changed the row in the browser
 * would show a schedule as paused while it went on firing.
 */

/** S-31's filters as the URL holds them: `all`, `agent` or `human`; a project key or `any`; search text. */
export type ScheduleFilters = { audience: string; project: string; q: string };

/**
 * One page of the schedules, filtered on the server (D349), with how many of every visible
 * schedule are active, which "Pause all" says before it stops them.
 */
export function Routines({
  schedules,
  page,
  active,
  filters,
}: {
  schedules: Schedule[];
  page: ServerPage;
  active: number;
  filters: ScheduleFilters;
}) {
  const { t, lang, aName } = useAwp();
  const { act, open } = useModals();
  const projOpts = useProjOpts();
  const filter = useFilterQuery();
  const [search, setSearch] = useState(filters.q);
  // The list is the server's: an action revalidates the page and the new props are the rows,
  // with the version the next change names. A toggle shows at once and falls back to the
  // props when the action ends.
  const [rows, showActive] = useOptimistic(schedules, (current: Schedule[], change: { id: string; on: boolean }) =>
    current.map((x) => (x.id === change.id ? { ...x, on: change.on } : x)),
  );
  // `UC-21.2-02`: a project's own "In this project" link arrives with `?project=`, which
  // filters the list to that project.
  const [run] = useAction();
  const list = rows;
  const lastTone: Record<string, string> = { Created: "success", Failed: "danger", Skipped: "neutral" };
  const lastLbl: Record<string, string> = {
    Created: t("Created", "أُنشئ"),
    Failed: t("Failed", "فشل"),
    Skipped: t("Skipped", "تم التخطي"),
  };

  /** "Every day at 02:00", "Working days at 09:00", "Event: work_item.created". */
  const cadence = (r: Schedule): [string, string] => {
    if (r.repeats === "OnEvent") return [`Event: ${r.eventName}`, `حدث: ${r.eventName}`];
    const when = r.timeOfDay ? ` at ${r.timeOfDay}` : "";
    const whenAr = r.timeOfDay ? ` الساعة ${r.timeOfDay}` : "";
    const every: Record<string, [string, string]> = {
      Once: ["Once", "مرة واحدة"],
      Daily: r.skipHolidaysAndWeekends ? ["Working days", "أيام العمل"] : ["Every day", "كل يوم"],
      Weekly: ["Every week", "كل أسبوع"],
      Monthly: ["1st of month", "أول كل شهر"],
    };
    const [en, ar] = every[r.repeats] ?? [r.repeats, r.repeats];
    return [en + when, ar + whenAr];
  };

  /** `UC-31.1-06`: one schedule pauses or resumes, and the row follows what was written. */
  const toggle = (row: Schedule, on: boolean) =>
    run(async () => {
      showActive({ id: row.id, on });
      orThrow(await setScheduleActive({ id: row.id, active: on, version: row.version }));
      return on
        ? t(`${row.n} is active.`, `${row.n} نشط.`)
        : t(`${row.n} is paused.`, `تم إيقاف ${row.n}.`);
    });

  /** `UC-31.1-03`: fire it now, and say what the firing produced. */
  const fire = (row: Schedule) =>
    run(async () => {
      const outcome = orThrow(await runNow({ id: row.id }));
      return outcome.outcome === "Created"
        ? t(`Created ${outcome.createdKey}.`, `أُنشئ ${outcome.createdKey}.`)
        : (outcome.detail ?? outcome.outcome);
    });

  /** Removes the row and the Temporal Schedule firing it; firing history goes with it. */
  const remove = (row: Schedule) =>
    act({
      title: t("Delete scheduled work item", "حذف بند العمل المجدول"),
      desc: t(
        "This stops it from ever firing again and removes its firing history. This cannot be undone.",
        "هذا يوقفه عن التنفيذ نهائياً ويزيل سجل تشغيله. لا يمكن التراجع عن هذا.",
      ),
      confirm: t("Delete", "حذف"),
      danger: true,
      onDone: () =>
        run(async () => {
          orThrow(await deleteSchedule({ id: row.id }));
          return t("Scheduled work item deleted.", "حُذف بند العمل المجدول.");
        }),
    });

  /**
   * `UC-31.1-05` and `COM-11`: nothing fires until they are resumed, which is worth saying
   * before it happens rather than afterwards.
   */
  const pauseAll = () =>
    act({
      title: t("Pause all", "إيقاف الكل"),
      desc: t(
        `Every schedule stops. ${active} are active now, and nothing will fire until they are resumed.`,
        `تتوقف كل الجداول. ${active} نشطة الآن، ولن يُنفَّذ شيء حتى تُستأنف.`,
      ),
      confirm: t("Pause all", "إيقاف الكل"),
      danger: true,
      onDone: () =>
        run(async () => {
          const changed = await setAllSchedulesActive({ active: false });
          return t(`${changed} schedules paused.`, `تم إيقاف ${changed} جدولاً.`);
        }),
    });

  return (
    <div className="awp-page">
      <PageHead
        title={t("Scheduled Work Items", "بنود العمل المجدولة")}
        sub={t(
          "Work items created on a schedule or event, assigned to an agent or a person.",
          "بنود عمل تُنشأ وفق جدول أو حدث وتُسند إلى وكيل أو شخص.",
        )}
      >
        <Btn type="secondary" label={t("Pause all", "إيقاف الكل")} onClick={pauseAll} />
        <Btn label={t("New Scheduled Work Item", "بند عمل مجدول جديد")} icon="AddCircle" onClick={() => open("schedule")} />
      </PageHead>
      <Card pad={false}>
        <FilterBar>
          <span className="awp-small awp-muted">{t("Audience", "الجمهور")}</span>
          <Chips
            value={filters.audience}
            onChange={(id) => filter.set("audience", id)}
            items={[
              { id: "all", label: t("All", "الكل") },
              { id: "agent", label: t("Agents", "الوكلاء") },
              { id: "human", label: t("Humans", "الأشخاص") },
            ]}
          />
          <Sel value={filters.project} onChange={(key) => filter.set("project", key === "any" ? "" : key)} w={280} opts={projOpts()} />
          <input
            className="awp-input"
            style={{ flex: "1 1 220px", maxWidth: 320 }}
            value={search}
            placeholder={t("Search by title", "ابحث بالعنوان")}
            aria-label={t("Search scheduled work items", "ابحث في بنود العمل المجدولة")}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") filter.set("q", search.trim());
            }}
            onBlur={() => filter.set("q", search.trim())}
          />
        </FilterBar>
        <DataTable
          rows={list}
          rowKey={(r) => r.id}
          server={{ ...page, onPage: (next) => filter.set("page", String(next)) }}
          cols={[
            { h: "", r: (r) => <Toggle on={r.on} onChange={(v) => toggle(r, v)} /> },
            {
              h: t("Scheduled work item", "بند العمل المجدول"),
              r: (r) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{t(r.n, r.nAr)}</div>
                  <div className="awp-small awp-muted">{t(...cadence(r))}</div>
                </div>
              ),
            },
            { h: t("Project", "المشروع"), r: (r) => <span className="awp-mono">{r.p}</span> },
            {
              h: t("Audience", "الجمهور"),
              r: (r) =>
                r.audienceType === "Group" ? (
                  <div className="awp-row">
                    {t(r.groupNameEn ?? "", r.groupNameAr ?? "")}
                    <Tg label={t("Group", "مجموعة")} />
                  </div>
                ) : (
                  <div className="awp-row">
                    <Who id={r.a} s={24} />
                    {aName(r.a)}
                    <Tg label={r.isAgent ? t("Agent", "وكيل") : t("Human", "شخص")} />
                  </div>
                ),
            },
            {
              h: t("Last run", "آخر تشغيل"),
              r: (r) =>
                r.last ? (
                  <Tg tone={lastTone[r.last]} dot label={lastLbl[r.last] ?? r.last} />
                ) : (
                  <span className="awp-muted">{t("Never", "لم يُشغّل")}</span>
                ),
            },
            {
              h: t("Next", "التالي"),
              r: (r) =>
                !r.on ? (
                  <span className="awp-muted">{t("Paused", "متوقف")}</span>
                ) : r.nextRunAt ? (
                  `${formatDay(lang, new Date(r.nextRunAt))} ${formatTime(lang, new Date(r.nextRunAt))}`
                ) : (
                  t("On event", "عند الحدث")
                ),
            },
            {
              h: "",
              end: true,
              r: (r) => (
                <div className="awp-row" style={{ justifyContent: "flex-end", gap: 12 }}>
                  <Lnk onClick={() => fire(r)}>{t("Run now", "تشغيل الآن")}</Lnk>
                  <Lnk onClick={() => open("schedule", { id: r.id })}>{t("Edit", "تعديل")}</Lnk>
                  <Lnk danger onClick={() => remove(r)}>
                    {t("Delete", "حذف")}
                  </Lnk>
                </div>
              ),
            },
          ]}
        />
        {list.length === 0 && (
          <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }} role="status">
            {t("No scheduled work items.", "لا توجد بنود عمل مجدولة.")}
          </p>
        )}
      </Card>
    </div>
  );
}
