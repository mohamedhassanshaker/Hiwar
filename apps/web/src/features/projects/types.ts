/** Projects and their detail view (S-20, S-21). */

/** What a project contains, which the detail view links to. */
export type ProjectContents = {
  rooms: number;
  workItems: number;
  requests: number;
  schedules: number;
  artifacts: number;
  files: number;
};

export type ProjectMember = { id: string; role: string; isAgent: boolean };

/** One decision recorded against a project (data model section 4). */
export type ProjectDecision = {
  titleEn: string;
  titleAr: string;
  decidedBy: string;
  decidedAt: string;
  /** `UC-21.1-03`: what to open — the approval or the room it came from. */
  sourceType: string;
  /** The key the source screen is addressed by, or null when the source is gone or has no
   * screen (a change set recorded before D371). */
  sourceKey: string | null;
};

export type ProjectDetail = {
  key: string;
  sensitivity: string;
  status: string;
  /** `COM-10`: the version this was read at, which an edit names back. */
  version: number;
  contents: ProjectContents;
  members: ProjectMember[];
  requireReviewerNotAuthor: boolean;
  /** The actions a human must approve inside the project, with the tier each is raised to. */
  approvalRules: { ref: string; minimumTier: string }[];
  /** Agent codes. Empty means every agent the trust level allows. */
  allowedAgents: string[];
  /** Connector codes. Empty means every registered connector. */
  allowedConnectors: string[];
  decisions: ProjectDecision[];
};

/** What S-20 and S-21 are given: the projects, the catalogues their policy picks from. */
export type ProjectsScreen = {
  details: Record<string, ProjectDetail>;
  connectors: { code: string; nameEn: string; nameAr: string }[];
  agents: { code: string; nameEn: string; nameAr: string }[];
  /** `UC-20.2-05` and `UC-21.2-07`: whether this person may create or change a project. */
  mayWrite: boolean;
};
