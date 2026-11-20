import type { PlanLimits } from "@/db/schema";

/** The numeric plan limits, in display order, with the label operators see. */
export const LIMIT_LABEL: [keyof Omit<PlanLimits, "models" | "httpTools">, string][] = [
  ["aiConversations", "AI conversations a month"],
  ["agents", "Agents"],
  ["deployments", "Deployments"],
  ["seats", "Seats"],
  ["storageGb", "Knowledge storage (GB)"],
];
