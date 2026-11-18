/**
 * The sections a dashboard report can carry (handoff v2 section 3).
 *
 * The same nine ids the cards use. They live here rather than in the components, because
 * the schema validates against them on the server and a feature module may not import a
 * component.
 */
export const CARD_IDS = [
  "assistant",
  "runs",
  "cost",
  "budget",
  "tasks",
  "outcomes",
  "attention",
  "live",
  "rooms",
] as const;

export type CardId = (typeof CARD_IDS)[number];
