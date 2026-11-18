import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// First render calls no server action, so each is a stub that would refuse if it ever were.
vi.mock("@/features/budgets/actions", () =>
  Object.fromEntries(
    ["exportBudgets", "saveBudget"].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

// The screen navigates through the App Router, which is not mounted outside Next.js.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/budgets",
}));

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ToastProvider } from "@/components/shared/toast";
import { Budgets } from "@/features/budgets/components/budgets";
import type { Budget, BudgetCounts, BudgetDetail } from "@/features/budgets/types";
import { PreferencesProvider } from "@/lib/preferences";
import type { Agent } from "@/types/directory";

/** What the budgets screen draws on first render, held as a snapshot. */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const agents: Agent[] = [
  { id: "exp", ini: "EX", name: "Expense checker", nameAr: "مدقق المصروفات", unit: "Finance", unitAr: "المالية", ver: "v3", model: "reasoning-default", status: "Idle", profile: "task", runs: 12, cost: 4.5 },
];

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents, people: [me], projects: [], may }}>
        <ToastProvider>{node}</ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-71 and S-72 budgets", () => {
  const budgets: Budget[] = [
    { id: "b1", a: "exp", lim: 500, per: "Monthly", from: "2026-10-01", to: null, soft: 80, hard: "NotifyOnly", spent: 460, status: "Active", forecast: 610.5, cheaperRoute: null, v: 3 },
    { id: "b2", a: "exp", lim: 200, per: "Weekly", from: "2026-11-01", to: "2026-12-31", soft: 75, hard: "SwitchToCheaperAlias", spent: 0, status: "Planned", forecast: 0, cheaperRoute: "small-fast", v: 1 },
  ];
  const details: Record<string, BudgetDetail> = {
    b1: {
      periods: [{ startsAt: "2026-09-01", endsAt: "2026-09-30", limit: 500, spent: 480, runs: 40, event: "WarningSent" }],
      changes: [{ at: "2026-10-01T08:00:00.000Z", by: "p1", descriptionEn: "Raised the limit", descriptionAr: "رفع الحد" }],
    },
  };
  const counts: BudgetCounts = { monthToDate: 460, withBudget: 1, agents: 3, overNinety: 1, endingSoon: 0 };
  const routes = ["reasoning-default", "small-fast"];

  it("draws the list for somebody who may change budgets", () => {
    expect(
      renderScreen(<Budgets budgets={budgets} details={details} counts={counts} routes={routes} />, ["budgets:write"]),
    ).toMatchSnapshot();
  });

  it("draws it read-only without budgets:write", () => {
    expect(renderScreen(<Budgets budgets={budgets} details={details} counts={counts} routes={routes} />)).toMatchSnapshot();
  });
});
