/** The org chart node (S-40). */

export type OrgNode = { id: string; sub: [string, string]; unit: string; parent: string | null };

/** A row of the Org units table (S-42). */
export type OrgUnitRow = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isRoot: boolean;
  parentId: string | null;
  /** The lead's person id, or "" when the unit has none: a lead is optional. */
  lead: string;
  /** The version last read, which an edit sends back as `expectedVersion`. */
  version: number;
  people: number;
  agents: number;
  projects: number;
};

/** One thing that happened to an org unit, as the audit log recorded it (S-42). */
export type OrgUnitEvent = {
  at: string;
  action: string;
  actorLabel: string;
};

/** A row of the Roles tab (S-41). */
export type RoleRow = {
  code: string;
  nameEn: string;
  nameAr: string;
  members: number;
  organisationWide: boolean;
};

/**
 * A row of the People tab (S-41): everyone, whatever their status, with the role and scope
 * they hold. Wider than the directory's `Person`, which names only active people.
 */
export type PersonRow = {
  id: string;
  email: string;
  name: string;
  nameAr: string;
  ini: string;
  photo: string | null;
  jobTitle: string;
  jobTitleAr: string;
  unit: string;
  unitId: string | null;
  signInMethod: string;
  status: string;
  roleCode: string;
  roleNameEn: string;
  roleNameAr: string;
  scopeType: "Organisation" | "OrgUnit" | "Project";
  scopeId: string | null;
};
