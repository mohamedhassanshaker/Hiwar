"use client";

import { type ScreenId } from "@/lib/routes";

/** One opening prompt the panel offers before the first question. */
type Suggestion = { text: string };

/** The four prompts handoff v2 offers on the dashboard, and the general set elsewhere. */
export function suggestionsFor(dashboard: boolean, t: (en: string, ar: string) => string): Suggestion[] {
  if (dashboard) {
    return [
      { text: t("What needs my attention today?", "ما الذي يحتاج انتباهي اليوم؟") },
      { text: t("Are we on track with this month's budget?", "هل نحن ضمن ميزانية هذا الشهر؟") },
      { text: t("Why did the last run fail?", "لماذا فشلت آخر عملية؟") },
      { text: t("Open the blocked work items", "افتح بنود العمل المعطّلة") },
    ];
  }
  return [
    { text: t("Summarise this page", "لخّص هذه الصفحة") },
    { text: t("What needs my attention today?", "ما الذي يحتاج انتباهي اليوم؟") },
  ];
}

/** Where "take me there" goes. Only screens a person can reach are offered. */
export const PLACES: [ScreenId, string, string][] = [
  ["inbox", "Approvals", "الموافقات"],
  ["agents", "Agents", "الوكلاء"],
  ["runs", "Runs", "عمليات التشغيل"],
  ["conversations", "Conversations", "المحادثات"],
  ["budgets", "Budgets", "التكاليف"],
];
