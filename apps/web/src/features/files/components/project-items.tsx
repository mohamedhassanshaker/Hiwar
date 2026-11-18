"use client";

import { orThrow } from "@/lib/outcome";
import { useOptimistic, useState, type ReactNode } from "react";

import { useProjOpts } from "@/components/shared/forms";
import { DataTable, Grid, Sel } from "@/components/shared/layout";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { Pager } from "@/components/shared/pager";
import { StTag } from "@/components/shared/status-tags";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Ic } from "@/components/ui/icon";
import { Seg } from "@/components/ui/tabs";
import { Who } from "@/components/ui/avatar";
import { deleteItem, setFileStatus } from "@/features/files/actions";
import type { ProjectItem } from "@/features/files/types";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import type { ServerPage } from "@/lib/paging";
import { useGo } from "@/lib/routes";
import { useScopeLabel } from "./file-modals";

/**
 * S-32 artifacts and S-33 project files: the same list, with what differs between them.
 *
 * Every act here reaches the server. Deactivating in the browser only would leave an agent
 * still using a document somebody had taken out of use.
 */

type Item = ProjectItem;

/** The list's filters as the URL holds them: a project key and words in the name. */
type ItemFilterValues = { project: string; q: string };

/** One page of a list, the filters it was read with, and whether the person may write. */
type ListProps = { items: Item[]; mayWrite: boolean; page: ServerPage; filters: ItemFilterValues };

/**
 * One page of the Artifacts or Files list as cards or a table, filtered on the server by
 * project and name (D349); the filters live in the URL, so `UC-21.2-02`'s "In this project"
 * link arrives already filtered. Rows come from the server's props; a status change shows at
 * once through `useOptimistic`. View opens the preview; writers may activate, deactivate and
 * delete.
 */
