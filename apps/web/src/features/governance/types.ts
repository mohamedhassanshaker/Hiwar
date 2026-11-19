/** What the System screen (Govern > System) shows. */

/** One dependency the System screen shows, as `/api/health` reports it. */
export type ServiceHealth = {
  name: string;
  version: string | null;
  status: string;
  /** Why the probe failed. `UC-78.1-04` shows it beside the error state. */
  detail?: string;
};

export type SystemState = {
  agentsPaused: boolean;
  pausedAt: string | null;
  activeRuns: number;
  queueDepth: number;
  /** Widget conversations in every organization that are not closed. */
  openConversations: number;
  services: ServiceHealth[];
  /** When the probes ran, shown so a reader knows how old "Error" is (`UC-78.1-04`). */
  checkedAt: string;
};

