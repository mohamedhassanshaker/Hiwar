"use client";

import { useEffect, useState, useTransition } from "react";

import { LiveRegion } from "@/components/shared/live-region";
import { useModals } from "@/components/shared/modal-host";
import { useDirectory } from "@/components/shared/directory";
import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { CommentButton } from "@/features/comments/components/comment-button";
import { loadSeries } from "@/features/home/actions";
import type { DashboardData, DashboardSeries } from "@/features/home/types";
import { useAwp } from "@/hooks/use-awp";
import { useAgo, useClientNow } from "@/hooks/use-client-now";
import { sesAr, sesTone } from "@/i18n/vocabulary";
import { useGo } from "@/lib/routes";
import { Bars, Bubbles, Line, Sparkline, type Point } from "./dash3/charts";
import { CardButton, CardHead, Money, formatCount } from "./dash3/card-parts";
import { CARD_IDS, readHiddenCards, writeHiddenCards, type CardId } from "./dash3/cards";
import { FilterMenu } from "./dash3/filter-menu";
import { HeroOrb } from "./dash3/hero-orb";
import { useCountUp, useEntered } from "./dash3/motion";
import { boundsOf, bucketLabel, isoDay, rangeLabel, type Range } from "./dash3/range";
import { CardRangeMenu, RangePill } from "./dash3/range-menu";
import { ReportModal } from "./dash3/report-modal";
import { Tour, tourFinished } from "./dash3/tour";

/**
 * S-10, Dashboard 3 (handoff v2 section 2): nine glass cards over one range.
 *
 * Everything on it is read from the database. The header pill sets the range for every
 * card at once; the two charted cards each keep a range of their own, so one chart can be
 * looked at over a different span without disturbing the rest. A range change re-reads
 * only the charts, through a server action, rather than reloading the page.
 *
 * `UC-10.1-05`: the two money cards and their report sections are shown only to someone
 * who may see what the platform spends — the same rule the budgets screen is behind.
 */

/** How long to wait after the first visit before the guide opens itself. */
const TOUR_DELAY_MS = 900;

function greeting(hour: number): [string, string] {
  if (hour < 12) return ["Good morning", "صباح الخير"];
  if (hour < 18) return ["Good afternoon", "مساء الخير"];
  return ["Good evening", "مساء الخير"];
}

/**
 * Renders Dashboard 3: the header with search, card filter, range pill, guide and create actions,
 * then the card grid. The hidden cards and the guide's first opening are read from this browser
 * after hydration; a range change re-reads only the charted cards.
 */