function ProjectItems({
  kind,
  items,
  mayWrite,
  page,
  filters,
  title,
  sub,
  actions,
}: ListProps & {
  kind: "artifact" | "file";
  title: string;
  sub: string;
  actions?: ReactNode;
}) {
  const { t, aName } = useAwp();
  const { open: openModal } = useModals();
  const go = useGo();
  const projOpts = useProjOpts();
  const scopeLabel = useScopeLabel();
  const filter = useFilterQuery();
  const [view, setView] = useState("cards");
  const [text, setText] = useState(filters.q);
  // The list is the server's: an action revalidates the page and the new props are the rows.
  // A status change shows at once and falls back to the props when the action ends.
  const [rows, showStatus] = useOptimistic(items, (current: Item[], change: { n: string; st: string }) =>
    current.map((y) => (y.n === change.n ? { ...y, st: change.st } : y)),
  );
  const [run] = useAction();

  const onPage = (next: number) => filter.set("page", String(next));
  const open = (x: Item) => openModal("preview", { item: x });

  const setStatus = (x: Item, active: boolean) =>
    run(async () => {
      showStatus({ n: x.n, st: active ? "Active" : "Inactive" });
      orThrow(await setFileStatus({ name: x.n, kind, active }));
      return active ? t(`${x.n} is active.`, `${x.n} نشط.`) : t(`${x.n} is inactive.`, `${x.n} معطّل.`);
    });

  const remove = (x: Item) =>
    run(async () => {
      orThrow(await deleteItem({ name: x.n, kind, active: false }));
      return t(
        `${x.n} was removed from ${x.p}. Audit records are kept.`,
        `تمت إزالة ${x.n} من ${x.p}. تُحفظ سجلات التدقيق.`,
      );
    });

  const acts = (x: Item) => (
    <div className="awp-row" style={{ gap: 12 }} onClick={(e) => e.stopPropagation()}>
      <Lnk onClick={() => open(x)}>{t("View", "عرض")}</Lnk>
      {/* `UC-32.1-03`: an artifact produced by a run links to the run that made it. */}
      {x.runKey && x.runAgent && (
        <Lnk onClick={() => go("run", { agent: x.runAgent as string, id: x.runKey as string })}>
          {t("Run", "العملية")}
        </Lnk>
      )}
      {mayWrite &&
        (x.st === "Active" ? (
          <Lnk onClick={() => setStatus(x, false)}>{t("Deactivate", "تعطيل")}</Lnk>
        ) : (
          <Lnk onClick={() => setStatus(x, true)}>{t("Activate", "تفعيل")}</Lnk>
        ))}
      {mayWrite && (
        <Lnk danger onClick={() => remove(x)}>
          {t("Delete", "حذف")}
        </Lnk>
      )}
    </div>
  );

  return (
    <div className="awp-page">
      <PageHead title={title} sub={sub}>
        <Seg
          value={view}
          onChange={setView}
          items={[
            { id: "cards", label: t("Cards", "بطاقات") },
            { id: "list", label: t("List", "قائمة") },
          ]}
        />
        {actions}
      </PageHead>
      <div className="awp-row" style={{ gap: 12 }}>
        <Sel value={filters.project || "any"} onChange={(value) => filter.set("project", value === "any" ? "" : value)} w={280} opts={projOpts()} />
        <input
          className="awp-input"
          style={{ maxWidth: 280 }}
          value={text}
          placeholder={t("Search by name", "ابحث بالاسم")}
          aria-label={kind === "artifact" ? t("Search artifacts", "ابحث في المخرجات") : t("Search files", "ابحث في الملفات")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") filter.set("q", text.trim());
          }}
          onBlur={() => filter.set("q", text.trim())}
        />
        <span className="awp-small awp-muted">
          {page.total} {t("items", "بنود")}
        </span>
      </div>
      {view === "cards" ? (
        <Grid min={260}>
          {rows.map((x) => (
            <div
              key={x.n}
              className="awp-card"
              style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, opacity: x.st === "Active" ? 1 : 0.7, cursor: "pointer" }}
              onClick={() => open(x)}
            >
              <div style={{ height: 96, borderRadius: 12, background: "var(--surface-sunken)", display: "grid", placeItems: "center" }}>
                <Ic n="File01" s={32} c="var(--icon-tertiary)" />
              </div>
              <div className="awp-row" style={{ alignItems: "flex-start" }}>
                <b style={{ flex: 1, wordBreak: "break-all" }}>{x.n}</b>
                <StTag s={x.st} />
              </div>
              <div className="awp-row awp-small awp-muted" style={{ gap: 6 }}>
                <Who id={x.w} s={20} />
                {aName(x.w)}
                <span style={{ flex: 1 }} />
                <span className="awp-mono">{x.p}</span> · {x.s}
              </div>
              {x.scope && (
                <div className="awp-small">
                  <span className="awp-muted">{t("Scope", "النطاق")}: </span>
                  {scopeLabel(x)}
                </div>
              )}
              {x.l && (
                <div className="awp-small">
                  <span className="awp-muted">{t("Linked to", "مرتبط بـ")} </span>
                  <span className="awp-mono">{x.l}</span>
                </div>
              )}
              <div style={{ borderTop: "1px solid var(--border-divider)", paddingTop: 10 }}>{acts(x)}</div>
            </div>
          ))}
        </Grid>
      ) : null}
      {view === "cards" ? (
        <Pager page={page.page - 1} last={Math.max(0, Math.ceil(page.total / page.size) - 1)} total={page.total} size={page.size} onPage={(next) => onPage(next + 1)} />
      ) : (
        <Card pad={false}>
          <DataTable
            onRow={open}
            rows={rows}
            server={{ ...page, onPage }}
            cols={[
              { h: t("Name", "الاسم"), r: (x) => (<div className="awp-row"><Ic n="File01" s={18} /><b>{x.n}</b></div>) },
              { h: t("Project", "المشروع"), r: (x) => <span className="awp-mono">{x.p}</span> },
              { h: kind === "file" ? t("Uploaded by", "رفعه") : t("Produced by", "أنتجه"), r: (x) => (<div className="awp-row"><Who id={x.w} s={22} />{aName(x.w)}</div>) },
              kind === "file"
                ? { h: t("Scope of use", "نطاق الاستخدام"), r: (x: Item) => scopeLabel(x) }
                : { h: t("Linked to", "مرتبط بـ"), r: (x: Item) => <span className="awp-mono">{x.l}</span> },
              { h: t("Status", "الحالة"), r: (x) => <StTag s={x.st} /> },
              { h: t("Size", "الحجم"), end: true, r: (x) => x.s },
              { h: "", end: true, r: acts },
            ]}
          />
        </Card>
      )}
      {rows.length === 0 && (
        <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }} role="status">
          {kind === "artifact" ? t("No artifacts yet.", "لا توجد مخرجات بعد.") : t("No files yet.", "لا توجد ملفات بعد.")}
        </p>
      )}
    </div>
  );
}

/** S-32: the Artifacts screen, the project items list for artifacts. */
export function Artifacts(props: ListProps) {
  const { t } = useAwp();
  return (
    <ProjectItems
      kind="artifact"
      {...props}
      title={t("Artifacts", "المخرجات")}
      sub={t(
        "Outputs produced by agents and people inside a project, versioned and linked to their run.",
        "مخرجات أنتجها الوكلاء والأشخاص داخل مشروع، بإصدارات ومرتبطة بعمليتها.",
      )}
    />
  );
}

/** S-33: the Files screen, the project items list for files, with Upload for writers. */
export function Files(props: ListProps) {
  const { t } = useAwp();
  const { open } = useModals();

  return (
    <ProjectItems
      kind="file"
      {...props}
      title={t("Files", "الملفات")}
      sub={t(
        "Files you upload yourself into a project. You choose who may use each one: only you, selected people and agents, or everyone in the project.",
        "ملفات ترفعها بنفسك إلى مشروع. تختار من يمكنه استخدام كل ملف: أنت فقط، أو أشخاص ووكلاء محددون، أو كل من في المشروع.",
      )}
      actions={props.mayWrite ? <Btn label={t("Upload", "رفع")} icon="Download04" onClick={() => open("upload")} /> : undefined}
    />
  );
}
