import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import type { Skill, SkillDetail } from "./types";

/** The only module in `skills` that touches Drizzle. */

/** The badge a skill carries, from its source and the state of its current version. */
function badge(sourceType: string, status: string, frontmatterValid: boolean): string {
  if (!frontmatterValid) return "Pending scan";
  if (sourceType === "Bundled") return "Bundled";
  if (status === "Draft") return "Pending scan";
  return "Installed";
}

const agentCount = sql<number>`(
  select count(*) from ai.agent_skill asg where asg.skill_version_id = ${s.skillVersion.id}
)::int`;

/**
 * Every skill at its current version, with how many agent versions carry that version and its
 * badge; by name.
 */
export async function listSkills(): Promise<Skill[]> {
  const rows = await dbRo()
    .select({
      n: s.skill.skillName,
      src: s.skill.sourceType,
      v: s.skillVersion.versionLabel,
      d: s.skill.descriptionEn,
      dAr: s.skill.descriptionAr,
      tags: s.skill.tags,
      status: s.skillVersion.status,
      frontmatterValid: s.skillVersion.frontmatterValid,
      agents: agentCount,
    })
    .from(s.skill)
    .innerJoin(s.skillVersion, eq(s.skillVersion.id, s.skill.currentVersionId))
    .orderBy(asc(s.skill.skillName));

  return rows.map((row) => ({
    n: row.n,
    src: row.src,
    v: row.v,
    d: row.d ?? "",
    dAr: row.dAr ?? "",
    tags: row.tags ?? [],
    agents: row.agents,
    b: badge(row.src, row.status, row.frontmatterValid),
  }));
}

/**
 * Each skill's current version keyed by skill name: package reference, checksum, frontmatter
 * check, scan result (null until scanned) and the agent versions carrying it.
 */
export async function readDetails(): Promise<Record<string, SkillDetail>> {
  const rows = await dbRo()
    .select({
      versionId: s.skillVersion.id,
      name: s.skill.skillName,
      packageRef: s.skillVersion.packageRef,
      checksum: s.skillVersion.checksum,
      frontmatterValid: s.skillVersion.frontmatterValid,
      scripts: s.skillScanResult.scripts,
      networkCalls: s.skillScanResult.networkCalls,
      promptInjectionPatterns: s.skillScanResult.promptInjectionPatterns,
      embeddedSecrets: s.skillScanResult.embeddedSecrets,
      sandboxOnly: s.skillScanResult.sandboxOnly,
      scannedAt: s.skillScanResult.scannedAt,
    })
    .from(s.skill)
    .innerJoin(s.skillVersion, eq(s.skillVersion.id, s.skill.currentVersionId))
    .leftJoin(s.skillScanResult, eq(s.skillScanResult.skillVersionId, s.skillVersion.id))
    .orderBy(asc(s.skill.skillName));

  const versionIds = rows.map((row) => row.versionId);
  const usage = versionIds.length
    ? await dbRo()
        .select({ versionId: s.agentSkill.skillVersionId, agent: s.agent.nameEn, versionNumber: s.agentVersion.versionNumber })
        .from(s.agentSkill)
        .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agentSkill.agentVersionId))
        .innerJoin(s.agent, eq(s.agent.id, s.agentVersion.agentId))
        .where(inArray(s.agentSkill.skillVersionId, versionIds))
    : [];

  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      {
        name: row.name,
        packageRef: row.packageRef,
        checksum: row.checksum,
        frontmatterValid: row.frontmatterValid,
        scan:
          row.scannedAt === null
            ? null
            : {
                scripts: row.scripts ?? 0,
                networkCalls: row.networkCalls ?? 0,
                promptInjectionPatterns: row.promptInjectionPatterns ?? 0,
                embeddedSecrets: row.embeddedSecrets ?? 0,
                sandboxOnly: row.sandboxOnly ?? true,
                scannedAt: row.scannedAt.toISOString(),
              },
        usedBy: usage.filter((use) => use.versionId === row.versionId).map((use) => `${use.agent} v${use.versionNumber}`),
      },
    ]),
  );
}

export type NewSkill = {
  skillName: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  sourceType: string;
  versionLabel: string;
  tags: string[];
  authorPersonId: string;
};

/** Imports or authors a skill: the package, its first version and the scan it still needs. */
export async function createSkill(input: NewSkill): Promise<void> {
  await db().transaction(async (tx) => {
    const [skill] = await tx
      .insert(s.skill)
      .values({
        skillName: input.skillName,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr,
        sourceType: input.sourceType,
        tags: input.tags,
        authorPersonId: input.authorPersonId,
        createdBy: input.authorPersonId,
        updatedBy: input.authorPersonId,
      })
      .returning({ id: s.skill.id });
    const [version] = await tx
      .insert(s.skillVersion)
      .values({
        skillId: skill.id,
        versionLabel: input.versionLabel,
        packageRef: `skills/${input.skillName}/${input.versionLabel}.zip`,
        // Specification section 9: a package is scanned before it is published.
        frontmatterValid: false,
        status: "Draft",
        createdBy: input.authorPersonId,
        updatedBy: input.authorPersonId,
      })
      .returning({ id: s.skillVersion.id });
    await tx.update(s.skill).set({ currentVersionId: version.id }).where(eq(s.skill.id, skill.id));
  });
}

