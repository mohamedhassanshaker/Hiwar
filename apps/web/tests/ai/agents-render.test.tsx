import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ToastProvider } from "@/components/shared/toast";
import { Agents } from "@/features/agents/components/agents";
import { RunViewer } from "@/features/agents/components/run-viewer";
import type { AgentDetail, Run, RunDetail } from "@/features/agents/types";
import { PreferencesProvider } from "@/lib/preferences";
import type { Agent } from "@/types/directory";

/**
 * S-50, S-51 and S-52 on first render, held as snapshots: the agent list, one agent's
 * overview, and the run viewer. The query string is what the screens read to decide which
 * agent and tab are open, so it is set per case.
 */

let query = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(query),
  usePathname: () => "/agents",
}));

// Called over the network once a person acts; first render calls none of them.
vi.mock("@/features/agents/actions", () =>
  Object.fromEntries(
    [
      "activateVersion",
      "cancelRun",
      "createAgent",
      "deleteAgent",
      "publishVersion",
      "replayRun",
      "resetBuiltinToDefaults",
      "saveDraft",
      "setKnowledgeAccess",
      "setMemoryAccess",
      "setPlatformTool",
      "setRunBudget",
      "setSkill",
      "setToolMode",
      "setTrust",
      "testAgent",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };

const agent: Agent = {
  id: "exp",
  ini: "ER",
  name: "Expense Reviewer",
  nameAr: "مراجع المصروفات",
  unit: "Finance",
  unitAr: "المالية",
  ver: "v3",
  model: "reasoning-default",
  status: "Idle",
  profile: "task",
  runs: 12,
  cost: 4.5,
};

const run: Run = {
  id: "RUN-1042",
  st: "Succeeded",
  waitingOn: null,
  roomKey: null,
  workItemKey: "WI-7",
  goal: "Review claim EXP-1042",
  goalAr: "مراجعة المطالبة EXP-1042",
  at: "2026-10-01T08:00:00.000Z",
  durationMs: 42_000,
  cost: 0.35,
  by: "WI-7",
  agent: "exp",
  endedAt: "2026-10-01T08:00:42.000Z",
  contextType: "WorkItem",
  contextKey: "WI-7",
  parentRunKey: null,
};

const detail: AgentDetail = {
  code: "exp",
  lastFailure: null,
  profile: "task",
  model: "reasoning-default",
  fallbackModel: null,
  reportsTo: null,
  trust: "Standard",
  versionLock: 3,
  memoryEnabled: true,
  budgetSoft: null,
  budgetHard: null,
  instructions: "Review expense claims against the policy.",
  draft: null,
  skills: [{ id: "s1", name: "claims-triage", enabled: true, notApplied: null, missingConnectors: [] }],
  tools: [{ id: "t1", ref: "erp/claims.read", tier: "T0", mode: "Auto" }],
  skillShelf: [],
  toolShelf: [],
  knowledge: [{ id: "k1", name: "Expense policy", status: "Ready", granted: true }],
  memory: [{ id: "m1", kind: "Agent", name: "Expense Reviewer memory", granted: true, writable: false }],
  versions: [{ v: "v3", publishedAt: "2026-09-30T10:00:00.000Z", by: "Quality Analyst", evalScore: 0.92, isActive: true }],
  stats: { runs: 12, successRatePct: 91, cost: 4.5, evalScore: 0.92 },
};

function renderScreen(node: ReactNode, may: PermissionCode[]): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [agent], people: [me], projects: [], may }}>
        <ToastProvider>{node}</ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

const units = [{ id: "u1", nameEn: "Finance", nameAr: "المالية" }];

