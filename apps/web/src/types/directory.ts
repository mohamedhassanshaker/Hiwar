/**
 * The principals and projects every screen names: who did something, who a work item is
 * assigned to, which project it belongs to. `src/features/organisation/service.ts` reads
 * them once per request and hands them to the client through
 * `src/components/shared/directory.tsx`, so no component fetches or hard-codes them.
 */

import type { PermissionCode } from "@/authz/permissions";

export type Agent = {
  id: string;
  ini: string;
  name: string;
  nameAr: string;
  unit: string;
  unitAr: string;
  ver: string;
  model: string;
  status: AgentStatus;
  profile: string;
  runs: number;
  cost: number;
  /** `pa` and `dir`: configured natively rather than by a designer, so the Agents screen
   * does not offer them as something to open and edit like any other agent. Optional
   * because this type also shapes the seed's own sample data, which has no need of it. */
  isSystem?: boolean;
};

export type AgentStatus = "Running" | "Idle" | "Waiting" | "Error" | "Paused" | "Draft";

export type Person = {
  id: string;
  ini: string;
  /** `UC-04.1-03`: the profile photo, as stored in `core.person.photo_ref`. */
  photo: string | null;
  name: string;
  nameAr: string;
  role: string;
  roleAr: string;
  email: string;
};

export type Project = {
  k: string;
  n: string;
  nAr: string;
  st: string;
  own: string;
  unit: string;
  sens: string;
  items: number;
  prog: number;
};

/** What the console shell and every shared primitive need in order to name a principal. */
export type Directory = {
  me: Person;
  agents: Agent[];
  people: Person[];
  projects: Project[];
  /**
   * The permissions `me` holds somewhere, so a screen can leave out a control the person
   * could never use. Hiding only: every action is still checked on the server at its real
   * scope.
   */
  may: PermissionCode[];
};