/**
 * Removes a skill the caller has already checked no agent is using, with the pins earlier
 * agent versions still hold. A pin added since the check stops the delete: the foreign key
 * from `agent_skill` refuses removing a version an agent in use still carries.
 */
export async function deleteSkill(skillName: string): Promise<void> {
  await db().transaction(async (tx) => {
    const versions = tx
      .select({ id: s.skillVersion.id })
      .from(s.skillVersion)
      .innerJoin(s.skill, eq(s.skill.id, s.skillVersion.skillId))
      .where(eq(s.skill.skillName, skillName));
    const earlier = tx
      .select({ id: s.agentVersion.id })
      .from(s.agentVersion)
      .where(and(eq(s.agentVersion.isActive, false), isNotNull(s.agentVersion.publishedAt)));
    await tx
      .delete(s.agentSkill)
      .where(and(inArray(s.agentSkill.skillVersionId, versions), inArray(s.agentSkill.agentVersionId, earlier)));
    await tx.delete(s.skill).where(eq(s.skill.skillName, skillName));
  });
}

/** Publishes or unpublishes the current version of a skill. */
export async function setPublished(skillName: string, published: boolean, personId: string): Promise<void> {
  await db()
    .update(s.skillVersion)
    .set({ status: published ? "Published" : "Draft", frontmatterValid: published, updatedAt: new Date(), updatedBy: personId })
    .where(sql`${s.skillVersion.id} = (select sk.current_version_id from ai.skill sk where sk.skill_name = ${skillName})`);
}

/** `UC-53.2-02`: an imported skill, its scanned version and the agents it is enabled for. */
export async function importSkill(input: {
  skillName: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  sourceType: string;
  sourceUrl: string | null;
  versionLabel: string;
  declaredTools: string[];
  scan: {
    scripts: number;
    networkCalls: number;
    promptInjectionPatterns: number;
    embeddedSecrets: number;
    sandboxOnly: boolean;
  };
  agentCodes: string[];
  importedBy: string;
}): Promise<void> {
  await db().transaction(async (tx) => {
    const [skill] = await tx
      .insert(s.skill)
      .values({
        skillName: input.skillName,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        tags: [],
        createdBy: input.importedBy,
        updatedBy: input.importedBy,
      })
      .returning({ id: s.skill.id });

    const [version] = await tx
      .insert(s.skillVersion)
      .values({
        skillId: skill.id,
        versionLabel: input.versionLabel,
        // Where its files actually are: the `skills` bucket, under this prefix, as
        // `service.ts`'s `importSkill` wrote them — a bucket/key reference, not a file.
        packageRef: `skills/${input.skillName}/${input.versionLabel}`,
        // It was scanned on the way in, which is what `frontmatterValid` records.
        frontmatterValid: true,
        declaredTools: input.declaredTools,
        status: "Published",
        createdBy: input.importedBy,
        updatedBy: input.importedBy,
      })
      .returning({ id: s.skillVersion.id });

    await tx.insert(s.skillScanResult).values({
      skillVersionId: version.id,
      ...input.scan,
      createdBy: input.importedBy,
      updatedBy: input.importedBy,
    });

    await tx.update(s.skill).set({ currentVersionId: version.id }).where(eq(s.skill.id, skill.id));

    // Enabled on each agent's active version, which is what "enabled for those agents"
    // means: a skill attached to a draft nobody publishes would do nothing.
    if (input.agentCodes.length) {
      const agents = await tx
        .select({ versionId: s.agent.activeVersionId })
        .from(s.agent)
        .where(inArray(s.agent.code, input.agentCodes));
      const rows = agents
        .filter((agent): agent is { versionId: string } => agent.versionId !== null)
        .map((agent) => ({ agentVersionId: agent.versionId, skillVersionId: version.id }));
      if (rows.length) await tx.insert(s.agentSkill).values(rows).onConflictDoNothing();
    }
  });
}

/** Every version label a skill has, so an update does not reuse one. */
export async function versionLabels(skillName: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ label: s.skillVersion.versionLabel })
    .from(s.skillVersion)
    .innerJoin(s.skill, eq(s.skill.id, s.skillVersion.skillId))
    .where(eq(s.skill.skillName, skillName));
  return rows.map((row) => row.label);
}

/**
 * `UC-53.2`: a new scanned version of an installed skill, made current. With `moveAgents`, the
 * agents' active versions and open drafts that carry the skill are moved to it.
 */
