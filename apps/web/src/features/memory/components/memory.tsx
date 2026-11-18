"use client";

import { useState } from "react";

import { KpiRow } from "@/components/shared/layout";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { Pager } from "@/components/shared/pager";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/tabs";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import {
  clearMyMemory,
  compareVersions,
  createMemory,
  deleteMemory,
  loadVersions,
  restoreVersion,
  reviewMemory,
  saveMemory,
} from "@/features/memory/actions";
import type { MemoryCounts, MemoryEntry, MemoryGroup, MemoryVersion } from "@/features/memory/types";
import { orThrow } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import type { ServerPage } from "@/lib/paging";
import { useAgo } from "@/hooks/use-client-now";
import { formatDay } from "@/i18n";

/** The memory content is Markdown, and a block is a heading then its body. */
const BREAK = String.fromCharCode(10);

/** `ai.memory.status` and `ai.memory_scope.kind` tokens, as the screen writes them. */
const STATUS: Record<string, [string, string, string]> = {
  Active: ["success", "Active", "نشط"],
  PendingReview: ["warning", "Pending review", "بانتظار المراجعة"],
  NeedsAttention: ["danger", "Needs attention", "تحتاج انتباهاً"],
  Rejected: ["neutral", "Rejected", "مرفوض"],
  Archived: ["neutral", "Archived", "مؤرشف"],
};

const SCOPE: Record<string, [string, string]> = {
  Organisation: ["Organisation", "الجهة"],
  BusinessUnit: ["Business unit", "وحدة العمل"],
  Agent: ["Agent", "وكيل"],
  Session: ["Session", "جلسة"],
};

/** The screen's filters as the URL holds them; `all` and `any` mean none. */
type MemoryFilterValues = { scope: string; owner: string; status: string; reviewed: string; source: string; q: string };

/**
 * S-55: the memory explorer and one memory. The explorer shows one page of the memories that
 * match the filters, which the server applies (D349); the detail shows the memory selected,
 * starting with the one the server opened.
 */