export function Dashboard({ data }: { data: DashboardData }) {
  const { t, lang, aed, aName } = useAwp();
  const { ago } = useAgo();
  const { me } = useDirectory();
  const { open } = useModals();
  const go = useGo();
  const entered = useEntered();
  const locale = lang === "ar" ? "ar-AE" : "en-GB";

  // One range for the whole dashboard, and one per charted card, exactly as v2 draws it.
  const [allRange, setAllRange] = useState<Range>({ id: "7d" });
  const [runsRange, setRunsRange] = useState<Range>({ id: "7d" });
  const [tasksRange, setTasksRange] = useState<Range>({ id: "7d" });
  const [runsSeries, setRunsSeries] = useState<DashboardSeries>(data.series);
  const [tasksSeries, setTasksSeries] = useState<DashboardSeries>(data.series);
  const [, startReading] = useTransition();

  const [hidden, setHidden] = useState<CardId[]>([]);
  const [report, setReport] = useState(false);
  const [tour, setTour] = useState(false);
  const [more, setMore] = useState(false);

  // The hidden-card choice is per browser, so it is read after hydration rather than
  // rendered on the server, where there is no such thing as "this browser". Reading it
  // on the next frame keeps the first render identical to the server's.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHidden(readHiddenCards()));
    return () => cancelAnimationFrame(frame);
  }, []);
  const changeHidden = (next: CardId[]) => {
    setHidden(next);
    writeHiddenCards(next);
  };

  // `UC-10.1` section 4: the guide introduces itself once, then only when asked for.
  useEffect(() => {
    if (tourFinished()) return;
    const timer = setTimeout(() => setTour(true), TOUR_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const read = (range: Range, apply: (series: DashboardSeries) => void) => {
    const bounds = boundsOf(range);
    startReading(async () => {
      try {
        apply(await loadSeries({ from: isoDay(bounds.from), to: isoDay(bounds.to) }));
      } catch {
        // A refused or failed read leaves the chart on the range it was already showing,
        // which is a true picture of a period rather than an empty one of the new period.
      }
    });
  };
  const setRuns = (range: Range) => {
    setRunsRange(range);
    read(range, setRunsSeries);
  };
  const setTasks = (range: Range) => {
    setTasksRange(range);
    read(range, setTasksSeries);
  };
  const setAll = (range: Range) => {
    setAllRange(range);
    setRunsRange(range);
    setTasksRange(range);
    read(range, (series) => {
      setRunsSeries(series);
      setTasksSeries(series);
    });
  };

  const toPoints = (series: DashboardSeries, which: "runs" | "finished"): Point[] =>
    series[which].map((bucket, index, all) => ({
      label: bucketLabel(bucket.start, series.unit, index === all.length - 1, t, locale, series.zone, now),
      value: bucket.count,
    }));

  const runTotal = useCountUp(runsSeries.runs.reduce((sum, bucket) => sum + bucket.count, 0));
  const taskTotal = useCountUp(tasksSeries.finished.reduce((sum, bucket) => sum + bucket.count, 0));
  const finishedNow = tasksSeries.finished.reduce((sum, bucket) => sum + bucket.count, 0);
  const finishedDelta = finishedNow - tasksSeries.finishedPrevious;

  const byStatus = new Map(data.openWorkItems.byStatus.map((row) => [row.status, row.count]));
  const inProgress = byStatus.get("InProgress") ?? 0;
  const blocked = byStatus.get("Blocked") ?? 0;

  const automation = data.automation.at(-1) ?? 0;
  const automationDelta = automation - (data.automation[0] ?? automation);
  const costTotal = data.costSplit.models + data.costSplit.tools;
  const modelShare = costTotal === 0 ? 0 : Math.round((data.costSplit.models / costTotal) * 100);
  const toolShare = costTotal === 0 ? 0 : 100 - modelShare;

  // The browser's own clock, after hydration: the server's is UTC (D160).
  const now = useClientNow();
  const monthDays = now ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : 0;
  const used = data.cost.limit === 0 ? 0 : Math.min(100, Math.round((data.cost.month / data.cost.limit) * 100));
  const elapsed = now ? Math.round((now.getDate() / monthDays) * 100) : 0;
  const monthName = now ? now.toLocaleDateString(locale, { month: "long" }) : "";

  const outcomeTotal = runsSeries.outcomes.completed + runsSeries.outcomes.waiting + runsSeries.outcomes.failed;
  const share = (count: number) => (outcomeTotal === 0 ? 0 : Math.round((count / outcomeTotal) * 100));

  const [helloEn, helloAr] = now ? greeting(now.getHours()) : ["Welcome", "مرحباً"];
  // Someone who may not see what the platform spends sees neither money card, so the
  // filter menu's count and "all cards are hidden" both have to agree with the grid.
  const shown = CARD_IDS.filter((id) => !hidden.includes(id) && (data.showCost || (id !== "cost" && id !== "budget")));
  const hiddenClass = (id: CardId) => (hidden.includes(id) ? " d3-hide" : "");
  // Opens the AI Assistant by clicking its floating button, only when the panel is not open.
  const openAssistant = () => document.querySelector<HTMLButtonElement>(".awp-fab:not(.on)")?.click();

  return (
    <div className="awp-page d3">
      {/* `UC-10.1-02`: a run that finishes or an approval that arrives re-reads this page. */}
      <LiveRegion path="/api/sse/dashboard" />

      <div className="d3-top">
        <div>
          <nav className="d3-crumb" aria-label={t("Breadcrumb", "مسار التنقل")}>
            <Ic n="DashboardDS" s={14} />
            <span>{t("Home", "الرئيسية")}</span>
            <span aria-hidden="true">›</span>
            <span>{t("Dashboard", "لوحة المعلومات")}</span>
          </nav>
          <h1 className="d3-title">
            {t(`${helloEn}, ${me.name.split(" ")[0]}`, `${helloAr}، ${me.nameAr.split(" ")[0]}`)}
          </h1>
        </div>
        <div className="d3-top-a" data-tour="actions">
          <div className="d3-tools">
            <CardButton icon="Search" label={t("Search", "بحث")} onClick={() => open("search")} />
            <FilterMenu hidden={hidden} onChange={changeHidden} />
            <RangePill value={allRange} onChange={setAll} />
            <button
              className="d3-pill d3-guide-btn"
              onClick={() => setTour(true)}
              aria-label={t("Dashboard guide", "دليل اللوحة")}
              title={t("Dashboard guide", "دليل اللوحة")}
            >
              <Ic n="InfoL" s={16} c="currentColor" />
              <span>{t("Dashboard guide", "دليل اللوحة")}</span>
            </button>
          </div>
          <span className="d3-top-sep" aria-hidden="true" />
          <div className="d3-create">
            <button className="d3-pill d3-wide-only" onClick={() => setReport(true)}>
              {t("Create report", "إنشاء تقرير")}
            </button>
            <button className="d3-pill d3-wide-only" onClick={() => open("room")}>
              {t("New Discussion Room", "اجتماع عمل جديد")}
            </button>
            <span className="d3-more">
              <button className="d3-pill" onClick={() => setMore(!more)} aria-expanded={more} aria-haspopup="menu">
                {t("More", "المزيد")}
                <Ic n="ChevronDown" s={14} />
              </button>
              {more && (
                <>
                  <div className="d3-more-scrim" onClick={() => setMore(false)} />
                  <div className="awp-card awp-menu d3-more-menu" role="menu">
                    <button
                      role="menuitem"
                      className="awp-nav-i"
                      onClick={() => {
                        setMore(false);
                        setReport(true);
                      }}
                    >
                      {t("Create report", "إنشاء تقرير")}
                    </button>
                    <button
                      role="menuitem"
                      className="awp-nav-i"
                      onClick={() => {
                        setMore(false);
                        open("room");
                      }}
                    >
                      {t("New Discussion Room", "اجتماع عمل جديد")}
                    </button>
                  </div>
                </>
              )}
            </span>
            <Btn label={t("New Work Item", "بند عمل جديد")} icon="AddCircle" onClick={() => open("workitem")} />
          </div>
        </div>
      </div>

      {/* `UC-10.1-06`: the platform has nothing in it yet, so the zeros need a way on. */}
      {data.empty && (
        <section className="d3-card">
          <p style={{ margin: 0 }} role="status">
            {t("Nothing has been raised on this platform yet.", "لم يُسجَّل أي عمل على هذه المنصة بعد.")}{" "}
            <button className="awp-lnk" onClick={() => open("workitem")}>
              {t("New Work Item", "بند عمل جديد")}
            </button>
          </p>
        </section>
      )}

      <div className="d3-grid">
        <section className={"d3-card d3-hero" + hiddenClass("assistant")} data-orb-host="" data-tour="assistant">
          <CardHead title={t("AI Assistant", "المساعد الذكي")} />
          <HeroOrb />
          <div className="d3-hero-glass">
            <div className="d3-row">
              <b className="d3-hero-k">{t("Automation rate", "نسبة الأتمتة")}</b>
              {automationDelta !== 0 && (
                <span className="d3-chip">
                  {automationDelta > 0 ? "+" : "−"}
                  {Math.abs(automationDelta)} {t("pts", "نقاط")}
                </span>
              )}
            </div>
            <span className="d3-sub">{t("Runs resolved without a human step", "عمليات أُنجزت دون تدخل بشري")}</span>
            <div className="d3-hero-chart">
              <span className="d3-hero-v">
                {automation}
                <small>%</small>
              </span>
              <Sparkline data={data.automation.length > 1 ? data.automation : [automation, automation]} />
            </div>
            <button className="d3-dark-pill" onClick={openAssistant}>
              <span>{t("Ask the assistant", "اسأل المساعد")}</span>
              <span className="d3-dark-pill-ic">
                <Ic n="ArrowUpRightL" s={14} c="currentColor" />
              </span>
            </button>
          </div>
          <p className="d3-foot">
            {t("Ask about agents, costs and work items on any page.", "اسأل عن الوكلاء والتكاليف وبنود العمل في أي صفحة.")}
          </p>
        </section>

        <section className={"d3-card" + hiddenClass("runs")} data-tour="runs">
          <CardHead
            title={t("Agent runs", "عمليات الوكلاء")}
            actions={
              <>
                <CommentButton card="runs" />
                <CardRangeMenu value={runsRange} onChange={setRuns} />
                <CardButton icon="ArrowUpRightL" label={t("Open runs", "فتح العمليات")} onClick={() => go("records", { kind: "runs" })} />
              </>
            }
          />
          <div>
            <span className="d3-sub">{rangeLabel(runsRange, t, locale)}</span>
            <div className="d3-big">
              {formatCount(Math.round(runTotal))}
              <small>{t("runs", "عملية")}</small>
            </div>
          </div>
          <Bars data={toPoints(runsSeries, "runs")} label={t("Agent runs per period", "عمليات الوكلاء لكل فترة")} />
        </section>

        {data.showCost && (
          <section className={"d3-card" + hiddenClass("cost")} data-tour="cost">
            <CardHead title={t("Estimated cost", "التكلفة التقديرية")} />
            <div>
              <span className="d3-sub">{t("This month (est.)", "هذا الشهر (تقديري)")}</span>
              <Money value={data.cost.month} className="d3-big" />
              <span className="d3-delta">
                <Ic n="ArrowUpRightL" s={12} c="currentColor" />
                {t(`${aed(data.cost.today)} today`, `${aed(data.cost.today)} اليوم`)}
              </span>
            </div>
            <div className="d3-splits">
              {[
                [t("Models", "النماذج"), modelShare] as const,
                [t("Tools & connectors", "الأدوات والتكاملات"), toolShare] as const,
              ].map(([label, value], index) => (
                <div key={label} className="d3-split">
                  <span className="d3-split-k">{label}</span>
                  <span className={"d3-split-bar" + (value < 40 ? " is-out" : "")}>
                    <span style={{ width: entered ? `${value}%` : "0%", transitionDelay: `${200 + index * 120}ms` }}>
                      {value >= 40 && <b>{value}%</b>}
                    </span>
                    {value < 40 && <b>{value}%</b>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.showCost && (
          <section className={"d3-card d3-budget" + hiddenClass("budget")}>
            <button
              className="d3-bridge d3-tipbtn"
              onClick={() => go("budgets")}
              aria-label={t("Open budgets", "فتح الميزانيات")}
              data-tip={t("See all details", "عرض كل التفاصيل")}
            >
              <Ic n="ArrowUpRightL" s={16} c="currentColor" />
            </button>
            <div className="d3-row">
              <span className="d3-budget-t">
                {monthName ? t(`${monthName} budget`, `ميزانية ${monthName}`) : t("This month's budget", "ميزانية هذا الشهر")}
              </span>
              <b className="d3-budget-m">{t("Juman", "جمان")}</b>
            </div>
            <div className="d3-budget-mid">
              <Money value={data.cost.limit} className="d3-budget-v" />
              <span className="d3-sub">
                {t(`Estimated spend ${aed(data.cost.month)}`, `الإنفاق التقديري ${aed(data.cost.month)}`)}
              </span>
            </div>
            <div
              className="d3-budget-bar"
              aria-label={t(
                `${used}% used, ${elapsed}% of month elapsed`,
                `استُخدم ${used}٪ ومرّ ${elapsed}٪ من الشهر`,
              )}
            >
              <span className="d3-budget-fill" style={{ width: entered ? `${used}%` : "0%" }} />
              <span className="d3-budget-mark" style={{ insetInlineStart: `${elapsed}%` }} />
            </div>
            <div className="d3-row d3-budget-foot">
              <span>
                {used}% {t("used", "مستخدم")}
              </span>
              <span>{now ? t(`Day ${now.getDate()} / ${monthDays}`, `اليوم ${now.getDate()} / ${monthDays}`) : ""}</span>
            </div>
          </section>
        )}

        <section className={"d3-card d3-wide" + hiddenClass("tasks")} data-tour="work">
          <CardHead
            title={t("Tasks finished", "المهام المنجزة")}
            actions={
              <>
                <CommentButton card="tasks" />
                <CardRangeMenu value={tasksRange} onChange={setTasks} />
                <CardButton icon="ArrowUpRightL" label={t("See all tasks", "عرض كل المهام")} onClick={() => go("tasks")} />
              </>
            }
          />
          <div className="d3-split2">
            <div className="d3-split2-a">
              <span className="d3-sub">
                {t("Tasks your team and agents finished", "المهام التي أنجزها فريقك والوكلاء")} ·{" "}
                {rangeLabel(tasksRange, t, locale)}
              </span>
              <div className="d3-big">
                {formatCount(Math.round(taskTotal))}
                <small>{t("tasks", "مهمة")}</small>
              </div>
              {finishedDelta !== 0 && (
                <span className={"d3-delta" + (finishedDelta > 0 ? " is-up" : "")}>
                  <Ic n="ArrowUpRightL" s={12} c="currentColor" />
                  {finishedDelta > 0
                    ? t(`${finishedDelta} more than the period before`, `${finishedDelta} أكثر من الفترة السابقة`)
                    : t(`${Math.abs(finishedDelta)} fewer than the period before`, `${Math.abs(finishedDelta)} أقل من الفترة السابقة`)}
                </span>
              )}
              <div className="d3-mini-stats">
                <button onClick={() => go("tasks")}>
                  <b>{inProgress}</b>
                  {t("Still being worked on", "لا تزال قيد العمل")}
                </button>
                <button onClick={() => go("tasks")}>
                  <b>{blocked}</b>
                  {t("Stuck, need your help", "متوقفة وتحتاج مساعدتك")}
                </button>
              </div>
            </div>
            <Line data={toPoints(tasksSeries, "finished")} unitLabel={t("finished", "منجزة")} />
          </div>
        </section>

        <section className={"d3-card" + hiddenClass("outcomes")}>
          <CardHead
            title={t("Run outcomes", "نتائج العمليات")}
            actions={<CardButton icon="ArrowUpRightL" label={t("Open runs", "فتح العمليات")} onClick={() => go("records", { kind: "runs" })} />}
          />
          <Bubbles
            items={[
              {
                label: t("Completed", "مكتملة"),
                count: runsSeries.outcomes.completed,
                share: share(runsSeries.outcomes.completed),
                tone: "ok",
                onOpen: () => go("records", { kind: "runs" }),
              },
              {
                label: t("Waiting", "بانتظار"),
                count: runsSeries.outcomes.waiting,
                share: share(runsSeries.outcomes.waiting),
                tone: "warn",
                onOpen: () => go("records", { kind: "approvals" }),
              },
              {
                label: t("Failed", "فشلت"),
                count: runsSeries.outcomes.failed,
                share: share(runsSeries.outcomes.failed),
                tone: "bad",
                onOpen: () => go("records", { kind: "agentsErr" }),
              },
            ]}
          />
        </section>

        <section className={"d3-card d3-half" + hiddenClass("attention")} data-tour="attention">
          <CardHead title={t("Needs attention", "يحتاج إلى متابعة")} actions={<CommentButton card="attention" />} />
          <div className="d3-att">
            {[
              {
                key: t("Agents in error", "وكلاء في حالة خطأ"),
                note: data.agentsInError.label ?? t("None", "لا أحد"),
                value: data.agentsInError.count,
                tone: "bad",
                kind: "agentsErr",
              },
              {
                key: t("Approvals waiting", "اعتمادات بالانتظار"),
                note: t(`${data.approvals.highRisk} high risk`, `${data.approvals.highRisk} عالية المخاطر`),
                value: data.approvals.waiting,
                tone: "warn",
                kind: "approvals",
              },
              {
                key: t("SLA at risk", "اتفاقيات خدمة معرضة للخطر"),
                note: t("Due within 4 hours", "مستحقة خلال 4 ساعات"),
                value: data.slaAtRisk,
                tone: "warn",
                kind: "sla",
              },
            ].map((row, index) => (
              <button
                key={row.kind}
                className={"d3-att-row is-" + row.tone}
                style={{ transitionDelay: `${index * 80}ms` }}
                onClick={() => go("records", { kind: row.kind })}
              >
                <span className="d3-att-dot" aria-hidden="true" />
                <span className="d3-att-b">
                  <b>{row.key}</b>
                  <span>{row.note}</span>
                </span>
                <span className="d3-att-v">{row.value}</span>
                <Ic n={lang === "ar" ? "ArrowLeft01Round" : "ArrowRight01Round"} s={16} />
              </button>
            ))}
          </div>
        </section>

        <section className={"d3-card d3-half" + hiddenClass("live")}>
          <CardHead
            title={t("Runs in progress", "عمليات قيد التشغيل")}
            actions={
              <>
                <CommentButton card="live" />
                <CardButton
                  icon="ArrowUpRightL"
                  label={t("All agent runs", "كل عمليات الوكلاء")}
                  onClick={() => go("agents", { tab: "runs" })}
                />
              </>
            }
          />
          <div className="d3-runs">
            {data.runs.rows.slice(0, 3).map((run, index) => (
              <button key={run.key} className="d3-run" onClick={() => go("run", { agent: run.agent, id: run.key })}>
                <Who id={run.agent} s={32} />
                <span className="d3-run-b">
                  <b>{t(run.goalEn, run.goalAr)}</b>
                  <span>
                    {aName(run.agent)} · <bdi>{run.key}</bdi>
                  </span>
                </span>
                <span className="d3-run-p">
                  <span className="d3-run-s">
                    {run.waiting ? (
                      t("Waiting approval", "بانتظار الاعتماد")
                    ) : (
                      <bdi>
                        {run.step}/{run.steps}
                      </bdi>
                    )}
                  </span>
                  <span className={"d3-run-bar" + (run.waiting ? " is-warn" : "")}>
                    <span
                      style={{
                        width: entered && run.steps > 0 ? `${(run.step / run.steps) * 100}%` : "0%",
                        transitionDelay: `${150 + index * 100}ms`,
                      }}
                    />
                  </span>
                </span>
              </button>
            ))}
            {data.runs.rows.length === 0 && (
              <p className="d3-sub" style={{ margin: 0 }}>
                {t("No runs in progress.", "لا توجد عمليات قيد التشغيل.")}
              </p>
            )}
          </div>
        </section>

        <section className={"d3-card d3-full" + hiddenClass("rooms")} data-tour="rooms">
          <CardHead
            title={t("Discussion room activity", "نشاط اجتماعات العمل")}
            actions={
              <CardButton icon="ArrowUpRightL" label={t("All discussion rooms", "كل اجتماعات العمل")} onClick={() => go("sessions")} />
            }
          />
          <div className="d3-rooms">
            {data.rooms.map((room) => (
              <button key={room.key} className="d3-room" onClick={() => go("session", { key: room.key })}>
                <span className="d3-row">
                  <span className="d3-room-t">{t(room.t, room.tAr)}</span>
                  <Tg tone={sesTone[room.st]} dot label={t(room.st, sesAr[room.st] ?? room.st)} />
                </span>
                <span className="d3-room-m">
                  <bdi className="d3-room-c">{room.p}</bdi>
                  <span>
                    {t(room.type, sesAr[room.type] ?? room.type)} · {t(room.src, sesAr[room.src] ?? room.src)}
                  </span>
                </span>
                <span className="d3-row d3-room-f">
                  <span className="d3-avs">
                    {room.who.map((who) => (
                      <span key={who}>
                        <Who id={who} s={24} />
                      </span>
                    ))}
                  </span>
                  <span className="d3-room-n">
                    <b>{room.msgs}</b> {t("Messages", "الرسائل")}
                    {data.showCost && (
                      <>
                        {" · "}
                        <bdi>{aed(room.cost)}</bdi>
                      </>
                    )}{" "}
                    · {ago(room.lastActivityAt)}
                  </span>
                </span>
              </button>
            ))}
            {data.rooms.length === 0 && (
              <p className="d3-sub" style={{ margin: 0 }}>
                {t("No discussion rooms yet.", "لا توجد اجتماعات عمل بعد.")}
              </p>
            )}
          </div>
        </section>
      </div>

      {shown.length === 0 && (
        <div className="d3-card d3-empty">
          <b>{t("All cards are hidden", "كل البطاقات مخفية")}</b>
          <button className="d3-pill" onClick={() => changeHidden([])}>
            {t("Show all cards", "عرض كل البطاقات")}
          </button>
        </div>
      )}

      {report && <ReportModal onClose={() => setReport(false)} range={allRange} hidden={hidden} />}
      {tour && <Tour onClose={() => setTour(false)} />}
    </div>
  );
}
