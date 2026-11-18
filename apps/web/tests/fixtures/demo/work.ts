import { eq } from "drizzle-orm";

import { buckets, objectStoreConfigured, putObject } from "@/lib/objects";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { AGENTS } from "@/db/seed/data/people";
import { PROJECTS } from "./data/projects";
import { SESSIONS } from "./data/sessions";
import { REQS, REQ_ATTR, REQ_DESC, RTYPES, RT_STEPS } from "./data/requests";
import { TASKS, WI } from "./data/tasks";
import { at, shift, shiftDay } from "@/db/seed/clock";
import { ids } from "@/db/seed/ids";

/**
 * Data model sections 4 to 9: projects and their members, discussion rooms and their
 * messages, request types with their versions and steps, the requests themselves, work
 * items and their activity, scheduled work items, artifacts and project files.
 */

const isAgent = (id: string) => AGENTS.some((a) => a.id === id);
const principal = (id: string) => (isAgent(id) ? ids.agent(id) : ids.person(id));
const principalType = (id: string) => (isAgent(id) ? "Agent" : "Person");

const PROJECT_STATUS: Record<string, string> = { "In Progress": "InProgress", Planned: "Planned", Paused: "Paused", Done: "Done", Backlog: "Backlog", Archived: "Archived" };
const ROOM_TYPE: Record<string, string> = { Review: "Review", Chat: "Chat", "War-room": "WarRoom", Support: "Support", Automation: "Automation" };
const ROOM_SOURCE: Record<string, string> = { Console: "Console", Teams: "Teams", Slack: "Console", Widget: "Widget", Routine: "Routine" };
const REQUEST_STATUS: Record<string, string> = { Triage: "Triage", Submitted: "Submitted", "In review": "InReview", Approved: "Approved", Rejected: "Rejected", Completed: "Completed" };
const REQUEST_CHANNEL: Record<string, string> = { Console: "Console", Teams: "Teams", Email: "Email", Widget: "Widget", WhatsApp: "WhatsApp", Slack: "Api", API: "Api" };

/** The minutes-ago each room last saw activity, from its "2m", "3h", "9d" label. */
function lastSeen(label: string): number {
  const value = Number(label.replace(/[^0-9.]/g, ""));
  if (label.endsWith("m")) return value;
  if (label.endsWith("h")) return value * 60;
  return value * 60 * 24;
}

/** The decomposition each request type uses, from the prototype's `dec` column. */
const DECOMPOSITION: Record<string, string> = { none: "None", template: "Template", agent: "Agent", hybrid: "Hybrid" };

/** The attributes each request type version declares, keyed by the type code. */
const ATTRIBUTE_LABELS: Record<string, [string, string, string]> = {
  amount_aed: ["Amount (AED)", "المبلغ (د.إ)", "Money"],
  expense_date: ["Expense date", "تاريخ المصروف", "Date"],
  category: ["Category", "الفئة", "Enum"],
  cost_center: ["Cost centre", "مركز التكلفة", "Text"],
  card_last4: ["Card last 4", "آخر 4 أرقام", "Text"],
  reason: ["Reason", "السبب", "Enum"],
  delivery_addr: ["Delivery address", "عنوان التوصيل", "LongText"],
  item: ["Item", "الصنف", "Text"],
  quantity: ["Quantity", "الكمية", "Number"],
  budget_line: ["Budget line", "بند الميزانية", "Text"],
  severity: ["Severity", "الخطورة", "Enum"],
  platform: ["Platform", "المنصة", "Text"],
  steps: ["Steps to reproduce", "خطوات الإعادة", "LongText"],
  from: ["From", "من", "Date"],
  to: ["To", "إلى", "Date"],
  leave_type: ["Leave type", "نوع الإجازة", "Enum"],
  vendor: ["Vendor", "المورد", "Text"],
  trade_licence: ["Trade licence", "الرخصة التجارية", "Text"],
};

const ARTIFACTS: [name: string, producer: string, linkedTo: string, size: string, project: string, active: boolean][] = [
  ["per-diem-impact-sep.xlsx", "exp", "SES-1042", "48 KB", "FIN", true],
  ["vendor-comparison-laptops.pdf", "prc", "TSK-2311", "312 KB", "PRC", true],
  ["bug-311-repro.md", "bug", "BUG-311", "6 KB", "IT", true],
  ["reconciliation-2026-09.csv", "rec", "TSK-2301", "1.1 MB", "FIN", true],
  ["q4-te-policy-draft.docx", "u3", "TSK-2318", "88 KB", "FIN", true],
  ["incident-summary-1039.md", "sup", "SES-1039", "9 KB", "IT", false],
];

