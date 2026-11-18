import { eq } from "drizzle-orm";

import type { Database } from "../client";
import * as s from "../schema";
import {
  DEFAULT_AGENT,
  DEFAULT_COLLECTION,
  DEFAULT_PROJECT,
  DEFAULT_REQUEST_TYPES,
} from "./data/default-start";
import { FLAG_GROUP, FLAGS } from "./data/platform";
import { ids } from "./ids";

/**
 * What a fresh install starts from, once the organisation and the system agents exist: one
 * project, the organisation's own request types, one knowledge base the default agent can
 * answer from, and every setting switched on rather than left for someone to discover is off.
 *
 * No business history — no request raised, no work item, no room, no budget spent. Those
 * belong to the organisation that starts using the platform, not to its first boot.
 */
export async function seedDefaultStart(db: Database): Promise<void> {
  await db.insert(s.project).values([
    {
      id: ids.project(DEFAULT_PROJECT.k),
      key: DEFAULT_PROJECT.k,
      nameEn: DEFAULT_PROJECT.n,
      nameAr: DEFAULT_PROJECT.nAr,
      ownerPersonId: ids.person("u1"),
      orgUnitId: ids.orgUnit("Platform"),
      sensitivity: "Internal",
      status: "InProgress",
      requireReviewerNotAuthor: false,
    },
  ]);
  await db.insert(s.projectMember).values([
    { projectId: ids.project(DEFAULT_PROJECT.k), principalType: "Person", principalId: ids.person("u1"), projectRole: "Owner" },
    { projectId: ids.project(DEFAULT_PROJECT.k), principalType: "Agent", principalId: ids.agent(DEFAULT_AGENT.id), projectRole: "Agent" },
  ]);

  /*
   * Every request type gets the same two-step flow: Review, where a work lead decides, then
   * Completed. The minimum a type needs to actually route a request anywhere — a single
   * terminal step has nowhere for an audience to act, which is why it is never the only one.
   */
  await db.insert(s.requestType).values(
    DEFAULT_REQUEST_TYPES.map((type) => ({
      id: ids.requestType(type.c),
      code: type.c,
      nameEn: type.n,
      nameAr: type.nAr,
      categoryEn: type.cat,
      categoryAr: type.cat,
    })),
  );
  await db.insert(s.requestTypeVersion).values(
    DEFAULT_REQUEST_TYPES.map((type) => ({
      id: ids.requestTypeVersion(type.c),
      requestTypeId: ids.requestType(type.c),
      versionNumber: 1,
      status: "Published",
      defaultProjectId: ids.project(DEFAULT_PROJECT.k),
      decomposition: "None",
      slaValue: 2,
      slaUnit: "BusinessDays",
      intakeChannels: ["Console"],
      entryModes: ["TemplateForm"],
      publishedAt: new Date(),
      publishedBy: ids.person("u1"),
    })),
  );
  for (const type of DEFAULT_REQUEST_TYPES) {
    await db
      .update(s.requestType)
      .set({ currentPublishedVersionId: ids.requestTypeVersion(type.c) })
      .where(eq(s.requestType.id, ids.requestType(type.c)));
  }

  await db.insert(s.transitionStep).values(
    DEFAULT_REQUEST_TYPES.flatMap((type) => [
      {
        id: ids.transitionStep(`${type.c}:Review`),
        requestTypeVersionId: ids.requestTypeVersion(type.c),
        sortOrder: 0,
        nameEn: "Review",
        nameAr: "مراجعة",
        slaValue: 2,
        slaUnit: "BusinessDays",
        isTerminal: false,
      },
      {
        id: ids.transitionStep(`${type.c}:Completed`),
        requestTypeVersionId: ids.requestTypeVersion(type.c),
        sortOrder: 1,
        nameEn: "Completed",
        nameAr: "مكتمل",
        slaValue: null,
        slaUnit: null,
        isTerminal: true,
      },
    ]),
  );
  await db.insert(s.stepAudience).values(
    DEFAULT_REQUEST_TYPES.map((type) => ({
      id: ids.stepAudience(`${type.c}:Review:0`),
      stepId: ids.transitionStep(`${type.c}:Review`),
      principalType: "Role",
      principalId: ids.role("WorkLead"),
      access: "CanAct",
      sequence: null,
    })),
  );
  await db.insert(s.routingRule).values(
    DEFAULT_REQUEST_TYPES.map((type) => ({
      id: ids.routingRule(`${type.c}:Review:0`),
      fromStepId: ids.transitionStep(`${type.c}:Review`),
      sortOrder: 0,
      kind: "Action",
      expression: null,
      actionName: "Approve",
      toStepId: ids.transitionStep(`${type.c}:Completed`),
    })),
  );

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
      projectId: ids.project(DEFAULT_PROJECT.k),
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
        organisation: { nameEn: "Tahseel", nameAr: "تحصيل", timeZone: "Asia/Dubai", languages: ["en", "ar"] },
        branding: { brandColour: "#0F6E5C", accent: "#1C8F79" },
        defaults: { agentTrust: "Standard", roomTurnTaking: "Autonomous", roomCostCapAed: 0 },
      },
      changedBy: ids.person("u1"),
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
