import { createHash, randomBytes } from "node:crypto";

import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { AUDIT_AGENT_TEMPLATES, AUDIT_PERSON_TEMPLATES } from "./data/audit";
import { BUDGETS0, MONTHS, histOf } from "./data/budgets";
import { AGENTS, PEOPLE } from "@/db/seed/data/people";
import { CLIENTS, FLAG_GROUP, FLAGS } from "@/db/seed/data/platform";
import { at, monthEnd, monthStart, shift } from "@/db/seed/clock";
import { ids } from "@/db/seed/ids";

/**
 * Data model sections 18 to 20: the agent budgets and their periods, the integration clients
 * and their keys, the settings, branding, feature flags, system state, documentation and log
 * rows, and the audit history. Section 17 (change sets and the blueprint) is left empty: its
 * only writer, the Setup Director, was removed (D371).
 */

const PERIOD: Record<string, string> = { Monthly: "Monthly", Daily: "Daily", Weekly: "Weekly", Quarterly: "Quarterly" };
const ACTION_AT_100: Record<string, string> = {
  "Notify only": "NotifyOnly",
  "Switch to cheaper alias": "SwitchToCheaperAlias",
  "Pause agent": "PauseAgent",
};


/**
 * The documentation pages the Documentation screen lists (S-79).
 *
 * Specification 7.5.8 names five guides, and `UC-79.1-01` is that they are the ones shown.
 * A body may carry `[label](/route)` links to a screen, which `UC-79.1-03` opens — the
 * renderer accepts in-app paths only, so a guide cannot send a reader off the console.
 */
const DOC_PAGES: [slug: string, titleEn: string, titleAr: string, bodyEn: string, bodyAr: string][] = [
  ["getting-started", "Getting started", "البداية", "A new installation starts empty. Set up your [Org units](/org-units) and [People & roles](/people) on their own screens, or ask the AI Assistant on any page to do it with you; a change that needs an approval waits until you give it. After that, your work waits on the [Dashboard](/dashboard) and in your [Inbox](/inbox).", "تبدأ أي منصة جديدة فارغة. أعدّ [الوحدات التنظيمية](/org-units) و[الأشخاص والأدوار](/people) من شاشاتها، أو اطلب من المساعد الذكي في أي صفحة أن يقوم بذلك معك؛ والتغيير الذي يحتاج إلى اعتماد ينتظر حتى تعتمده. بعدها ينتظرك عملك في [لوحة المعلومات](/dashboard) و[صندوق الوارد](/inbox)."],
  ["discussion-rooms", "Discussion rooms", "اجتماعات العمل", "Mention an agent to bring it into the conversation; close a room to write its context handoff. Rooms live in a project, and every reply shows the tools used and its estimated cost. See [Discussion Rooms](/discussion-rooms).", "أشر إلى وكيل لإشراكه في المحادثة؛ وأغلق الاجتماع لكتابة تسليم السياق. تنتمي الاجتماعات إلى مشروع، وكل رد يعرض الأدوات المستخدمة وتكلفته التقديرية. انظر [اجتماعات العمل](/discussion-rooms)."],
  ["requests", "Requests", "الطلبات", "Submit a request through a form or a conversation; the pinned version decides the steps. Follow one in [Requests](/requests), and the work it produces in [Work Items](/work-items).", "قدّم طلباً عبر نموذج أو محادثة؛ الإصدار المثبت يحدد الخطوات. تابع الطلب في [الطلبات](/requests)، والعمل الناتج في [بنود العمل](/work-items)."],
  ["approvals", "Approvals", "الاعتمادات", "Agents never approve their own work. A T2 tool call pauses the run until a human decides, and the decision waits in your [Inbox](/inbox). A rejection needs a reason, and every decision is written to the [Audit log](/audit).", "لا يعتمد الوكلاء عملهم أبداً. استدعاء أداة T2 يوقف العملية حتى يقرر شخص، والقرار ينتظر في [صندوق الوارد](/inbox). الرفض يتطلب سبباً، وكل قرار يُكتب في [التدقيق](/audit)."],
  ["storylines", "Storylines", "النصوص الإرشادية", "A storyline is a versioned script for an embedded deployment, in Free, Guided or Strict mode. In Strict mode the agent performs only the current step and sends exact messages verbatim. Publishing creates a new version, and conversations already running keep theirs. Build one under [Embedded Deployment](/embedded-deployment).", "النص الإرشادي سيناريو بإصدارات لنشر مضمّن، بوضع حر أو موجَّه أو صارم. في الوضع الصارم ينفذ الوكيل الخطوة الحالية فقط ويرسل الرسائل المحددة حرفياً. النشر ينشئ إصداراً جديداً، وتحتفظ المحادثات الجارية بإصدارها. ابنِ واحداً من [النشر المضمّن](/embedded-deployment)."],
  ["connectors-and-tiers", "Connectors & tiers", "الموصّلات والمستويات", "A connector is an MCP server that gives agents controlled access to a system, and it sets the tier of every tool it exposes: T0 runs immediately, T1 asks for confirmation, T2 pauses for a human approval and T3 never runs. Read-only tools default to T0 and destructive ones to T2. A project policy can raise a tier but never lower it. Configure them in [Connectors](/connectors).", "الموصِّل خادم MCP يمنح الوكلاء وصولاً محكوماً إلى نظام، ويحدد مستوى كل أداة يعرضها: T0 ينفذ فوراً، وT1 يطلب تأكيداً، وT2 يتوقف لاعتماد بشري، وT3 لا ينفذ أبداً. الأدوات للقراءة فقط تبدأ بـT0 والمدمّرة بـT2. يمكن لسياسة المشروع رفع المستوى لا خفضه. اضبطها في [التكامل](/connectors)."],
  ["agents", "Agents", "الوكلاء", "An agent is a versioned worker with instructions, skills, tools, memory and a budget. Its trust level and the tool tiers decide what it may do on its own. See [Agents](/agents).", "الوكيل عامل بإصدارات له تعليمات ومهارات وأدوات وذاكرة وميزانية. مستوى الثقة ومستويات الأدوات تحدد ما يمكنه فعله وحده. انظر [الوكلاء](/agents)."],
  ["estimated-costs", "Estimated costs", "التكاليف التقديرية", "Every money value in the console is an estimate from token prices, never an invoice. Limits and the action at 100% are set per agent in [Budgets](/budgets).", "كل قيمة مالية في الوحدة تقديرية مبنية على أسعار الرموز، وليست فاتورة. تُضبط الحدود والإجراء عند ١٠٠٪ لكل وكيل في [تكاليف تشغيل الذكاء الاصطناعي](/budgets)."],
];