const FILES: [name: string, uploader: string, size: string, project: string, scope: string, active: boolean][] = [
  ["receipts-EXP-4471.zip", "u5", "2.4 MB", "FIN", "Selected", true],
  ["FIN-POL-007 Travel Policy.pdf", "u3", "640 KB", "FIN", "AllProject", true],
  ["Gulf IT quote.pdf", "u2", "220 KB", "PRC", "AllProject", true],
  ["Emirates ID — A. Karim.jpg", "u2", "310 KB", "CS", "OnlyMe", true],
  ["vendor-list-2026.xlsx", "u2", "54 KB", "PRC", "Selected", false],
];

/** The SES-1042 transcript the prototype shows, as `work.room_message` rows. */
const TRANSCRIPT: { seq: number; sender: string; minutesAgo: number; content: Record<string, unknown> }[] = [
  {
    seq: 1,
    sender: "u1",
    minutesAgo: 93,
    content: {
      kind: "text",
      en: "@Expense Reviewer please check last month's claims against the draft Q4 per-diem limits and tell us how many would fail.",
      ar: "@مراجع المصروفات يرجى مطابقة مطالبات الشهر الماضي مع حدود البدل اليومي المقترحة للربع الرابع وإخبارنا بعدد المطالبات التي ستُرفض.",
    },
  },
  {
    seq: 2,
    sender: "exp",
    minutesAgo: 91,
    content: {
      kind: "text",
      en: "I reviewed 214 claims from September against the draft limits. 19 claims (8.9%) would exceed the new per-diem, mostly hotel nights in Riyadh and London.",
      ar: "راجعت 214 مطالبة من سبتمبر مقابل الحدود المقترحة. ستتجاوز 19 مطالبة (8.9٪) البدل الجديد، ومعظمها ليالي فندقية في الرياض ولندن.",
      artifact: "per-diem-impact-sep.xlsx",
      artifactNoteEn: "Artifact · 214 rows · created by Expense Reviewer",
      artifactNoteAr: "مخرَج · 214 صفاً · أنشأه مراجع المصروفات",
      toolCalls: 3,
      estimatedCostAed: 0.38,
    },
  },
  {
    seq: 3,
    sender: "u3",
    minutesAgo: 85,
    content: {
      kind: "text",
      en: "Thanks. 19 is acceptable. @Expense Reviewer please flag those 19 claims for review under the new limits from 1 October.",
      ar: "شكراً. 19 عدد مقبول. @مراجع المصروفات يرجى وضع تلك المطالبات الـ19 قيد المراجعة وفق الحدود الجديدة من 1 أكتوبر.",
    },
  },
  {
    seq: 4,
    sender: "exp",
    minutesAgo: 84,
    content: {
      kind: "text",
      en: "I prepared the status change for the 19 claims. It needs approval before it is applied.",
      ar: "أعددت تغيير الحالة للمطالبات الـ19. يحتاج إلى اعتماد قبل تطبيقه.",
      approval: "EXP-4480",
      toolCalls: 2,
      estimatedCostAed: 0.61,
    },
  },
];

