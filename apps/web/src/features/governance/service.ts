import { audit } from "@/lib/audit";
import type { FeatureKey } from "@/lib/feature-flags";
import { health } from "@/lib/health";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { SystemState } from "./types";

/** The parts of the module's governance the AI capabilities use, on Hiwar. */

export async function isFeatureEnabled(key: FeatureKey): Promise<boolean> {
  return repository.isFeatureEnabled(key);
}

export async function setFeatureFlag(key: string, enabled: boolean): Promise<void> {
  const session = await requirePermission("settings:write");
  await repository.setFeatureFlag(key, enabled, session.personId);
  await audit({ actor: { type: "Person", id: session.personId, label: session.nameEn }, action: "settings:feature_flag", objectType: "FeatureFlag", objectLabel: key, detail: { enabled } });
}

export async function loadSystem(): Promise<SystemState> {
  await requirePermission("system:read");
  const [state, probes] = await Promise.all([repository.readSystemState(), health()]);
  return {
    ...state,
    checkedAt: probes.checkedAt,
    services: probes.dependencies.map((probe) => ({
      name: probe.name,
      version: probe.version,
      status: probe.status === "up" ? "Healthy" : probe.status === "skipped" ? "Disabled" : "Error",
      detail: probe.detail,
    })),
  };
}

export async function pauseAgents(paused: boolean): Promise<void> {
  const session = await requirePermission("system:operate");
  await repository.setAgentsPaused(paused, session.personId);
  await audit({ actor: { type: "Person", id: session.personId, label: session.nameEn }, action: paused ? "system:pause_agents" : "system:resume_agents", objectType: "SystemState" });
}
