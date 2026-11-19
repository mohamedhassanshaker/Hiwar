import { audit } from "@/lib/audit";
import { requireOrganisationPermission, requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { CreateSkillInput } from "./schema";
import { SkillRejected } from "./errors";

export { SkillRejected } from "./errors";
export { validateSkillPackage, importSkill, updateSkillPackage, updateSkillFiles } from "./import-service";
export { listSkillFiles, readSkillFile, skillPackageZip } from "./package-service";

/** S-53: the skills the organisation has installed, authored or bundled. */

export async function loadSkills() {
  await requirePermission("skills:read");
  const [skills, details] = await Promise.all([repository.listSkills(), repository.readDetails()]);
  return { skills, details };
}

/**
 * Creates a skill with its first version as a Draft that still needs its scan, and audits it.
 * Requires `skills:write`; the author is the signed-in person.
 */
export async function createSkill(input: CreateSkillInput): Promise<void> {
  const session = await requireOrganisationPermission("skills:write");
  await repository.createSkill({
    skillName: input.skillName,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    descriptionEn: input.descriptionEn,
    descriptionAr: input.descriptionAr,
    sourceType: input.sourceType,
    versionLabel: input.versionLabel,
    tags: input.tags,
    authorPersonId: session.personId,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "skills:write",
    objectType: "Skill",
    objectLabel: input.skillName,
    detail: { sourceType: input.sourceType, versionLabel: input.versionLabel },
  });
}

/** The one write path for a skill's published flag, which `publishSkill` calls. */
export async function setPublished(skillName: string, published: boolean): Promise<void> {
  const session = await requireOrganisationPermission("skills:write");
  await repository.setPublished(skillName, published, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "skills:publish",
    objectType: "Skill",
    objectLabel: skillName,
    detail: { published },
  });
}

/**
 * `UC-53.3-03`: publish the skill's current version, and say who is on which version.
 */
export async function publishSkill(skillName: string): Promise<{ usedBy: { agent: string; version: string }[] }> {
  await requireOrganisationPermission("skills:write");

  // The write is `setPublished`, so the flag has one write path whichever way it is reached (D60).
  await setPublished(skillName, true);

  // Who is on which version, which is what Where used shows: an agent pinned to an older
  // one does not move because a new version exists.
  return { usedBy: await repository.agentsUsingSkill(skillName) };
}

/**
 * Deletes a skill no agent uses: neither an agent's active version nor its open draft
 * carries it. Its own versions, scan result and stored test cases are removed with it, and so are
 * the pins of earlier agent versions, which a rollback to one of them then runs without.
 * An agent version in use refuses the delete and is named.
 *
 * @throws {SkillRejected} when the skill no longer exists or an agent still carries it.
 */
export async function deleteSkill(skillName: string): Promise<void> {
  const session = await requireOrganisationPermission("skills:write");

  const source = await repository.skillSource(skillName);
  if (!source) {
    throw new SkillRejected("That skill no longer exists.", "لم تعد هذه المهارة موجودة.");
  }
  // D228: a bundled skill ships with the platform, as part of it.
  if (source === "Bundled") {
    throw new SkillRejected(
      `${skillName} ships with the platform and cannot be deleted.`,
      `${skillName} مدمجة في المنصة ولا يمكن حذفها.`,
    );
  }

  const usedBy = await repository.agentVersionsUsingSkill(skillName);
  if (usedBy.length) {
    const names = usedBy.map((u) => `${u.agent} v${u.version}`).join(", ");
    throw new SkillRejected(
      `This skill cannot be deleted: ${names} still ${usedBy.length === 1 ? "carries" : "carry"} it.`,
      `لا يمكن حذف هذه المهارة: لا يزال ${names} يحملها.`,
    );
  }

  await repository.deleteSkill(skillName);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "skills:delete",
    objectType: "Skill",
    objectLabel: skillName,
  });
}