export async function seedWork(db: Database): Promise<void> {
  await db.insert(s.project).values(
    PROJECTS.map((p) => ({
      id: ids.project(p.k),
      key: p.k,
      nameEn: p.n,
      nameAr: p.nAr,
      descriptionEn: null,
      descriptionAr: null,
      ownerPersonId: ids.person(p.own),
      orgUnitId: ids.orgUnit(p.unit),
      sensitivity: p.sens,
      status: PROJECT_STATUS[p.st],
      requireReviewerNotAuthor: true,
    })),
  );

  await db.insert(s.projectMember).values(
    PROJECTS.flatMap((p) => [
      { projectId: ids.project(p.k), principalType: "Person", principalId: ids.person(p.own), projectRole: "Owner" },
      ...AGENTS.filter((a) => a.unit === p.unit).map((a) => ({
        projectId: ids.project(p.k),
        principalType: "Agent",
        principalId: ids.agent(a.id),
        projectRole: "Agent",
      })),
    ]),
  );

  await db.insert(s.projectApprovalRule).values([
    {
      id: ids.project("rule:FIN"),
      projectId: ids.project("FIN"),
      actionOrToolRef: "erp/purchase_order.submit",
      approverType: "Group",
      approverId: ids.group("finance-approvers"),
      minimumTier: "T2",
    },
  ]);

  await db.insert(s.projectAllowedAgent).values([
    { projectId: ids.project("FIN"), agentId: ids.agent("exp") },
    { projectId: ids.project("FIN"), agentId: ids.agent("rec") },
    { projectId: ids.project("PRC"), agentId: ids.agent("prc") },
  ]);

  await db.insert(s.projectAllowedConnector).values([
    { projectId: ids.project("FIN"), connectorId: ids.connector("erp") },
    { projectId: ids.project("FIN"), connectorId: ids.connector("m365") },
    { projectId: ids.project("FIN"), connectorId: ids.connector("knowledge") },
    { projectId: ids.project("PRC"), connectorId: ids.connector("erp") },
  ]);

  await db.insert(s.decision).values([
    {
      id: ids.project("decision:FIN:1"),
      projectId: ids.project("FIN"),
      titleEn: "Accepted 19 failing claims as the impact of the Q4 per-diem",
      titleAr: "قبول 19 مطالبة متجاوزة أثراً للبدل اليومي للربع الرابع",
      decidedBy: ids.person("u3"),
      decidedAt: at(60 * 24),
      sourceType: "Room",
      sourceId: ids.room("SES-1042"),
    },
    {
      id: ids.project("decision:FIN:2"),
      projectId: ids.project("FIN"),
      titleEn: "Returned EXP-4402: missing receipt",
      titleAr: "إرجاع EXP-4402: إيصال مفقود",
      decidedBy: ids.person("u3"),
      decidedAt: at(60 * 24 * 3),
      sourceType: "Approval",
      sourceId: ids.approval("EXP-4471"),
    },
  ]);

  /* ------------------------------------------------------------- discussion rooms */

  await db.insert(s.discussionRoom).values(
    SESSIONS.map((room) => ({
      id: ids.room(room.key),
      key: room.key,
      projectId: ids.project(room.p),
      titleEn: room.t,
      titleAr: room.tAr,
      type: ROOM_TYPE[room.type],
      source: ROOM_SOURCE[room.src],
      status: room.st,
      turnTaking: "Autonomous",
      agentHopLimit: 6,
      costCapAed: 25,
      lastActivityAt: at(lastSeen(room.last)),
    })),
  );

  await db.insert(s.roomParticipant).values(
    SESSIONS.flatMap((room) =>
      room.who.map((who, index) => ({
        roomId: ids.room(room.key),
        principalType: principalType(who),
        principalId: principal(who),
        roomRole: isAgent(who)
          ? room.who.filter(isAgent)[0] === who
            ? "LeadAgent"
            : "MemberAgent"
          : room.who.filter((id) => !isAgent(id))[0] === who
            ? "Owner"
            : "Member",
        joinedAt: at(lastSeen(room.last) + 120 + index),
      })),
    ),
  );

  // Every room carries its message count; only SES-1042 carries the transcript the
  // prototype draws, the rest carry an opening message so the count has a first row.
  await db.insert(s.roomMessage).values([
    ...TRANSCRIPT.map((message) => ({
      id: ids.roomMessage(`SES-1042:${message.seq}`),
      roomId: ids.room("SES-1042"),
      seq: message.seq,
      senderType: principalType(message.sender),
      senderId: principal(message.sender),
      contentJson: message.content,
      createdAt: at(message.minutesAgo),
    })),
    ...SESSIONS.filter((room) => room.key !== "SES-1042").map((room) => ({
      id: ids.roomMessage(`${room.key}:1`),
      roomId: ids.room(room.key),
      seq: 1,
      senderType: principalType(room.who[0]),
      senderId: principal(room.who[0]),
      contentJson: { kind: "text", en: room.t, ar: room.tAr },
      createdAt: at(lastSeen(room.last) + 60),
    })),
  ]);

  await db.insert(s.contextHandoff).values([
    {
      id: ids.room("handoff:SES-1042"),
      ownerType: "Room",
      ownerId: ids.room("SES-1042"),
      goal: "Adopt Q4 per-diem limits from 1 October.",
      decisions: "19 failing claims accepted as impact (Fatima).",
      openQuestions: "Do retroactive claims use old limits?",
      nextStep: "Approve EXP-4480, then notify staff.",
    },
  ]);

  /* ------------------------------------------------------ request types and requests */

  await db.insert(s.requestType).values(
    RTYPES.map((type) => ({
      id: ids.requestType(type.c),
      code: type.c,
      nameEn: type.n,
      nameAr: type.nAr,
      categoryEn: type.cat,
      categoryAr: type.cat,
    })),
  );

  await db.insert(s.requestTypeVersion).values(
    RTYPES.map((type) => ({
      id: ids.requestTypeVersion(type.c),
      requestTypeId: ids.requestType(type.c),
      versionNumber: Number(type.v.replace(/^v/, "")),
      status: type.st,
      defaultProjectId: null,
      decomposition: DECOMPOSITION[type.dec],
      slaValue: Number(type.sla.replace(/[^0-9]/g, "")),
      slaUnit: type.sla.includes("hour") ? "Hours" : "BusinessDays",
      intakeChannels: type.ch.split(", ").map((channel) => REQUEST_CHANNEL[channel] ?? "Console"),
      entryModes: type.dec === "none" ? ["TemplateForm"] : ["TemplateForm", "AgenticInteractive"],
      publishedAt: type.st === "Published" ? shift("2026-09-01T06:00:00Z") : null,
      publishedBy: type.st === "Published" ? ids.person("u1") : null,
    })),
  );

  for (const type of RTYPES.filter((t) => t.st === "Published")) {
    await db
      .update(s.requestType)
      .set({ currentPublishedVersionId: ids.requestTypeVersion(type.c) })
      .where(eq(s.requestType.id, ids.requestType(type.c)));
  }

  await db.insert(s.attributeDefinition).values(
    Object.entries(REQ_ATTR).flatMap(([code, attributes]) =>
      attributes.map(([key], index) => {
        const [labelEn, labelAr, dataType] = ATTRIBUTE_LABELS[key];
        return {
          id: ids.attributeDefinition(`${code}:${key}`),
          requestTypeVersionId: ids.requestTypeVersion(code),
          key,
          labelEn,
          labelAr,
          dataType,
          required: index < 2,
          enumValues: dataType === "Enum" ? enumValuesFor(key) : null,
          validationJson: dataType === "Money" ? { minimum: 0 } : null,
          sortOrder: index,
        };
      }),
    ),
  );

  // The Expense Claim transition steps the Request type detail draws.
  await db.insert(s.transitionStep).values(
    RT_STEPS.map((step, index) => ({
      id: ids.transitionStep(`EXP:${step.n}`),
      requestTypeVersionId: ids.requestTypeVersion("EXP"),
      sortOrder: index,
      nameEn: step.n,
      nameAr: step.nAr,
      slaValue: step.out.length ? 8 : null,
      slaUnit: step.out.length ? "Hours" : null,
      isTerminal: step.out.length === 0,
    })),
  );

  await db.insert(s.stepAudience).values(
    RT_STEPS.flatMap((step) =>
      step.aud.map((audience, index) => ({
        id: ids.stepAudience(`EXP:${step.n}:${index}`),
        stepId: ids.transitionStep(`EXP:${step.n}`),
        principalType: audience[0].includes("(agent)") ? "Agent" : audience[0].includes("Approvers") ? "Group" : "Role",
        principalId: audience[0].includes("(agent)")
          ? ids.agent(audience[0].startsWith("Expense") ? "exp" : "rec")
          : audience[0].includes("Approvers")
            ? ids.group("finance-approvers")
            : audience[0].startsWith("Work Lead")
              ? ids.role("WorkLead")
              : ids.role("Member"),
        access: "CanAct",
        sequence: audience[0].includes("sequential") ? index + 1 : null,
      })),
    ),
  );

  await db.insert(s.routingRule).values(
    RT_STEPS.flatMap((step) =>
      step.out.map((out, index) => ({
        id: ids.routingRule(`EXP:${step.n}:${index}`),
        fromStepId: ids.transitionStep(`EXP:${step.n}`),
        sortOrder: index,
        kind: out[0].includes("<") || out[0].includes(">") ? "Condition" : "Action",
        expression: out[0].includes("<") || out[0].includes(">") ? out[0] : null,
        actionName: out[0].includes("<") || out[0].includes(">") ? null : out[0],
        toStepId: ids.transitionStep(`EXP:${out[2]}`),
      })),
    ),
  );

  await db.insert(s.request).values(
    REQS.map((request) => {
      const description = REQ_DESC[request.k];
      return {
        id: ids.request(request.k),
        key: request.k,
        projectId: ids.project(request.p),
        requestTypeVersionId: ids.requestTypeVersion(request.ty),
        titleEn: request.t,
        titleAr: request.tAr,
        descriptionEn: description ? description[0] : null,
        descriptionAr: description ? description[1] : null,
        requesterType: request.by === "ext" ? "ExternalContact" : "Person",
        requesterId: request.by === "ext" ? ids.externalContact("a-karim") : ids.person(request.by),
        channel: REQUEST_CHANNEL[request.ch],
        entryMode: request.mode === "agent" ? "Agentic" : "Form",
        currentStepId: request.ty === "EXP" ? ids.transitionStep(`EXP:${request.st === "Completed" ? "Closed" : "Agent review"}`) : null,
        status: REQUEST_STATUS[request.st],
        submittedAt: shift(`${request.d}T06:00:00Z`),
        dueAt: shift(`${request.d}T14:00:00Z`),
        closedAt: ["Completed", "Rejected"].includes(request.st) ? shift(`${request.d}T12:00:00Z`) : null,
        attributes: Object.fromEntries(REQ_ATTR[request.ty].map(([key, value]) => [key, value])),
        originRoomId: null,
      };
    }),
  );

  await db.insert(s.requestEvent).values(
    REQS.map((request) => ({
      id: ids.requestEvent(`${request.k}:1`),
      requestId: ids.request(request.k),
      at: shift(`${request.d}T06:00:00Z`),
      actorType: request.by === "ext" ? "ExternalContact" : "Person",
      actorId: request.by === "ext" ? ids.externalContact("a-karim") : ids.person(request.by),
      eventType: "Submitted",
      detailEn: "Request submitted.",
      detailAr: "تم تقديم الطلب.",
    })),
  );

  /* --------------------------------------------------------------------- work items */

  await db.insert(s.workItem).values(
    TASKS.map((task) => {
      const detail = WI[task.k];
      const origin = detail.org;
      return {
        id: ids.workItem(task.k),
        key: task.k,
        projectId: ids.project(task.p),
        type: task.type === "Subtask" ? "SubItem" : task.type,
        titleEn: task.t,
        titleAr: task.tAr,
        status: task.st === "Todo" ? "ToDo" : task.st,
        priority: task.pri,
        assigneeType: task.who ? principalType(task.who) : "None",
        assigneeId: task.who ? principal(task.who) : null,
        reviewerType: "Person",
        reviewerId: ids.person(detail.rev),
        dueAt: task.due === "—" ? null : shift(`2026-10-${task.due.split(" ")[0].padStart(2, "0")}T14:00:00Z`),
        parentWorkItemId: detail.parent ? ids.workItem(detail.parent) : null,
        requestId: origin && origin[1] === "requests" ? ids.request(origin[0]) : null,
        requestTypeVersionId: null,
        attributes: Object.fromEntries(detail.at),
        originType: origin ? (origin[1] === "requests" ? "Request" : origin[1] === "routines" ? "Schedule" : "Room") : "Manual",
        originId: origin ? (origin[1] === "requests" ? ids.request(origin[0]) : origin[1] === "routines" ? ids.schedule(origin[0]) : ids.room(origin[0])) : null,
        blockedReasonEn: task.st === "Blocked" ? "Run RUN-88210 failed: cards/block circuit open." : null,
        blockedReasonAr: task.st === "Blocked" ? "فشلت RUN-88210: دائرة cards/block مفتوحة." : null,
        completedAt: task.st === "Done" ? at(60 * 24 * 4) : null,
      };
    }),
  );

  await db.insert(s.workItemActivity).values(
    TASKS.flatMap((task) =>
      WI[task.k].act.map((entry, index) => ({
        id: ids.workItemActivity(`${task.k}:${index}`),
        workItemId: ids.workItem(task.k),
        at: at(60 * (index + 1)),
        actorType: principalType(entry[0]),
        actorId: principal(entry[0]),
        eventType: entry[1].startsWith("created") ? "Created" : entry[1].startsWith("moved") || entry[1].startsWith("marked") ? "StatusChanged" : entry[1].startsWith("attached") ? "Commented" : "Commented",
        detailEn: entry[1],
        detailAr: entry[2],
      })),
    ),
  );

  await db.insert(s.savedView).values([
    {
      id: ids.workItem("view:mine"),
      personId: ids.person("u1"),
      name: "My open work",
      screen: "WorkItems",
      filterJson: { assignee: "me", status: ["ToDo", "InProgress", "InReview"] },
    },
  ]);

  /* -------------------------------------------------------- scheduled work items */

  await db.insert(s.scheduledWorkItem).values([
    {
      id: ids.schedule("SCH-01"),
      projectId: ids.project("FIN"),
      titleEn: "Nightly bank reconciliation",
      titleAr: "التسوية البنكية الليلية",
      createsWorkItemType: "Task",
      audienceType: "Agent",
      audienceId: ids.agent("rec"),
      repeats: "Daily",
      startDate: shiftDay("2026-03-01"),
      timeOfDay: "03:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: false,
      instructionsEn: "Import the statement, match transactions and raise an exception for every unmatched line.",
      instructionsAr: "استيراد الكشف ومطابقة المعاملات ورفع استثناء لكل سطر غير مطابق.",
      status: "Active",
      temporalScheduleId: "schedule-SCH-01",
      nextRunAt: shift("2026-10-10T23:00:00Z"),
    },
    {
      id: ids.schedule("SCH-02"),
      projectId: ids.project("CS"),
      titleEn: "Weekly knowledge refresh",
      titleAr: "تحديث المعرفة الأسبوعي",
      createsWorkItemType: "Task",
      audienceType: "Agent",
      audienceId: ids.agent("kb"),
      repeats: "Weekly",
      startDate: shiftDay("2026-05-01"),
      timeOfDay: "06:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: true,
      instructionsEn: "Re-ingest the service catalogue and report what changed.",
      instructionsAr: "إعادة استيعاب دليل الخدمات والإبلاغ عما تغير.",
      status: "Active",
      temporalScheduleId: "schedule-SCH-02",
      nextRunAt: shift("2026-10-12T02:00:00Z"),
    },
    {
      id: ids.schedule("SCH-03"),
      projectId: ids.project("FIN"),
      titleEn: "Weekly cost report",
      titleAr: "تقرير التكلفة الأسبوعي",
      createsWorkItemType: "Task",
      audienceType: "Agent",
      audienceId: ids.agent("rec"),
      repeats: "Weekly",
      startDate: shiftDay("2026-01-05"),
      timeOfDay: "08:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: true,
      instructionsEn: "Draft the weekly estimated-cost report for the platform team.",
      instructionsAr: "إعداد مسودة تقرير التكلفة التقديرية الأسبوعي لفريق المنصة.",
      status: "Active",
      temporalScheduleId: "schedule-SCH-03",
      nextRunAt: shift("2026-10-13T04:00:00Z"),
    },
    {
      id: ids.schedule("SCH-04"),
      projectId: ids.project("IT"),
      titleEn: "Stale work triage",
      titleAr: "فرز العمل المتوقف",
      createsWorkItemType: "Task",
      audienceType: "Agent",
      audienceId: ids.agent("def"),
      repeats: "Daily",
      startDate: shiftDay("2026-02-01"),
      timeOfDay: "09:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: true,
      instructionsEn: "Find work items with no activity for five days and propose an owner.",
      instructionsAr: "إيجاد بنود العمل بلا نشاط منذ خمسة أيام واقتراح مسؤول لها.",
      status: "Active",
      temporalScheduleId: "schedule-SCH-04",
      nextRunAt: shift("2026-10-10T05:00:00Z"),
    },
    {
      id: ids.schedule("SCH-05"),
      projectId: ids.project("PRC"),
      titleEn: "Monthly vendor review",
      titleAr: "مراجعة الموردين الشهرية",
      createsWorkItemType: "Task",
      audienceType: "Person",
      audienceId: ids.person("u2"),
      repeats: "Monthly",
      startDate: shiftDay("2026-01-01"),
      timeOfDay: "10:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: false,
      instructionsEn: "Review every active vendor against its last three deliveries.",
      instructionsAr: "مراجعة كل مورد نشط مقابل آخر ثلاث عمليات تسليم.",
      status: "Active",
      temporalScheduleId: "schedule-SCH-05",
      nextRunAt: shift("2026-11-01T06:00:00Z"),
    },
    {
      id: ids.schedule("SCH-06"),
      projectId: ids.project("IT"),
      titleEn: "Quarterly access review",
      titleAr: "مراجعة الصلاحيات الفصلية",
      createsWorkItemType: "Task",
      audienceType: "Person",
      audienceId: ids.person("u1"),
      repeats: "Monthly",
      startDate: shiftDay("2026-01-01"),
      timeOfDay: "09:00",
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: false,
      instructionsEn: "Review every role assignment and remove what is no longer needed.",
      instructionsAr: "مراجعة كل إسناد دور وإزالة ما لم يعد لازماً.",
      status: "Active",
      temporalScheduleId: "schedule-SCH-06",
      nextRunAt: shift("2027-01-01T05:00:00Z"),
    },
    {
      id: ids.schedule("SCH-07"),
      projectId: ids.project("IT"),
      titleEn: "On new BUG with severity S1",
      titleAr: "عند خطأ جديد بخطورة S1",
      createsWorkItemType: "Bug",
      audienceType: "Agent",
      audienceId: ids.agent("bug"),
      repeats: "OnEvent",
      eventName: "work_item.created",
      startDate: shiftDay("2026-04-01"),
      timeOfDay: null,
      timeZone: "Asia/Dubai",
      skipHolidaysAndWeekends: false,
      instructionsEn: "Triage the defect and reproduce it in the sandbox.",
      instructionsAr: "فرز الخطأ وإعادة إنتاجه في البيئة المعزولة.",
      status: "Active",
      temporalScheduleId: "schedule-SCH-07",
      nextRunAt: null,
    },
  ]);

  await db.insert(s.scheduleRun).values([
    {
      id: ids.schedule("run:SCH-01:1"),
      scheduledWorkItemId: ids.schedule("SCH-01"),
      firedAt: at(60 * 31),
      outcome: "Created",
      createdWorkItemId: ids.workItem("TSK-2301"),
      createdRequestId: null,
      error: null,
    },
    { id: ids.schedule("run:SCH-02:1"), scheduledWorkItemId: ids.schedule("SCH-02"), firedAt: at(60 * 48), outcome: "Created", createdWorkItemId: null, createdRequestId: null, error: null },
    { id: ids.schedule("run:SCH-03:1"), scheduledWorkItemId: ids.schedule("SCH-03"), firedAt: at(60 * 72), outcome: "Created", createdWorkItemId: null, createdRequestId: null, error: null },
    { id: ids.schedule("run:SCH-04:1"), scheduledWorkItemId: ids.schedule("SCH-04"), firedAt: at(60 * 25), outcome: "Created", createdWorkItemId: null, createdRequestId: null, error: null },
    { id: ids.schedule("run:SCH-05:1"), scheduledWorkItemId: ids.schedule("SCH-05"), firedAt: at(60 * 24 * 9), outcome: "Created", createdWorkItemId: null, createdRequestId: null, error: null },
    { id: ids.schedule("run:SCH-06:1"), scheduledWorkItemId: ids.schedule("SCH-06"), firedAt: at(60 * 24 * 40), outcome: "Skipped", createdWorkItemId: null, createdRequestId: null, error: null },
    { id: ids.schedule("run:SCH-07:1"), scheduledWorkItemId: ids.schedule("SCH-07"), firedAt: at(60 * 20), outcome: "Failed", createdWorkItemId: null, createdRequestId: null, error: "sandbox pool exhausted" },
  ]);

  /* ------------------------------------------------------------ artifacts and files */

  await db.insert(s.artifact).values(
    ARTIFACTS.map(([name, producer, linkedTo, , project, active]) => ({
      id: ids.artifact(name),
      projectId: ids.project(project),
      nameEn: name,
      nameAr: name,
      producedByType: isAgent(producer) ? "Agent" : "Person",
      producedById: principal(producer),
      runId: null,
      linkedToType: linkedTo.startsWith("SES") ? "Room" : "WorkItem",
      linkedToId: linkedTo.startsWith("SES") ? ids.room(linkedTo) : ids.workItem(linkedTo),
      status: active ? "Active" : "Inactive",
    })),
  );

  await db.insert(s.artifactVersion).values(
    ARTIFACTS.map(([name]) => ({
      id: ids.artifactVersion(name),
      artifactId: ids.artifact(name),
      versionNumber: 1,
      contentRef: `artifacts/${name}`,
      // The size of what the seed actually writes, so the screen and the download agree.
      size: placeholderFor(name).bytes.byteLength,
      mimeType: mimeOf(name),
    })),
  );

  for (const [name] of ARTIFACTS) {
    await db.update(s.artifact).set({ currentVersionId: ids.artifactVersion(name) }).where(eq(s.artifact.id, ids.artifact(name)));
  }

  await db.insert(s.projectFile).values(
    FILES.map(([name, uploader, , project, scope, active]) => ({
      id: ids.projectFile(name),
      projectId: ids.project(project),
      name,
      contentRef: `files/${name}`,
      size: placeholderFor(name).bytes.byteLength,
      mimeType: mimeOf(name),
      uploadedBy: ids.person(uploader),
      scopeOfUse: scope,
      status: active ? "Active" : "Inactive",
      linkedToType: null,
      linkedToId: null,
    })),
  );

  // The references above point at objects, so the demo organisation's files open and
  // download rather than 404. Without a store configured there is nothing to put them in,
  // which is the `make dev-local` case.
  if (objectStoreConfigured()) {
    await Promise.all(
      [
        ...ARTIFACTS.map(([name]) => [buckets.artifacts, name] as const),
        ...FILES.map(([name]) => [buckets.files, name] as const),
      ].map(async ([bucket, name]) => {
        const content = placeholderFor(name);
        await putObject(bucket, name, content.bytes, content.mimeType);
      }),
    );
  }

  await db.insert(s.fileAccessGrant).values([
    { fileId: ids.projectFile("receipts-EXP-4471.zip"), principalType: "Person", principalId: ids.person("u3") },
    { fileId: ids.projectFile("receipts-EXP-4471.zip"), principalType: "Agent", principalId: ids.agent("exp") },
    { fileId: ids.projectFile("vendor-list-2026.xlsx"), principalType: "Person", principalId: ids.person("u2") },
  ]);

  await db.insert(s.attachment).values([
    {
      id: ids.attachment("REQ-9012:1"),
      ownerType: "Request",
      ownerId: ids.request("REQ-9012"),
      fileName: "taxi-receipt-3-oct.jpg",
      contentRef: "attachments/REQ-9012/taxi-receipt-3-oct.jpg",
      size: placeholderFor("taxi-receipt-3-oct.jpg").bytes.byteLength,
      mimeType: "image/jpeg",
      uploadedBy: ids.person("u5"),
    },
  ]);

  if (objectStoreConfigured()) {
    const receipt = placeholderFor("taxi-receipt-3-oct.jpg");
    await putObject(buckets.attachments, "REQ-9012/taxi-receipt-3-oct.jpg", receipt.bytes, receipt.mimeType);
  }

  await db.insert(s.roomWorkItemLink).values([
    { roomId: ids.room("SES-1042"), workItemId: ids.workItem("TSK-2318"), messageId: ids.roomMessage("SES-1042:4") },
  ]);
}

