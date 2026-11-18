/**
 * The nine cards of Dashboard 3 (handoff v2 sections 2.2, 2.4 and 3).
 *
 * The ids themselves are `../../report-sections`, because the report schema validates
 * against them on the server; the names and the hidden-card preference are the browser's
 * half of the same list. The filter menu, the report's "Include" checklist and the grid
 * all work from it, so a card cannot be shown on one and missing from another.
 */
import { CARD_IDS, type CardId } from "../../report-sections";

export { CARD_IDS };
export type { CardId };

/** What each card is called, in both languages. */
export const CARD_NAMES: Record<CardId, [string, string]> = {
  assistant: ["AI Assistant", "المساعد الذكي"],
  runs: ["Agent runs", "عمليات الوكلاء"],
  cost: ["Estimated cost", "التكلفة التقديرية"],
  budget: ["Month budget", "ميزانية الشهر"],
  tasks: ["Tasks finished", "المهام المنجزة"],
  outcomes: ["Run outcomes", "نتائج العمليات"],
  attention: ["Needs attention", "يحتاج إلى متابعة"],
  live: ["Runs in progress", "عمليات قيد التشغيل"],
  rooms: ["Discussion room activity", "نشاط اجتماعات العمل"],
};

/**
 * Which cards are hidden, kept per browser.
 *
 * A layout preference, not a setting: it says nothing about the organisation and nobody
 * else is affected by it, so it stays where it was chosen rather than becoming a row in
 * the database that has to be migrated, audited and reasoned about.
 */
export const HIDDEN_CARDS_KEY = "awp.d3.hidden";

/** The hidden card ids stored in this browser, dropping any id that is no longer a card. */
export function readHiddenCards(): CardId[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_CARDS_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((id): id is CardId => CARD_IDS.includes(id as CardId));
  } catch {
    // Unreadable or unparseable storage means no preference, which is every card shown.
    return [];
  }
}

/** Stores the hidden card ids in this browser. */
export function writeHiddenCards(hidden: CardId[]): void {
  try {
    localStorage.setItem(HIDDEN_CARDS_KEY, JSON.stringify(hidden));
  } catch {
    // Storage can be full or blocked; the choice then lasts for this visit only.
  }
}
