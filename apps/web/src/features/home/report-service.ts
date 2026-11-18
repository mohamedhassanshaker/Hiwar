import { loadRecentRooms } from "@/features/rooms/service";
import { audit } from "@/lib/audit";
import { can, requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { ReportInput } from "./schema";
import { dayBounds, readSeries } from "./series-service";

/**
 * A dashboard report (handoff v2 section 3).
 *
 * Built here, not in the browser: the rows have to be the read model's own, the sections
 * that show money have to obey the same rule the cards do, and taking data out of the
 * platform is audited. The browser decides nothing but the name, the period, which
 * sections and which of the two formats.
 */
export type ReportRow = [section: string, item: string, value: string];

export type Report = { title: string; period: string; rows: ReportRow[] };

/** Every label the report writes, so the file reads in the language it was asked for. */
const SAY: Record<string, [string, string]> = {
  assistant: ["AI Assistant", "المساعد الذكي"],
  runs: ["Agent runs", "عمليات الوكلاء"],
  cost: ["Estimated cost", "التكلفة التقديرية"],
  budget: ["Month budget", "ميزانية الشهر"],
  tasks: ["Tasks finished", "المهام المنجزة"],
  outcomes: ["Run outcomes", "نتائج العمليات"],
  attention: ["Needs attention", "يحتاج إلى متابعة"],
  live: ["Runs in progress", "عمليات قيد التشغيل"],
  rooms: ["Discussion room activity", "نشاط اجتماعات العمل"],
  automationRate: ["Automation rate", "نسبة الأتمتة"],
  totalRuns: ["Total runs", "إجمالي العمليات"],
  thisMonth: ["This month (AED)", "هذا الشهر (د.إ)"],
  models: ["Models", "النماذج"],
  tools: ["Tools and connectors", "الأدوات والتكاملات"],
  budgetAmount: ["Budget (AED)", "الميزانية (د.إ)"],
  estimatedSpend: ["Estimated spend (AED)", "الإنفاق التقديري (د.إ)"],
  used: ["Used", "مستخدم"],
  totalTasks: ["Total tasks", "إجمالي المهام"],
  previousPeriod: ["Previous period", "الفترة السابقة"],
  inProgress: ["Still being worked on", "لا تزال قيد العمل"],
  blocked: ["Stuck, need your help", "متوقفة وتحتاج مساعدتك"],
  completed: ["Completed", "مكتملة"],
  waiting: ["Waiting", "بانتظار"],
  failed: ["Failed", "فشلت"],
  agentsInError: ["Agents in error", "وكلاء في حالة خطأ"],
  approvalsWaiting: ["Approvals waiting", "اعتمادات بالانتظار"],
  slaAtRisk: ["SLA at risk", "اتفاقيات خدمة معرضة للخطر"],
  highRisk: ["high risk", "عالية المخاطر"],
  dueWithin: ["due within 4 hours", "مستحقة خلال 4 ساعات"],
  none: ["none", "لا أحد"],
  waitingApproval: ["Waiting approval", "بانتظار الاعتماد"],
  messages: ["messages", "رسالة"],
  section: ["Section", "القسم"],
  item: ["Item", "البند"],
  value: ["Value", "القيمة"],
  generated: ["Generated", "أُنشئ"],
};

/**
 * A dashboard report (handoff v2 section 3).
 *
 * Built here, not in the browser: the rows have to be the read model's own, the sections
 * that show money have to obey the same rule the cards do, and taking data out of the
 * platform is audited. The browser decides nothing but the name, the period, which
 * sections and which of the two formats.
 */
export async function buildReport(input: ReportInput): Promise<Report> {
  const session = await requirePermission("exports:create");
  const say = (key: string) => SAY[key][input.lang === "ar" ? 1 : 0];
  const zone = await repository.organisationZone();
  const { from, to } = dayBounds(input.from, input.to, zone);
  // A bucket is named by its day in the organisation's zone, the day it was counted on (D365).
  const dayOf = (start: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(start));
  // `UC-10.1-05`: the two money sections are the budget screen's figures, so a person who
  // may not see them on the dashboard may not take them out of it either.
  const showCost = await can("budgets:read");
  const wanted = new Set(input.sections.filter((id) => showCost || (id !== "cost" && id !== "budget")));

  const [series, automation, costSplit, openWorkItems, approvals, agentsInError, cost, sla, runs, rooms] = await Promise.all([
    readSeries(from, to, zone),
    wanted.has("assistant") ? repository.automationRate("week", to) : Promise.resolve([]),
    wanted.has("cost") ? repository.monthCostSplit() : Promise.resolve({ models: 0, tools: 0 }),
    repository.openWorkItems(),
    repository.approvalsWaiting(),
    repository.agentsInError(),
    repository.estimatedCost(),
    repository.countSlaAtRisk(),
    repository.runsInProgress(3),
    loadRecentRooms(4),
  ]);

  const rows: ReportRow[] = [];
  const add = (section: string, entries: [string, string | number][]) => {
    for (const [item, value] of entries) rows.push([section, item, String(value)]);
  };
  const money = (value: number) => value.toFixed(2);
  const percent = (part: number, whole: number) => (whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`);
  const byStatus = new Map(openWorkItems.byStatus.map((row) => [row.status, row.count]));

  if (wanted.has("assistant")) {
    add(say("assistant"), [[say("automationRate"), `${automation.at(-1) ?? 0}%`]]);
  }
  if (wanted.has("runs")) {
    add(say("runs"), [
      [say("totalRuns"), series.runs.reduce((sum, point) => sum + point.count, 0)],
      ...series.runs.map((point) => [dayOf(point.start), point.count] as [string, number]),
    ]);
  }
  if (wanted.has("cost")) {
    const total = costSplit.models + costSplit.tools;
    add(say("cost"), [
      [say("thisMonth"), money(cost.month)],
      [say("models"), percent(costSplit.models, total)],
      [say("tools"), percent(costSplit.tools, total)],
    ]);
  }
  if (wanted.has("budget")) {
    add(say("budget"), [
      [say("budgetAmount"), money(cost.limit)],
      [say("estimatedSpend"), money(cost.month)],
      [say("used"), percent(cost.month, cost.limit)],
    ]);
  }
  if (wanted.has("tasks")) {
    add(say("tasks"), [
      [say("totalTasks"), series.finished.reduce((sum, point) => sum + point.count, 0)],
      ...series.finished.map((point) => [dayOf(point.start), point.count] as [string, number]),
      [say("previousPeriod"), series.finishedPrevious],
      [say("inProgress"), byStatus.get("InProgress") ?? 0],
      [say("blocked"), byStatus.get("Blocked") ?? 0],
    ]);
  }
  if (wanted.has("outcomes")) {
    const { completed, waiting, failed } = series.outcomes;
    const total = completed + waiting + failed;
    add(say("outcomes"), [
      [say("completed"), `${completed} (${percent(completed, total)})`],
      [say("waiting"), `${waiting} (${percent(waiting, total)})`],
      [say("failed"), `${failed} (${percent(failed, total)})`],
    ]);
  }
  if (wanted.has("attention")) {
    add(say("attention"), [
      [`${say("agentsInError")} · ${agentsInError.label ?? say("none")}`, agentsInError.count],
      [`${say("approvalsWaiting")} · ${approvals.highRisk} ${say("highRisk")}`, approvals.waiting],
      [`${say("slaAtRisk")} · ${say("dueWithin")}`, sla],
    ]);
  }
  if (wanted.has("live")) {
    add(
      say("live"),
      runs.rows.slice(0, 3).map((row) => [
        `${row.key} · ${input.lang === "ar" ? row.goalAr : row.goalEn}`,
        row.waiting ? say("waitingApproval") : `${row.step}/${row.steps}`,
      ]),
    );
  }
  if (wanted.has("rooms")) {
    add(
      say("rooms"),
      rooms.map((room) => [input.lang === "ar" ? room.tAr : room.t, `${room.msgs} ${say("messages")}`]),
    );
  }

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "exports:create",
    objectType: "DashboardReport",
    objectLabel: input.name,
    detail: { sections: [...wanted], format: input.format, from: input.from, to: input.to, rows: rows.length },
  });

  return { title: input.name, period: `${input.from} – ${input.to}`, rows };
}

/** The column headings and the "Generated" line, in the language the report was asked in. */
export function reportWords(lang: "en" | "ar") {
  const say = (key: string) => SAY[key][lang === "ar" ? 1 : 0];
  return { section: say("section"), item: say("item"), value: say("value"), generated: say("generated") };
}
