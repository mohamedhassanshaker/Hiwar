import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { CTX, RUNS, STEPS } from "./data/runs";
import { INBOX } from "./data/inbox";
import { AGENTS } from "@/db/seed/data/people";
import { at, shift, PROTOTYPE_NOW } from "@/db/seed/clock";
import { ids } from "@/db/seed/ids";

/**
 * Data model section 10, second half: the runs the run viewer replays, their steps, the
 * approvals and questions they raise, and the inbox rows those produce.
 */


const RUN_STATUS: Record<string, string> = {
  Waiting: "Waiting",
  Running: "Running",
  Completed: "Succeeded",
  Failed: "Failed",
  Cancelled: "Cancelled",
  Idle: "Queued",
};

const STEP_TYPE: Record<string, string> = {
  run_start: "Start",
  model: "Model",
  tool: "Tool",
  skill: "Skill",
  verify: "Verify",
  approval: "Approval",
};

/**
 * The prototype's run history names work items from claims that are not part of the demo
 * organisation. Each one is pointed at the seeded work item it belongs with, so every run
 * has a context the run viewer and the dashboard can name.
 */
const CONTEXT_ALIAS: Record<string, string> = {
  "TSK-2316": "TSK-2320",
  "TSK-2313": "TSK-2311",
  "TSK-2298": "TSK-2301",
  "TSK-2295": "TSK-2301",
};

/** The context a run belongs to, from the prototype's `by` column. */
function contextOf(by: string): [type: string, id: string | null] {
  if (by.startsWith("SES")) return ["Room", ids.room(by)];
  if (by.startsWith("SCH")) return ["Console", null];
  return ["WorkItem", ids.workItem(CONTEXT_ALIAS[by] ?? by)];
}

const INBOX_KIND: Record<string, string> = {
  approval: "Approval",
  question: "Question",
  mention: "Mention",
  sla: "SlaWarning",
  review: "Review",
};

/** The five approvals the Inbox and the dashboard drill-down list. */
const APPROVALS: {
  key: string;
  agent: string;
  titleEn: string;
  titleAr: string;
  action: string;
  args: Record<string, unknown>;
  risk: string;
  minutesAgo: number;
  approvers: number;
}[] = [
  {
    key: "PO-7781",
    agent: "prc",
    titleEn: "Send purchase order PO-7781 to Gulf IT",
    titleAr: "إرسال أمر الشراء PO-7781 إلى الخليج للتقنية",
    action: "erp/purchase_order.submit",
    args: { vendor: "Gulf IT LLC", lines: 3, total_aed: 148500.0, cost_center: "IT-OPS" },
    risk: "High",
    minutesAgo: 113,
    approvers: 1,
  },
  {
    key: "EXP-4480",
    agent: "exp",
    titleEn: "Flag 19 September claims for review under the Q4 per-diem",
    titleAr: "وضع 19 مطالبة من سبتمبر قيد المراجعة وفق البدل اليومي للربع الرابع",
    action: "erp/claims.update_status",
    args: { claims: 19, status: "Under review" },
    risk: "Medium",
    minutesAgo: 84,
    // D19: asked for in a room, so the person who addressed the agent decides it alone.
    approvers: 1,
  },
  {
    key: "EXP-4471",
    agent: "exp",
    titleEn: "Update claim status to Returned",
    titleAr: "تحديث حالة المطالبة إلى مُرجعة",
    action: "erp/claims.update_status",
    args: { claim: "EXP-4471", status: "Returned" },
    risk: "Medium",
    minutesAgo: 4,
    approvers: 1,
  },
  {
    key: "MAIL-220",
    agent: "kb",
    titleEn: "Send per-diem notice to all staff",
    titleAr: "إرسال إشعار البدل لكل الموظفين",
    action: "m365/mail.send",
    args: { audience: "All staff", subject: "New per-diem limits" },
    risk: "High",
    minutesAgo: 40,
    approvers: 1,
  },
  {
    key: "CRD-5512",
    agent: "sup",
    titleEn: "Replace card ending 4821",
    titleAr: "استبدال البطاقة المنتهية بـ 4821",
    action: "cards/replace",
    args: { card_last4: "4821", reason: "damaged" },
    risk: "Low",
    minutesAgo: 6,
    approvers: 1,
  },
];