describe("S-50 and S-51 the agents", () => {
  it("lists the agents", () => {
    query = "";
    const html = renderScreen(
      <Agents details={{ exp: detail }} units={units} routes={["reasoning-default"]} toolConfiguration={null} runCount={1} />,
      ["agents:read", "agents:write"],
    );
    expect(html).toMatchSnapshot();
  });

  it("opens one agent on its overview", () => {
    query = "agent=exp";
    const html = renderScreen(
      <Agents details={{ exp: detail }} units={units} routes={["reasoning-default"]} toolConfiguration={null} runCount={1} />,
      ["agents:read", "agents:write", "agents:publish"],
    );
    expect(html).toMatchSnapshot();
  });

  it("shows the agent's runs tab", () => {
    query = "agent=exp&tab=runs";
    const html = renderScreen(
      <Agents
        details={{ exp: detail }}
        units={units}
        routes={["reasoning-default"]}
        toolConfiguration={null}
        runCount={1}
        runs={{ rows: [run], page: { page: 1, total: 1, size: 50 }, filters: { status: "all", period: 0, q: "" } }}
      />,
      ["agents:read"],
    );
    expect(html).toMatchSnapshot();
  });
});

describe("S-51 each tab of one agent", () => {
  it.each(["instr", "skills", "tools", "grant", "knowledge", "memory", "versions"])("shows the %s tab", (tab) => {
    query = `agent=exp&tab=${tab}`;
    const html = renderScreen(
      <Agents details={{ exp: detail }} units={units} routes={["reasoning-default"]} toolConfiguration={null} runCount={1} />,
      ["agents:read", "agents:write", "agents:publish", "agents:configure"],
    );
    expect(html).toMatchSnapshot();
  });
});

describe("S-51 a pinned skill a run leaves out", () => {
  it.each([
    ["unpublished", "this version is not published"],
    ["unscanned", "it has not passed a security scan"],
    ["scanFailed", "its security scan found a credential or prompt-injection text"],
  ] as const)("says a %s skill is not applied to runs", (notApplied, why) => {
    query = "agent=exp&tab=skills";
    const withSkill = { ...detail, skills: [{ ...detail.skills[0], name: "uploaded-policy", notApplied }] };
    const html = renderScreen(
      <Agents details={{ exp: withSkill }} units={units} routes={["reasoning-default"]} toolConfiguration={null} />,
      ["agents:read"],
    );
    expect(html).toContain(`Not applied to runs: ${why}`);
  });
});

describe("S-52 the run viewer", () => {
  const runDetail: RunDetail = {
    run,
    runId: "0190f1a2-0000-7000-8000-000000000001",
    steps: [
      { seq: 1, k: "Start", t: "Started", d: "The run started.", ms: 10, cost: 0, hooks: [], status: "Succeeded" },
      { seq: 2, k: "Model", t: "Planned the review", d: "Read the claim.", ms: 1200, cost: 0.2, hooks: ["pii"], status: "Succeeded" },
      { seq: 3, k: "Tool", t: "erp/claims.read", d: "Read EXP-1042.", ms: 300, cost: 0.15, hooks: [], status: "Succeeded" },
    ],
    context: [{ en: "Instructions", ar: "التعليمات", share: 1, colour: "var(--chart-1)" }],
    tokensIn: 1800,
    tokensOut: 420,
    cacheHitPct: 35,
    toolCallCount: 1,
    waitingSeconds: 0,
    budgetSoft: null,
    budgetHard: null,
    approvalsWaiting: 0,
    traceId: "trace-1",
    replayOfRunKey: null,
  };

  it("shows a finished run step by step", () => {
    query = "";
    const html = renderScreen(<RunViewer detail={runDetail} phoenixOrigin="https://phoenix.example.test" />, ["agents:read", "agents:invoke"]);
    expect(html).toMatchSnapshot();
  });

  it("says when a run's tool calls were counted but not recorded step by step", () => {
    query = "";
    // A run that finished before runs kept their timeline (D300): its count, and only its finish.
    const older: RunDetail = {
      ...runDetail,
      steps: [{ seq: 1, k: "Handoff", t: "finish", d: "Succeeded", ms: 0, cost: 0, hooks: [], status: "Succeeded" }],
      toolCallCount: 18,
    };
    const html = renderScreen(<RunViewer detail={older} phoenixOrigin="https://phoenix.example.test" />, ["agents:read"]);
    expect(html).toContain("18 of this run&#x27;s 18 tool calls were not recorded step by step");
    expect(html).not.toContain("This run called no tool.");
  });
});
