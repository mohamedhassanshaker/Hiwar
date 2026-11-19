import { z } from "zod";

import { SKILL_SOURCE_TYPES } from "@/db/schema/enums";

/** Requirement 32: the skill action inputs. */

export const createSkillInput = z.object({
  skillName: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and hyphens."),
  titleEn: z.string().trim().min(1).max(120),
  titleAr: z.string().trim().min(1).max(120),
  // `UC-53.3-04`: required, not optional. The description is what an agent reads to
  // decide whether to load the skill at all, so one without it can never be chosen
  // correctly — it would sit in the index saying nothing.
  descriptionEn: z
    .string()
    .trim()
    .min(1, "A description is required: agents read it to decide when to load the skill.")
    .max(2000),
  descriptionAr: z.string().trim().min(1, "An Arabic description is required.").max(2000),
  sourceType: z.enum(SKILL_SOURCE_TYPES),
  versionLabel: z.string().trim().min(1).max(20),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export type CreateSkillInput = z.infer<typeof createSkillInput>;

/** `UC-53.2-01`: a package to read, from an upload or a Git URL. */
export const validatePackageInput = z
  .object({
    zipBase64: z.string().min(1).optional(),
    gitUrl: z.string().trim().url().optional(),
  })
  .refine((value) => Boolean(value.zipBase64 || value.gitUrl), "Choose a package or a Git URL.");

/** `UC-53.2-02`: import a validated package and enable it for these agents. */
export const importSkillInput = z
  .object({
    zipBase64: z.string().min(1).optional(),
    gitUrl: z.string().trim().url().optional(),
    agentCodes: z.array(z.string().trim().min(1)).max(50).default([]),
  })
  .refine((value) => Boolean(value.zipBase64 || value.gitUrl), "Choose a package or a Git URL.");

/** `UC-53.2`: a new package for an installed skill, and whether its agents move to it. */
export const updateSkillPackageInput = z
  .object({
    skillName: z.string().trim().min(1),
    zipBase64: z.string().min(1).optional(),
    gitUrl: z.string().trim().url().optional(),
    moveAgents: z.boolean().default(true),
  })
  .refine((value) => Boolean(value.zipBase64 || value.gitUrl), "Choose a package or a Git URL.");

/**
 * D376: an installed skill's next version from the text of its files, as an agent writes them.
 * The limits are a package's own (`lib/skill-package.ts`), checked again once the files are read.
 */
export const skillVersionCreateInput = z.object({
  skillName: z.string().trim().min(1),
  files: z
    .array(z.object({ path: z.string().trim().min(1).max(200), content: z.string() }))
    .min(1, "Pass the skill's files, SKILL.md first.")
    .max(200),
  moveAgents: z.boolean().default(true),
});

/** Which skill an action is about. */
export const skillNameInput = z.object({ skillName: z.string().trim().min(1) });