function enumValuesFor(key: string): { value: string; labelEn: string; labelAr: string }[] {
  const values: Record<string, [string, string, string][]> = {
    category: [["ground_transport", "Ground transport", "النقل البري"], ["hotel", "Hotel", "فندق"], ["meals", "Meals", "وجبات"], ["flights", "Flights", "رحلات جوية"], ["other", "Other", "أخرى"]],
    reason: [["lost", "Lost", "مفقود"], ["stolen", "Stolen", "مسروق"], ["damaged", "Damaged", "تالف"]],
    severity: [["S1", "S1", "S1"], ["S2", "S2", "S2"], ["S3", "S3", "S3"], ["S4", "S4", "S4"]],
    leave_type: [["annual", "Annual", "سنوية"], ["sick", "Sick", "مرضية"], ["unpaid", "Unpaid", "بدون راتب"]],
  };
  return (values[key] ?? []).map(([value, labelEn, labelAr]) => ({ value, labelEn, labelAr }));
}

/**
 * The bytes behind one seeded file or artifact.
 *
 * The demo organisation's files are opened and downloaded like any other, so each one needs
 * something real at its reference. Text formats carry a line about the file; the office
 * formats are zip containers, so an empty archive is a valid file of that shape; the picture
 * is the smallest JPEG a browser will draw. Nothing here pretends to be a spreadsheet.
 */