/** The prototype writes inbox times as a clock reading or "Yesterday". */
function minutesAgoOf(time: string): number {
  if (time === "Yesterday") return 60 * 24;
  const [hours, minutes] = time.split(":").map(Number);
  const then = Date.UTC(2026, 9, 9, hours - 4, minutes);
  return Math.max(1, Math.round((PROTOTYPE_NOW - then) / 60_000));
}

const versionNumber = (code: string) => Number(AGENTS.find((a) => a.id === code)!.ver.replace(/^v/, ""));

export async function seedRuns(db: Database): Promise<void> {
  // The run viewer's own agent is the Expense Reviewer; the other agents carry one run
  // each so the Agents list and the dashboard count real rows.
  const expRuns = RUNS.map((r) => ({ ...r, agent: "exp" }));
  const otherRuns = [
    { id: "RUN-88229", st: "Running", goal: "Card replacement conversation", goalAr: "محادثة استبدال بطاقة", at: "2026-10-09 10:39", dur: "—", cost: 0.08, by: "SES-1037", agent: "sup" },
    { id: "RUN-88224", st: "Waiting", goal: "Compare 3 vendor quotes for laptops", goalAr: "مقارنة 3 عروض موردين لأجهزة الحاسوب", at: "2026-10-09 08:52", dur: "—", cost: 0.44, by: "TSK-2311", agent: "prc" },
    { id: "RUN-88215", st: "Running", goal: "Nightly reconciliation retry", goalAr: "إعادة التسوية الليلية", at: "2026-10-09 10:30", dur: "—", cost: 0.12, by: "TSK-2301", agent: "rec" },
    { id: "RUN-88212", st: "Waiting", goal: "Answer staff question on leave", goalAr: "الإجابة عن سؤال موظف حول الإجازة", at: "2026-10-09 10:22", dur: "—", cost: 0.06, by: "SES-1030", agent: "kb" },
    { id: "RUN-88210", st: "Failed", goal: "Triage BUG-311 receipt OCR", goalAr: "فرز BUG-311 للتعرف الضوئي", at: "2026-10-09 10:40", dur: "4.2s", cost: 0.03, by: "BUG-311", agent: "bug" },
    { id: "RUN-88205", st: "Completed", goal: "Check September claims against the Q4 per-diem", goalAr: "مطابقة مطالبات سبتمبر مع البدل اليومي للربع الرابع", at: "2026-10-09 09:21", dur: "22.4s", cost: 0.61, by: "SES-1042", agent: "exp" },
  ];
  const allRuns = [...expRuns, ...otherRuns];

  await db.insert(s.run).values(
    allRuns.map((r) => {
      const [contextType, contextId] = contextOf(r.by);
      const started = shift(`${r.at.replace(" ", "T")}:00Z`);
      const duration = r.dur === "—" ? null : Number(r.dur.replace("s", "")) * 1000;
      return {
        id: ids.run(r.id),
        key: r.id,
        agentId: ids.agent(r.agent),
        agentVersionId: ids.agentVersion(`${r.agent}:${versionNumber(r.agent)}`),
        trigger: contextType === "Room" ? "Mention" : r.by.startsWith("SCH") ? "Schedule" : "Assignment",
        contextType,
        contextId,
        status: RUN_STATUS[r.st],
        startedAt: started,
        endedAt: duration === null ? null : new Date(started.getTime() + duration),
        waitingSeconds: r.st === "Waiting" ? 1800 : 0,
        tokensIn: Math.round(r.cost * 40000),
        tokensOut: Math.round(r.cost * 8000),
        cacheHitPct: 41.5,
        toolCallCount: r.st === "Idle" ? 0 : 3,
        estimatedCostAed: r.cost,
        temporalWorkflowId: `run-${r.id}`,
        traceId: ids.run(r.id),
      };
    }),
  );

  await db.insert(s.runStep).values(
    STEPS.map((step, index) => ({
      id: ids.runStep(`RUN-88231:${index}`),
      runId: ids.run("RUN-88231"),
      seq: index,
      type: STEP_TYPE[step.k],
      name: step.t,
      status: step.live ? "Waiting" : "Succeeded",
      // Specification 5.3: the harness records how it assembled the context on the first
      // step, and the run viewer draws it as context composition.
      result:
        step.k === "run_start"
          ? JSON.stringify({ composition: CTX.map(([en, ar, share]) => ({ en, ar, share })) })
          : step.d,
      hooksApplied: step.k === "model" ? ["pii-mask (pre_model)"] : [],
      estimatedCostAed: step.cost,
      startedAt: at(4 + (STEPS.length - index) * 2),
      endedAt: step.ms === null ? null : new Date(at(4 + (STEPS.length - index) * 2).getTime() + step.ms),
    })),
  );

  // `UC-50.2-05`: the agent the demo leaves in Error has to say why. A status with no
  // reason behind it is what the Agents card shows on hover and what someone opens the run
  // viewer for, so the failed run carries the step that failed and the message it failed
  // with.
  await db.insert(s.runStep).values([
    {
      id: ids.runStep("RUN-88210:0"),
      runId: ids.run("RUN-88210"),
      seq: 0,
      type: "Start",
      name: "Triage BUG-311 receipt OCR",
      status: "Succeeded",
      result: null,
      estimatedCostAed: 0,
    },
    {
      id: ids.runStep("RUN-88210:1"),
      runId: ids.run("RUN-88210"),
      seq: 1,
      type: "Tool",
      name: "sandbox-fs/read_file",
      status: "Failed",
      result: "The sandbox refused the path: receipts/BUG-311.pdf is outside the run's workspace.",
      estimatedCostAed: 0,
    },
  ]);

  // Specification 5.3: the run viewer shows context composition in a fixed order. The
  // shares are written on the run's first step, which is where the harness assembles it.
  await db.insert(s.playgroundTest).values([
    {
      id: ids.run("playground:exp"),
      agentVersionId: ids.agentVersion(`exp:${versionNumber("exp")}`),
      input: "Claim EXP-4466: hotel in Riyadh, 3 nights, AED 3,300.",
      output: `Two nights exceed the per-diem by AED 300 in total. Context composition: ${CTX.map((c) => `${c[0]} ${c[2]}%`).join(", ")}.`,
      durationMs: 9400,
      estimatedCostAed: 0.21,
      runId: ids.run("RUN-88190"),
    },
  ]);

  await db.insert(s.approval).values(
    APPROVALS.map((approval) => ({
      id: ids.approval(approval.key),
      key: approval.key,
      runId: approval.key === "EXP-4471" ? ids.run("RUN-88231") : approval.key === "EXP-4480" ? ids.run("RUN-88205") : null,
      requestedByType: "Agent",
      requestedById: ids.agent(approval.agent),
      workItemId: approval.key === "EXP-4471" ? ids.workItem("TSK-2320") : null,
      requestId: null,
      // D19: in a room, the person who addressed the agent is the one offered the decision.
      createdBy: approval.key === "EXP-4480" ? ids.person("u3") : null,
      action: approval.action,
      argumentsRedacted: approval.args,
      evidence: approval.titleEn,
      risk: approval.risk,
      policy: approval.approvers > 1 ? "Sequential" : "AnyOf",
      // Four hours was the prototype's window, which left a seeded organisation with no
      // approval anybody could decide once the demo was half a day old. `UC-12.1-08` seeds
      // its own expired approval, so this one only has to outlast the demo.
      escalateAfter: at(approval.minutesAgo - 7 * 24 * 60),
      status: "Pending",
    })),
  );

  await db.insert(s.agentQuestion).values([
    {
      id: ids.agentQuestion("Q-1"),
      runId: ids.run("RUN-88231"),
      askedToType: "Person",
      askedToId: ids.person("u1"),
      question: "Is a taxi receipt without VAT number acceptable?",
      answer: null,
      answeredBy: null,
      answeredAt: null,
    },
  ]);

  await db.insert(s.inboxItem).values(
    INBOX.map((item) => ({
      id: ids.inboxItem(String(item.id)),
      personId: ids.person("u1"),
      kind: INBOX_KIND[item.kind],
      sourceType: item.kind === "approval" ? "Approval" : item.kind === "question" ? "AgentQuestion" : item.kind === "sla" ? "WorkItem" : item.kind === "review" ? "WorkItem" : "Room",
      sourceId:
        item.kind === "approval"
          ? ids.approval(item.id === 1 ? "PO-7781" : "EXP-4480")
          : item.kind === "question"
            ? ids.agentQuestion("Q-1")
            : item.kind === "sla"
              ? ids.workItem("BUG-311")
              : item.kind === "review"
                ? ids.workItem("TSK-2311")
                : ids.room("SES-1041"),
      status: "Open",
      // The row appears when the thing that raised it happened, not when the seed ran.
      createdAt: at(minutesAgoOf(item.time)),
    })),
  );
}
