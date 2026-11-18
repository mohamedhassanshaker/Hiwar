/**
 * The feature-flag keys the platform reads (S-75, data model section 20).
 *
 * Only the keys: reading one is a database read, and the layering here keeps those in a
 * feature's repository. `features/governance` owns the rows and exposes `isFeatureEnabled`;
 * this module exists so the features that *depend* on a flag name it from one place instead
 * of repeating a string the seed derives from a flag's English name.
 */
export const FEATURE_FLAGS = {
  graphRetrieval: "graph-retrieval-graphiti",
  embeddedDeployments: "embedded-deployments",
  pageAssistant: "page-assistant",
  agenticRequestEntry: "agentic-interactive-request-entry",
  piiFilterOnMemoryWrites: "pii-filter-on-memory-writes",
  teamsMirror: "mirror-rooms-to-microsoft-teams",
} as const;

export type FeatureKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];