export async function addSkillVersion(input: {
  skillName: string;
  versionLabel: string;
  descriptionEn: string;
  declaredTools: string[];
  scan: { scripts: number; networkCalls: number; promptInjectionPatterns: number; embeddedSecrets: number; sandboxOnly: boolean };
  moveAgents: boolean;
  personId: string;
}): Promise<void> {
  await db().transaction(async (tx) => {
    const [skill] = await tx
      .select({ id: s.skill.id, descriptionEn: s.skill.descriptionEn, descriptionAr: s.skill.descriptionAr })
      .from(s.skill)
      .where(eq(s.skill.skillName, input.skillName));
    const [version] = await tx
      .insert(s.skillVersion)
      .values({
        skillId: skill.id,
        versionLabel: input.versionLabel,
        packageRef: `skills/${input.skillName}/${input.versionLabel}`,
        frontmatterValid: true,
        declaredTools: input.declaredTools,
        status: "Published",
        createdBy: input.personId,
        updatedBy: input.personId,
      })
      .returning({ id: s.skillVersion.id });
    await tx.insert(s.skillScanResult).values({ skillVersionId: version.id, ...input.scan, createdBy: input.personId, updatedBy: input.personId });

    // The description is what an agent reads to choose the skill, so it follows SKILL.md. An
    // Arabic description that was only a copy of the English one follows it too.
    const copied = skill.descriptionAr === skill.descriptionEn;
    await tx
      .update(s.skill)
      .set({ currentVersionId: version.id, descriptionEn: input.descriptionEn, ...(copied ? { descriptionAr: input.descriptionEn } : {}), updatedBy: input.personId })
      .where(eq(s.skill.id, skill.id));

    if (!input.moveAgents) return;
    const earlierVersions = tx.select({ id: s.skillVersion.id }).from(s.skillVersion).where(eq(s.skillVersion.skillId, skill.id));
    const inUse = tx
      .select({ id: s.agentVersion.id })
      .from(s.agentVersion)
      .where(or(eq(s.agentVersion.isActive, true), isNull(s.agentVersion.publishedAt)));
    await tx
      .update(s.agentSkill)
      .set({ skillVersionId: version.id, updatedBy: input.personId })
      .where(and(inArray(s.agentSkill.skillVersionId, earlierVersions), inArray(s.agentSkill.agentVersionId, inUse)));
  });
}

/** Where a skill came from (`Bundled`, `Console`, …), or null when there is no such skill. */
export async function skillSource(skillName: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ source: s.skill.sourceType })
    .from(s.skill)
    .where(eq(s.skill.skillName, skillName))
    .limit(1);
  return row?.source ?? null;
}

/** `UC-53.2-01`: whether any skill already has this name. */
export async function skillNameTaken(skillName: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ id: s.skill.id })
    .from(s.skill)
    .where(eq(s.skill.skillName, skillName))
    .limit(1);
  return row !== undefined;
}

/**
 * Where a skill's current version keeps its files and where the skill came from, or null when
 * there is no such skill.
 */
export async function packageOf(skillName: string): Promise<{ sourceType: string; packageRef: string | null; versionLabel: string } | null> {
  const [row] = await dbRo()
    .select({ sourceType: s.skill.sourceType, packageRef: s.skillVersion.packageRef, versionLabel: s.skillVersion.versionLabel })
    .from(s.skill)
    .innerJoin(s.skillVersion, eq(s.skillVersion.id, s.skill.currentVersionId))
    .where(eq(s.skill.skillName, skillName))
    .limit(1);
  return row ?? null;
}

/**
 * The agent versions an agent runs now or edits next that carry this skill: the active
 * version and an unpublished draft. An earlier published version is history, not use.
 */
export async function agentVersionsUsingSkill(skillName: string): Promise<{ agent: string; version: number }[]> {
  return dbRo()
    .select({ agent: s.agent.code, version: s.agentVersion.versionNumber })
    .from(s.agentSkill)
    .innerJoin(s.skillVersion, eq(s.skillVersion.id, s.agentSkill.skillVersionId))
    .innerJoin(s.skill, eq(s.skill.id, s.skillVersion.skillId))
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agentSkill.agentVersionId))
    .innerJoin(s.agent, eq(s.agent.id, s.agentVersion.agentId))
    .where(
      and(
        eq(s.skill.skillName, skillName),
        or(eq(s.agentVersion.isActive, true), isNull(s.agentVersion.publishedAt)),
      ),
    )
    .orderBy(asc(s.agent.code), asc(s.agentVersion.versionNumber));
}

/** `UC-53.3-03`: the agents pinned to a version of this skill, for Where used. */
export async function agentsUsingSkill(skillName: string): Promise<{ agent: string; version: string }[]> {
  return dbRo()
    .select({ agent: s.agent.code, version: s.skillVersion.versionLabel })
    .from(s.agentSkill)
    .innerJoin(s.skillVersion, eq(s.skillVersion.id, s.agentSkill.skillVersionId))
    .innerJoin(s.skill, eq(s.skill.id, s.skillVersion.skillId))
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agentSkill.agentVersionId))
    .innerJoin(s.agent, eq(s.agent.id, s.agentVersion.agentId))
    .where(eq(s.skill.skillName, skillName))
    .orderBy(asc(s.agent.code));
}
