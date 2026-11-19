
import type { Database } from "../client";
import * as s from "../schema";
import { DEFAULT_AGENT, DEFAULT_COLLECTION } from "./data/default-start";
import { FLAG_GROUP, FLAGS } from "./data/platform";
import { ids } from "./ids";

/**
 * What a fresh install starts from, once the organisation and the system agents exist: the
 * organisation's memory scope, one knowledge base the default agent can answer from, the
 * settings and feature flags, and the agent kill switch. Hiwar has no projects or request types.
 *
 * No business history — no request raised, no work item, no room, no budget spent. Those
 * belong to the organisation that starts using the platform, not to its first boot.
 */
export async function seedDefaultStart(db: Database): Promise<void> {
  // `UC-55.3-06`: the organisation's own memory scope, the root every shared memory sits in.
  // Nothing in the console creates it, so an install without it could never hold one (D199).
  await db.insert(s.memoryScope).values([
    { id: ids.memoryScope("org"), kind: "Organisation", refId: ids.organisation, parentScopeId: null, path: "org" },
  ]);
  await db.insert(s.knowledgeCollection).values([
    {
      id: ids.collection(DEFAULT_COLLECTION.code),
      collectionId: DEFAULT_COLLECTION.code,
      nameEn: DEFAULT_COLLECTION.nameEn,
      nameAr: DEFAULT_COLLECTION.nameAr,
      projectId: null,
      visibility: "Internal",
      status: "Ready",
      indexConfigJson: { type: "Vector", syncSchedule: "Manual", maximumSizeMb: 1024 },
      chunkingConfigJson: {
        technique: "Semantic",
        size: 800,
        overlap: 120,
        ocr: true,
        arabicNormalisation: true,
        stripHeadersFooters: true,
        maskPii: true,
      },
      modelsConfigJson: { embeddingRoute: "embedding-default", extractionRoute: "classifier-typed" },
      retrievalConfigJson: { topK: 8, minimumScore: 0.35, rerank: false },
      lastSyncAt: null,
      entityCount: 0,
    },
  ]);

  // The one grant that lets the default agent actually answer from it (`UC-51.2-*`).
  await db.insert(s.agentKnowledgeAccess).values([
    {
      agentVersionId: ids.agentVersion(`${DEFAULT_AGENT.id}:1`),
      collectionId: ids.collection(DEFAULT_COLLECTION.code),
    },
  ]);

  /* ---------------------------------------------------------- settings, all allowed */

  await db.insert(s.settingsVersion).values([
    {
      id: ids.settingsVersion("1"),
      versionNumber: 1,
      settingsJson: {
        organisation: { nameEn: "Hiwar", nameAr: "حوار", timeZone: "Asia/Dubai", languages: ["en", "ar"] },
        branding: { brandColour: "#4338CA", accent: "#14B8A6" },
        defaults: { agentTrust: "Standard", roomTurnTaking: "Autonomous", roomCostCapAed: 0 },
      },
      changedBy: null,
      changedAt: new Date(),
    },
  ]);

  await db.insert(s.featureFlag).values(
    FLAGS.flatMap(([groupEn, , flags]) =>
      flags.map(([nameEn, nameAr, startsOn]) => ({
        id: ids.featureFlag(nameEn),
        key: nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        group: FLAG_GROUP[groupEn],
        nameEn,
        nameAr,
        // Each flag's own default, not a blanket `true`. Most things a fresh install
        // can turn on it starts on — nothing is withheld for a person to go and find —
        // but the list carries a third value precisely for the ones that must not be,
        // and hardcoding `true` here discarded it.
        isEnabled: startsOn,
      })),
    ),
  );

  await db.insert(s.systemState).values([{ id: ids.systemState, agentsPaused: false, pausedBy: null, pausedAt: null }]);
}