/** The service log rows the Logs screen lists (S-74). */
const LOG_ROWS: [minutes: number, level: string, service: string, message: string][] = [
  [2, "Info", "web", "GET /api/health 200 in 14 ms"],
  [5, "Warn", "agent-service", "agentgateway: route reasoning-default fell back to azure/az-uaen"],
  [9, "Error", "agent-worker", "tool cards/block failed: circuit open"],
  [14, "Info", "agent-worker", "run RUN-88231 waiting for approval EXP-4471"],
  [21, "Info", "db-migrate", "migrations complete"],
  [33, "Debug", "connector-runtime", "handshake erp protocol 2025-06-18"],
  [48, "Warn", "sandbox-manager", "warm pool below target: 1 of 2"],
  [75, "Info", "web", "settings version 7 published by Mariam Al Suwaidi"],
];

export async function seedGovernance(db: Database): Promise<void> {
  /* --------------------------------------------------------------------- budgets */

  await db.insert(s.agentBudget).values(
    BUDGETS0.map((budget) => ({
      id: ids.budget(budget.a),
      agentId: ids.agent(budget.a),
      limitAed: budget.lim,
      period: PERIOD[budget.per],
      effectiveFrom: shift(`${budget.from}T00:00:00Z`),
      effectiveTo: budget.to ? shift(`${budget.to}T00:00:00Z`) : null,
      warnAtPct: budget.soft,
      actionAt100: ACTION_AT_100[budget.hard],
      cheaperRouteId: budget.hard === "Switch to cheaper alias" ? ids.route("small-fast") : null,
    })),
  );

  await db.insert(s.budgetPeriod).values(
    BUDGETS0.flatMap((budget) =>
      histOf(budget).map((entry, index) => ({
        id: ids.budgetPeriod(`${budget.a}:${entry.m[0]}`),
        budgetId: ids.budget(budget.a),
        periodStart: monthStart(5 - index),
        periodEnd: monthEnd(5 - index),
        estimatedSpendAed: entry.v,
        // The current period carries the agent's own 30-day run count, which is what the
        // Agents list and the dashboard read back.
        runs: index === 5 ? (AGENTS.find((a) => a.id === budget.a)?.runs ?? 0) : Math.round(entry.v * 4),
      })),
    ),
  );

  await db.insert(s.budgetEvent).values(
    BUDGETS0.filter((budget) => budget.spent / budget.lim > budget.soft / 100).map((budget) => ({
      id: ids.budget(`event:${budget.a}`),
      budgetId: ids.budget(budget.a),
      periodId: ids.budgetPeriod(`${budget.a}:${MONTHS[5][0]}`),
      type: "WarningSent",
      at: at(60 * 6),
      detailEn: `Estimated spend passed ${budget.soft}% of the limit.`,
      detailAr: `تجاوز الإنفاق التقديري ${budget.soft}٪ من الحد.`,
    })),
  );

  await db.insert(s.budgetChange).values([
    {
      id: ids.budget("change:sup"),
      budgetId: ids.budget("sup"),
      at: at(60 * 24 * 9),
      changedBy: ids.person("u1"),
      descriptionEn: "Limit raised from AED 400 to AED 450 for the festive period.",
      descriptionAr: "رُفع الحد من 400 د.إ إلى 450 د.إ لفترة الأعياد.",
    },
  ]);

  /* --------------------------------------------------------- integration clients */

  await db.insert(s.integrationClient).values(
    CLIENTS.map((client) => ({
      id: ids.client(client.id),
      clientId: client.id,
      nameEn: client.n,
      nameAr: client.nAr,
      ownerPersonId: ids.person(client.own),
      status: client.st,
      allAgents: client.agents.length === 0,
    })),
  );

  await db.insert(s.clientKey).values(
    CLIENTS.flatMap((client) =>
      Array.from({ length: client.keys }, (_unused, index) => {
        const secret = randomBytes(24).toString("base64url");
        return {
          id: ids.clientKey(`${client.id}:${index}`),
          clientId: ids.client(client.id),
          name: index === 0 ? "Primary" : "Rotation",
          prefix: `awp_${client.id.replace("cli_", "")}_${index}`,
          secretHash: createHash("sha256").update(secret).digest(),
          expiresAt: index === 1 ? new Date("2026-09-30T00:00:00Z") : null,
          lastUsedAt: at(Number(client.last.replace(/[^0-9]/g, "")) * (client.last.endsWith("d") ? 1440 : client.last.endsWith("h") ? 60 : 1)),
          status: "Active",
        };
      }),
    ),
  );

  await db.insert(s.clientPermission).values(
    CLIENTS.flatMap((client) => client.perms.map((permission) => ({ clientId: ids.client(client.id), permission }))),
  );

  await db.insert(s.clientAgent).values(
    CLIENTS.flatMap((client) => client.agents.map((agent) => ({ clientId: ids.client(client.id), agentId: ids.agent(agent) }))),
  );

  await db.insert(s.clientMcpExposure).values(
    CLIENTS.map((client) => ({
      clientId: ids.client(client.id),
      isEnabled: client.mcp,
      authType: "ApiKey",
      exposedTools: client.mcp ? ["knowledge/search", "work_items/list"] : [],
      lastTestAt: client.mcp ? at(60) : null,
      lastTestResult: client.mcp ? "ok" : null,
    })),
  );

  await db.insert(s.clientAguiExposure).values(
    CLIENTS.map((client) => ({
      clientId: ids.client(client.id),
      isEnabled: client.agui,
      allowedEvents: client.agui ? ["TEXT_MESSAGE_CONTENT", "TOOL_CALL_START", "RUN_FINISHED"] : [],
      allowedOrigins: client.agui ? ["https://tahseel.ae"] : [],
    })),
  );

  /* -------------------------------------------- settings, flags, docs and the log */

  await db.insert(s.settingsVersion).values([
    {
      id: ids.settingsVersion("7"),
      versionNumber: 7,
      settingsJson: {
        organisation: { nameEn: "Tahseel", nameAr: "تحصيل", timeZone: "Asia/Dubai", languages: ["en", "ar"] },
        branding: { brandColour: "#0F6E5C", accent: "#1C8F79" },
        defaults: { agentTrust: "Standard", roomTurnTaking: "Autonomous", roomCostCapAed: 25 },
      },
      changedBy: ids.person("u1"),
      changedAt: at(75),
    },
  ]);

  // `contentRef` is what the shell puts straight into an `<img src>` (`saveBrandingAsset`'s
  // own parameter is named `dataUrl`): a path like `branding/logo-light.svg` is not an
  // embeddable image anywhere, and renders as nothing. These are real `data:` URLs — two
  // small SVGs (no pixel size to validate) and one genuine 64×64 PNG, since the favicon's
  // rule accepts only PNG at that exact size.
  await db.insert(s.brandingAsset).values([
    {
      id: ids.settingsVersion("logo-light"),
      kind: "LogoLight",
      contentRef:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCAyNDAgODAiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIGZpbGw9IiNmZmZmZmYiLz48dGV4dCB4PSIxNiIgeT0iNTAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjI4IiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjMEY2RTVDIj5UYWhzZWVsPC90ZXh0Pjwvc3ZnPg==",
      uploadedBy: ids.person("u1"),
    },
    {
      id: ids.settingsVersion("logo-dark"),
      kind: "LogoDark",
      contentRef:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCAyNDAgODAiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIGZpbGw9IiMwYjEyMjAiLz48dGV4dCB4PSIxNiIgeT0iNTAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjI4IiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjZmZmZmZmIj5UYWhzZWVsPC90ZXh0Pjwvc3ZnPg==",
      uploadedBy: ids.person("u1"),
    },
    {
      id: ids.settingsVersion("favicon"),
      kind: "Favicon",
      contentRef:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwNfAZiawfw5D+HEIgwW4zdrn64YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsArkTkKY2JJC2AAAAAElFTkSuQmCC",
      uploadedBy: ids.person("u1"),
    },
  ]);

  await db.insert(s.featureFlag).values(
    FLAGS.flatMap(([groupEn, , flags]) =>
      flags.map(([nameEn, nameAr, enabled]) => ({
        id: ids.featureFlag(nameEn),
        key: nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        group: FLAG_GROUP[groupEn],
        nameEn,
        nameAr,
        isEnabled: enabled,
      })),
    ),
  );

  await db.insert(s.systemState).values([{ id: ids.systemState, agentsPaused: false, pausedBy: null, pausedAt: null }]);

  await db.insert(s.docPage).values(
    DOC_PAGES.map(([slug, titleEn, titleAr, bodyEn, bodyAr], index) => ({
      id: ids.docPage(slug),
      slug,
      titleEn,
      titleAr,
      bodyEn,
      bodyAr,
      sortOrder: index,
    })),
  );

  await db.insert(s.logEntry).values(
    LOG_ROWS.map(([minutes, level, service, message], index) => ({
      id: ids.logEntry(String(index)),
      at: at(minutes),
      level,
      service,
      message,
      contextJson: { correlation: `c-${index}` },
      correlationId: `c-${index}`,
    })),
  );

  /* ------------------------------------------------------------------------------ audit */
  // `audit.audit_entry` is append-only (section 23 rule 7) and the seed never clears it, so
  // this is the only place the demo organisation's history is written. UC-73.1-02 needs
  // enough of a mix that a query-level filter provably reaches further than a page the
  // browser already holds — see `./data/audit.ts`.
  const PERSON_DAYS = 15;
  const personEntries = Array.from({ length: PERSON_DAYS * 3 }, (_unused, index) => {
    const template = AUDIT_PERSON_TEMPLATES[index % AUDIT_PERSON_TEMPLATES.length];
    const day = Math.floor(index / 3);
    const slot = index % 3;
    const person = PEOPLE.find((candidate) => candidate.id === template[0])!;
    return {
      id: ids.auditEntry(`person:${index}`),
      at: at(day * 24 * 60 + slot * 8 * 60 + 15),
      actorType: "Person" as const,
      actorId: ids.person(template[0]),
      actorLabel: person.name,
      action: template[1],
      objectType: template[2],
      objectLabel: template[3],
    };
  });

  const AGENT_DAYS = 20;
  const agentEntries = Array.from({ length: AGENT_DAYS }, (_unused, index) => {
    const template = AUDIT_AGENT_TEMPLATES[index % AUDIT_AGENT_TEMPLATES.length];
    const agent = AGENTS.find((candidate) => candidate.id === template[0])!;
    return {
      id: ids.auditEntry(`agent:${index}`),
      at: at(index * 24 * 60 + 190),
      actorType: "Agent" as const,
      actorId: ids.agent(template[0]),
      actorLabel: agent.name,
      action: template[1],
      objectType: template[2],
      objectLabel: template[3],
    };
  });

  // `audit` is never truncated — the guard trigger refuses even that — so a second seed run
  // in the same process computes the same `(id, at)` pairs from the same clock and would
  // collide on the append-only table's primary key. Skipping the conflict is what makes the
  // seed idempotent here; a reseed run on a later real day naturally adds another day's worth
  // of history, which is the same append-only growth real usage would produce.
  await db
    .insert(s.auditEntry)
    .values([...personEntries, ...agentEntries].map((entry) => ({ ...entry, outcome: "Allowed" as const })))
    .onConflictDoNothing();
}
