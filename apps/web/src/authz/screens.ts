import type { ScreenId } from "@/lib/routes";
import type { PermissionCode } from "./permissions";

/**
 * Requirement 27 and `COM-07`: which permission a screen needs, declared once.
 *
 * The navigation filter reads it to hide what a person may not reach, and every screen's
 * feature service asks `requirePermission()` for the same code before it reads anything,
 * so a direct URL is refused and audited even though the navigation item is gone. A screen
 * mapped to `null` is open to anyone who is signed in.
 */
export const SCREEN_PERMISSION: Record<ScreenId, PermissionCode | null> = {
  dashboard: null,
  profile: null,
  inbox: "inbox:read",
  people: "organisation:read",
  audit: "audit:read",
  agents: "agents:read",
  run: "agents:read",
  runs: "agents:read",
  skills: "skills:read",
  connectors: "connectors:read",
  memory: "memory:read",
  knowledge: "knowledge:read",
  models: "models:read",
  channels: "channels:read",
  deployments: "channels:read",
  conversations: "conversations:read",
  conversation: "conversations:read",
  budgets: "budgets:read",
  integrations: "integrations:read",
  system: "system:read",
  logs: "system:read",
};