function placeholderFor(name: string): { bytes: Uint8Array; mimeType: string } {
  const mimeType = mimeOf(name);
  const utf8 = (body: string) => ({ bytes: new TextEncoder().encode(body), mimeType });

  if (mimeType === "text/markdown") {
    return utf8(`# ${name}\n\nSample content for the Tahseel AWP demo organisation.\n`);
  }
  if (mimeType === "text/csv") {
    return utf8(`file,note\n"${name}","Sample content for the Tahseel AWP demo organisation."\n`);
  }
  if (mimeType === "application/pdf") return utf8(onePagePdf(name));
  if (mimeType === "image/jpeg") return { bytes: SMALLEST_JPEG, mimeType };
  // `.zip`, and the office formats, which are zip containers: an empty archive opens.
  return { bytes: EMPTY_ZIP, mimeType };
}

/** A one-page PDF carrying the file's name, written out rather than pulled in. */
function onePagePdf(name: string): string {
  const page = `BT /F1 12 Tf 60 720 Td (${name.replace(/[()\\]/g, " ")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${page.length} >>\nstream\n${page}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const offsets: number[] = [];
  let body = "%PDF-1.4\n";
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return body;
}

/** An archive with nothing in it: 22 bytes, and every unzip tool accepts it. */
const EMPTY_ZIP = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]);

/** One grey pixel, which is enough for a preview to draw something. */
const SMALLEST_JPEG = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
      "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
      "AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  ),
);

function mimeOf(name: string): string {
  const extension = name.split(".").pop() ?? "";
  const types: Record<string, string> = {
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf",
    csv: "text/csv",
    md: "text/markdown",
    zip: "application/zip",
    jpg: "image/jpeg",
  };
  return types[extension] ?? "application/octet-stream";
}