export function Memory({
  tree,
  scopeOptions,
  owners,
  memories,
  opened,
  counts,
  versions,
  mayWrite,
  mine,
  page,
  filters,
}: {
  tree: MemoryGroup[];
  /** Every scope a memory may be created under, including the ones holding none yet. */
  scopeOptions: { id: string; n: [string, string] }[];
  /** Who owns the memories this person may see, for the owner filter. */
  owners: { id: string; n: [string, string] }[];
  /** The page of memories the explorer shows. */
  memories: MemoryEntry[];
  /** The memory the screen opens with: the one the address names, or the page's first. */
  opened: MemoryEntry | null;
  counts: MemoryCounts;
  /** The opened memory's version history; another memory's is read when its History opens. */
  versions: Record<string, MemoryVersion[]>;
  /** `UC-55.2-04`: whether this person may change or decide a memory at all. */
  mayWrite: boolean;
  /** D68: how many memories sit in this person's own private agent scopes. */
  mine: number;
  page: ServerPage;
  filters: MemoryFilterValues;
}) {
  const { t, lang, aName } = useAwp();
  const { age } = useAgo();
  const { act } = useModals();
  const filter = useFilterQuery();
  const byId = new Map([...(opened ? [opened] : []), ...memories].map((memory) => [memory.id, memory]));
  const [sel, setSel] = useState(opened?.id ?? "");
  const [q, setQ] = useState(filters.q);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hist, setHist] = useState(false);
  const [history, setHistory] = useState<Record<string, MemoryVersion[]>>({});
  const [edit, setEdit] = useState(false);
  const [nw, setNw] = useState(false);
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newScope, setNewScope] = useState("");
  const [newRequiresReview, setNewRequiresReview] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [run, pending] = useAction();
  /** `UC-55.1-02` … `-04`: a filter goes to the server; "any" clears it. */
  const setFilter = (key: string, value: string) => filter.set(key, value === "any" ? "" : value);

  const m = byId.get(sel) ?? opened ?? memories[0];
  const shownVersions = m ? (versions[m.id] ?? history[m.id] ?? []) : [];
  const openHistory = () =>
    run(async () => {
      if (m && !versions[m.id] && !history[m.id]) {
        const path = m.id;
        const read = orThrow(await loadVersions(path));
        setHistory((known) => ({ ...known, [path]: read }));
      }
      setHist(true);
      return null;
    });

  /**
   * `UC-55.3-06`: drawn from both the explorer and the empty state, because the first
   * memory in an organisation is created when there is nothing to select.
   */
  const newMemoryModal = nw && (
    <Modal
      title={t("New memory", "ذاكرة جديدة")}
      onClose={() => setNw(false)}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={() => setNw(false)} />
          <Btn
            label={t("Create", "إنشاء")}
            disabled={pending || newTitle.trim() === "" || newContent.trim() === "" || newScope === ""}
            onClick={() =>
              run(async () => {
                const path = orThrow(await createMemory({
                  scopePath: newScope,
                  slug: newTitle
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")
                    .slice(0, 60),
                  titleEn: newTitle,
                  titleAr: newTitle,
                  content: newContent,
                  requiresReview: newRequiresReview,
                }));
                setNw(false);
                setNewTitle("");
                setNewContent("");
                return t(`Created ${path}.`, `أُنشئت ${path}.`);
              })
            }
          />
        </>
      }
    >
      <Field label={t("Title", "العنوان")}>
        <input
          className="awp-input"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder={t("e.g. Vendor onboarding rules", "مثال: قواعد تسجيل الموردين")}
        />
      </Field>
      <Field label={t("Scope", "النطاق")}>
        <PopSelect className="awp-input" value={newScope} onChange={(event) => setNewScope(event.target.value)}>
          <option value="">{t("Choose a scope…", "اختر نطاقاً…")}</option>
          {scopeOptions.map((scopeOption) => (
            <option key={scopeOption.id} value={scopeOption.id}>
              {t(scopeOption.n[0], scopeOption.n[1])}
            </option>
          ))}
        </PopSelect>
      </Field>
      <Field label={t("Content", "المحتوى")}>
        <textarea className="awp-input" rows={5} value={newContent} onChange={(event) => setNewContent(event.target.value)} />
      </Field>
      <div className="awp-row" style={{ gap: 10 }}>
        <input
          type="checkbox"
          id="memory-requires-review"
          checked={newRequiresReview}
          onChange={(event) => setNewRequiresReview(event.target.checked)}
        />
        {/* `UC-55.3-06`: with review required it is not used in runs until approved. */}
        <label htmlFor="memory-requires-review">{t("Needs review before it is used", "تحتاج مراجعة قبل الاستخدام")}</label>
      </div>
    </Modal>
  );

  /**
   * D68: a person sees what the agents have remembered about them and can clear it.
   *
   * It clears their own private memory only, which is why the action takes no argument
   * at all — the person is the session's.
   */
  const clearMine = mayWrite && mine > 0 && (
    <Btn
      type="secondary"
      label={t(`Clear my memory (${mine})`, `امسح ذاكرتي (${mine})`)}
      disabled={pending}
      onClick={() =>
        act({
          title: t("Clear my memory", "مسح ذاكرتي"),
          desc: t(
            "This removes everything the agents have remembered about you, with its version history. Shared memory is untouched, and nobody else's memory is affected.",
            "يزيل هذا كل ما تذكّره الوكلاء عنك مع سجل إصداراته. لا تتأثر الذاكرة المشتركة ولا ذاكرة أي شخص آخر.",
          ),
          confirm: t("Clear", "مسح"),
          onDone: () =>
            run(async () => {
              const cleared = orThrow(await clearMyMemory());
              setSel("");
              return t(`Cleared ${cleared} memories.`, `تم مسح ${cleared} ذاكرة.`);
            }),
        })
      }
    />
  );

  // Only an organisation with no memory at all gets the empty page; a filter that matches
  // nothing keeps the screen, its search and the explorer's Clear (COM-05).
  if (!m && counts.total === 0) {
    return (
      <div className="awp-page">
        <PageHead
          crumb={t("AI Capabilities", "قدرات الذكاء الاصطناعي")}
          title={t("Memory", "الذاكرة")}
          sub={t("Manage persistent knowledge, agent context and governance.", "إدارة المعرفة الدائمة وسياق الوكلاء والحوكمة.")}
        >
          {clearMine}
          {mayWrite && <Btn label={t("New memory", "ذاكرة جديدة")} icon="AddCircle" onClick={() => setNw(true)} />}
        </PageHead>
        <Card><p className="awp-muted" style={{ margin: 0 }}>{t("No memory yet.", "لا توجد ذاكرة بعد.")}</p></Card>
        {newMemoryModal}
      </div>
    );
  }
  const status = m ? (STATUS[m.st] ?? ["neutral", m.st, m.st]) : null;

  return (
    <div className="awp-page">
      <PageHead crumb={t("AI Capabilities", "قدرات الذكاء الاصطناعي")} title={t("Memory", "الذاكرة")} sub={t("Manage persistent knowledge, agent context and governance.", "إدارة المعرفة الدائمة وسياق الوكلاء والحوكمة.")}>
        {clearMine}
        {mayWrite && <Btn label={t("New memory", "ذاكرة جديدة")} icon="AddCircle" onClick={() => setNw(true)} />}
      </PageHead>
      <KpiRow
        items={[
          { label: t("Total memories", "إجمالي الذاكرات"), value: counts.total },
          { label: t("Pending review", "بانتظار المراجعة"), value: counts.pendingReview, tone: counts.pendingReview ? "warning" : undefined },
          { label: t("Active agents", "الوكلاء النشطون"), value: counts.agents },
          { label: t("Needs attention", "تحتاج انتباهاً"), value: counts.needsAttention, tone: counts.needsAttention ? "danger" : undefined },
        ]}
      />
      <Card>
        <div className="awp-col" style={{ gap: 12 }}>
          <div className="awp-row" style={{ gap: 10 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <span style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)", display: "flex" }}>
                <Ic n="Search" s={18} c="var(--icon-tertiary)" />
              </span>
              {/* The search reads the titles and the content, so a keyword somebody remembers
                  from the body finds the memory it is in rather than only matching its name. */}
              <input
                className="awp-input"
                style={{ paddingInlineStart: 38, width: "100%" }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") filter.set("q", q.trim());
                }}
                onBlur={() => filter.set("q", q.trim())}
                placeholder={t("Search memories, policies, agents or keywords…", "ابحث في الذاكرات أو السياسات أو الوكلاء أو الكلمات…")}
              />
            </div>
            <button className="awp-iconbtn" aria-label={t("Filters", "عوامل التصفية")} aria-pressed={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
              <Ic n="Sorting02" />
            </button>
          </div>
          {/* `UC-55.1-04`: owner, status, last reviewed and source, applied to the tree. */}
          {filtersOpen && (
            <div className="awp-row" style={{ gap: 10, flexWrap: "wrap" }}>
              <PopSelect className="awp-input" style={{ maxWidth: 200 }} value={filters.owner} onChange={(event) => setFilter("owner", event.target.value)} aria-label={t("Owner", "المستخدم")}>
                <option value="any">{t("Any owner", "أي مستخدم")}</option>
                {owners.map((one) => (
                  <option key={one.id} value={one.id}>
                    {t(one.n[0], one.n[1])}
                  </option>
                ))}
              </PopSelect>
              <PopSelect className="awp-input" style={{ maxWidth: 200 }} value={filters.status} onChange={(event) => setFilter("status", event.target.value)} aria-label={t("Status", "الحالة")}>
                <option value="any">{t("Any status", "أي حالة")}</option>
                {Object.entries(STATUS).map(([id, [, en, ar]]) => (
                  <option key={id} value={id}>
                    {t(en, ar)}
                  </option>
                ))}
              </PopSelect>
              <PopSelect className="awp-input" style={{ maxWidth: 220 }} value={filters.reviewed} onChange={(event) => setFilter("reviewed", event.target.value)} aria-label={t("Last reviewed", "آخر مراجعة")}>
                <option value="any">{t("Reviewed at any time", "مراجَعة في أي وقت")}</option>
                <option value="overdue">{t("Review overdue", "المراجعة متأخرة")}</option>
                <option value="never">{t("Never reviewed", "لم تُراجع")}</option>
              </PopSelect>
              <PopSelect className="awp-input" style={{ maxWidth: 200 }} value={filters.source} onChange={(event) => setFilter("source", event.target.value)} aria-label={t("Source", "المصدر")}>
                <option value="any">{t("Any source", "أي مصدر")}</option>
                <option value="AgentRun">{t("Proposed by a run", "مقترحة من عملية")}</option>
                <option value="Person">{t("Written by a person", "كتبها شخص")}</option>
              </PopSelect>
            </div>
          )}
          <Chips
            value={filters.scope}
            onChange={(id) => filter.set("scope", id)}
            items={[{ id: "all", label: t("All scopes", "كل النطاقات") }, ...Object.entries(SCOPE).map(([id, [en, ar]]) => ({ id, label: t(en, ar) }))]}
          />
        </div>
      </Card>
      <div className="awp-card awp-two" style={{ display: "grid", gridTemplateColumns: "minmax(220px,260px) minmax(0,1fr)", padding: 0, overflow: "hidden" }}>
        <nav style={{ background: "var(--surface-card)", padding: "16px 10px", borderInlineEnd: "1px solid var(--border-divider)" }} aria-label={t("Memory explorer", "مستكشف الذاكرة")}>
          <div className="awp-small awp-muted" style={{ padding: "0 10px 10px", fontWeight: 900, letterSpacing: ".04em", textTransform: "uppercase" }}>{t("Memory explorer", "مستكشف الذاكرة")}</div>
          {tree.length === 0 && (
            <div className="awp-col" style={{ padding: "0 10px", gap: 8, alignItems: "flex-start" }} role="status">
              <p className="awp-small awp-muted" style={{ margin: 0 }}>
                {t("No memory matches these filters.", "لا توجد ذاكرة تطابق عوامل التصفية هذه.")}
              </p>
              <button
                className="awp-chip"
                onClick={() => {
                  setQ("");
                  filter.clear();
                }}
              >
                {t("Clear", "مسح")}
              </button>
            </div>
          )}
          {tree.map((g) => {
            const kids = g.kids;
            const on = g.kids.some((k) => k.id === m?.id);
            return (
              <div key={g.id} style={{ marginBottom: 6, borderRadius: 12, background: on && g.agent ? "var(--surface-brand-subtle)" : "transparent", padding: on && g.agent ? "4px 0" : 0 }}>
                <button onClick={() => setOpen({ ...open, [g.id]: open[g.id] === false })} className="awp-row" style={{ width: "100%", gap: 8, border: 0, background: "transparent", cursor: "pointer", padding: "8px 10px", color: "var(--text-primary)", fontWeight: 500, textAlign: "start" }}>
                  {g.agent ? <Who id={g.agent} s={20} /> : <Ic n={g.ic ?? "Bank"} s={18} />}
                  <span style={{ flex: 1 }}>{t(g.n[0], g.n[1])}</span>
                  <Ic n={open[g.id] !== false ? "ChevronDown" : "ChevronTight"} s={14} c="var(--icon-tertiary)" />
                </button>
                {open[g.id] !== false &&
                  kids.map((k) => {
                    const child = byId.get(k.id);
                    return (
                      <button key={k.id} onClick={() => setSel(k.id)} className="awp-row" style={{ width: "100%", border: 0, cursor: "pointer", padding: "6px 10px 6px 38px", gap: 6, textAlign: "start", borderRadius: 8, background: "transparent", color: m?.id === k.id ? "var(--text-brand)" : "var(--text-secondary)", fontWeight: m?.id === k.id ? 900 : 400 }}>
                        <span style={{ flex: 1 }}>{t(k.n[0], k.n[1])}</span>
                        {child && child.st !== "Active" && <span className="awp-dot" style={{ background: child.st === "NeedsAttention" ? "var(--icon-danger)" : "var(--icon-warning)" }} />}
                      </button>
                    );
                  })}
              </div>
            );
          })}
          <Pager
            page={page.page - 1}
            last={Math.max(0, Math.ceil(page.total / page.size) - 1)}
            total={page.total}
            size={page.size}
            onPage={(next) => filter.set("page", String(next + 1))}
          />
        </nav>
        {m && status && (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          <div className="awp-row" style={{ alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{t(m.scopeLabel[0], m.scopeLabel[1])}</h2>
              <div className="awp-small awp-muted">{t(m.path[0], m.path[1])}</div>
            </div>
            <Tg tone={status[0]} dot label={t(status[1], status[2])} />
            {mayWrite && (
            <Btn
              type="danger"
              label={t("Delete memory", "حذف الذاكرة")}
              disabled={pending}
              onClick={() =>
                act({
                  title: t("Delete memory", "حذف الذاكرة"),
                  desc: t(
                    "Deleting removes this memory and its version history. It no longer informs any agent's runs.",
                    "الحذف يزيل هذه الذاكرة وسجل إصداراتها. لن تُستخدم بعد الآن في عمليات أي وكيل.",
                  ),
                  confirm: t("Delete", "حذف"),
                  onDone: () =>
                    run(async () => {
                      orThrow(await deleteMemory({ path: m.id }));
                      setSel(memories.find((entry) => entry.id !== m.id)?.id ?? "");
                      return t("Memory deleted.", "حُذفت الذاكرة.");
                    }),
                })
              }
            />
            )}
          </div>
          {m.reviewOverdue && (
            <div className="awp-row" style={{ gap: 10, padding: 12, borderRadius: 12, background: "var(--feedback-danger-bg)", color: "var(--feedback-danger-text)" }}>
              <Ic n="WarningSign" s={18} c="currentColor" />
              <span style={{ flex: 1 }}>
                {m.reviewedAt
                  ? t(`Not reviewed for ${age(m.reviewedAt)}. Its review is overdue.`, `لم تُراجع منذ ${age(m.reviewedAt)}. المراجعة متأخرة.`)
                  : t("Never reviewed.", "لم تُراجع قط.")}
              </span>
              {/* `UC-55.2-03`: reviewing it moves "Last reviewed" and clears the warning. */}
              <Lnk
                onClick={() =>
                  act({
                    title: t("Review now", "المراجعة الآن"),
                    desc: t(
                      "Confirming records the review against you and clears the overdue warning.",
                      "التأكيد يسجل المراجعة باسمك ويزيل تنبيه التأخر.",
                    ),
                    confirm: t("Reviewed", "تمت المراجعة"),
                    onDone: () =>
                      run(async () => {
                        orThrow(await reviewMemory({ path: m.id, decision: "Approved" }));
                        return t("Review recorded.", "سُجلت المراجعة.");
                      }),
                  })
                }
              >
                {t("Review now", "المراجعة الآن")}
              </Lnk>
            </div>
          )}
          {m.st === "PendingReview" && (
            <div className="awp-row" style={{ gap: 10, padding: 12, borderRadius: 12, background: "var(--feedback-warning-bg)", color: "var(--feedback-warning-text)" }}>
              <Ic n="InfoSign" s={18} c="currentColor" />
              <span style={{ flex: 1 }}>{t("Proposed by the agent. Approve before it is used in runs.", "مقترحة من الوكيل. اعتمدها قبل استخدامها في العمليات.")}</span>
              {/* `UC-55.2-04`: whoever proposed it is told why, rather than offered a decision
                  the service would refuse. */}
              {!m.mayReview && (
                <span className="awp-small">{t("Somebody else has to review what you proposed.", "على شخص آخر مراجعة ما اقترحته.")}</span>
              )}
              <Btn
                type="secondary"
                label={t("Reject", "رفض")}
                disabled={pending || !m.mayReview}
                onClick={() => run(async () => {
                  orThrow(await reviewMemory({ path: m.id, decision: "Rejected" }));
                  return t("Rejected.", "رُفضت.");
                })}
              />
              <Btn
                label={t("Approve", "اعتماد")}
                disabled={pending || !m.mayReview}
                onClick={() => run(async () => {
                  orThrow(await reviewMemory({ path: m.id, decision: "Approved" }));
                  return t("Approved.", "اعتُمدت.");
                })}
              />
            </div>
          )}
          <div className="awp-row" style={{ borderTop: "1px solid var(--border-divider)", paddingTop: 14 }}>
            <span className="awp-muted" style={{ flex: 1 }}>{t("Version", "الإصدار")} {m.v}</span>
            <button className="awp-row awp-lnk-t" style={{ gap: 6 }} disabled={pending} onClick={openHistory}>
              <Ic n="Calendar03" s={16} />
              {t("History", "السجل")}
            </button>
          </div>
          {m.items.map((item, i) => (
            <div key={i} style={{ paddingBottom: 16, borderBottom: "1px solid var(--border-divider)" }}>
              <h4 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 900 }}>{item.heading}</h4>
              <p style={{ margin: "0 0 6px" }}>{item.body}</p>
              <div className="awp-small awp-muted">{t("Source", "المصدر")} · {item.source}</div>
            </div>
          ))}
          <div>
            <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 900 }}>{t("Memory details", "تفاصيل الذاكرة")}</h4>
            <dl className="awp-kv" style={{ margin: 0 }}>
              <dt>{t("Scope", "النطاق")}</dt>
              <dd>{t(...(SCOPE[m.scope] ?? [m.scope, m.scope]))}</dd>
              <dt>{t("Owner", "المستخدم")}</dt>
              <dd>{t(m.owner[0], m.owner[1])}</dd>
              <dt>{t("Last reviewed", "آخر مراجعة")}</dt>
              <dd>{m.reviewedAt ? formatDay(lang, new Date(m.reviewedAt)) : "—"}</dd>
              <dt>{t("Access", "الوصول")}</dt>
              <dd>{t(m.access[0], m.access[1])}</dd>
              <dt>{t("Write policy", "سياسة الكتابة")}</dt>
              <dd>
                {m.requiresReview
                  ? t("PII filter · human approval for new rules", "فلتر البيانات الشخصية · اعتماد بشري للقواعد الجديدة")
                  : t("PII filter · agents may write", "فلتر البيانات الشخصية · يمكن للوكلاء الكتابة")}
              </dd>
            </dl>
          </div>
          {mayWrite && (
            <Btn
              label={t("Edit memory", "تعديل الذاكرة")}
              icon="PencilEdit01"
              onClick={() => {
                setContent(m.items.map((item) => `## ${item.heading}` + BREAK + item.body).join(BREAK + BREAK));
                setNote("");
                setEdit(true);
              }}
            />
          )}
        </div>
        )}
      </div>
      {hist && m && (
        <Modal w={640} title={`${t("Version history", "سجل الإصدارات")} · ${t(m.title[0], m.title[1])}`} onClose={() => setHist(false)}>
          {shownVersions.map((version) => (
            <div key={version.v} className="awp-row" style={{ gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border-divider)", alignItems: "flex-start" }}>
              <Tg label={`v${version.v}`} tone={version.v === m.v ? "info" : "neutral"} />
              <div style={{ flex: 1 }}>
                <div>{version.note}</div>
                <div className="awp-small awp-muted">{aName(version.by)} · {formatDay(lang, new Date(version.at))}</div>
              </div>
              <div className="awp-row" style={{ gap: 12 }}>
                {/* The current version is what the others are compared against, so it has
                    nothing to compare itself with and nothing to restore. */}
                {version.v !== m.v && (
                <Lnk
                  onClick={() =>
                    run(async () => {
                      // `UC-55.3-04`: the two versions as they are, side by side. Opening
                      // the comparison is what it says, so there is nothing to report.
                      const both = await compareVersions(m.id, version.v, m.v);
                      act({
                        title: `${t("Compare", "مقارنة")} v${version.v} → v${m.v}`,
                        desc: t("Side-by-side against the current version.", "جنباً إلى جنب مع الإصدار الحالي."),
                        body: (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <pre className="awp-mono awp-small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{both.from}</pre>
                            <pre className="awp-mono awp-small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{both.to}</pre>
                          </div>
                        ),
                      });
                      return null;
                    })
                  }
                >
                  {t("Compare", "مقارنة")}
                </Lnk>
                )}
                {version.v !== m.v && (
                  <Lnk
                    onClick={() =>
                      act({
                        title: `${t("Restore", "استعادة")} v${version.v}`,
                        desc: t(
                          `Creates version ${m.v + 1} with this content. The change is audited.`,
                          `ينشئ الإصدار ${m.v + 1} بهذا المحتوى. التغيير مدقق.`,
                        ),
                        confirm: t("Restore", "استعادة"),
                        // `UC-55.3-05`: the old version stays; a new one carries its content.
                        onDone: () =>
                          run(async () => {
                            const created = orThrow(await restoreVersion({ path: m.id, fromVersion: version.v }));
                            return t(`Version ${created} created.`, `أُنشئ الإصدار ${created}.`);
                          }),
                      })
                    }
                  >
                    {t("Restore", "استعادة")}
                  </Lnk>
                )}
              </div>
            </div>
          ))}
        </Modal>
      )}
      {edit && m && (
        <Modal
          w={720}
          title={`${t("Edit memory", "تعديل الذاكرة")} · ${t(m.title[0], m.title[1])}`}
          onClose={() => setEdit(false)}
          footer={
            <>
              <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={() => setEdit(false)} />
              {/* `UC-55.3-02`: a version without a note is a change nobody can account for. */}
              <Btn
                label={`${t("Save as version", "حفظ كإصدار")} ${m.v + 1}`}
                disabled={pending || note.trim() === "" || content.trim() === ""}
                onClick={() =>
                  run(async () => {
                    const outcome = orThrow(await saveMemory({ path: m.id, content, changeNote: note, version: m.version }));
                    setEdit(false);
                    setNote("");
                    // `UC-55.3-03`: what the filter took out is said, not done quietly.
                    return outcome.masked
                      ? t("Saved. Personal data in the content was masked.", "تم الحفظ. أُخفيت البيانات الشخصية في المحتوى.")
                      : t(`Saved as version ${outcome.version}.`, `حُفظ كإصدار ${outcome.version}.`);
                  })
                }
              />
            </>
          }
        >
          <Field label={t("Content", "المحتوى")}>
            <textarea
              className="awp-input awp-mono"
              rows={10}
              style={{ direction: "ltr", textAlign: "left" }}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={t("Owner", "المستخدم")}>
              <input className="awp-input" defaultValue={m.owner[0]} readOnly />
            </Field>
            <Field label={t("Access", "الوصول")}>
              <input className="awp-input" defaultValue={m.access[0]} readOnly />
            </Field>
          </div>
          <Field label={t("Change note", "ملاحظة التغيير")}>
            <input
              className="awp-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("What changed and why", "ما الذي تغير ولماذا")}
            />
          </Field>
        </Modal>
      )}
      {newMemoryModal}
    </div>
  );
}
