/** Skills (S-53). */

export type Skill = {
  n: string;
  /** Where the package came from: Bundled, Uploaded, Git, Registry or Authored. */
  src: string;
  v: string;
  d: string;
  dAr: string;
  tags: string[];
  /** How many agent versions have it attached. */
  agents: number;
  /** The badge: the state of the current version. */
  b: string;
};

/** The security scan of a skill version (data model section 11). */
export type SkillScan = {
  scripts: number;
  networkCalls: number;
  promptInjectionPatterns: number;
  embeddedSecrets: number;
  sandboxOnly: boolean;
  scannedAt: string | null;
};

export type SkillDetail = {
  name: string;
  packageRef: string | null;
  checksum: string | null;
  frontmatterValid: boolean;
  scan: SkillScan | null;
  usedBy: string[];
};
