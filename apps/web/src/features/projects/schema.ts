import { z } from "zod";

import { PROJECT_STATUSES, SENSITIVITIES, TOOL_TIERS } from "@/db/schema/enums";

/** Requirement 32: the project action inputs. */

export const createProjectInput = z.object({
  key: z.string().trim().min(2).max(8).regex(/^[A-Z0-9-]+$/, "Use capitals, digits and hyphens."),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  orgUnit: z.string().trim().min(1),
  ownerPersonId: z.string().min(1),
  sensitivity: z.enum(SENSITIVITIES),
  status: z.enum(PROJECT_STATUSES),
  requireReviewerNotAuthor: z.boolean(),
  descriptionEn: z.string().trim().max(4000).optional(),
  descriptionAr: z.string().trim().max(4000).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectInput>;

/** One rule of the project's approval policy: an action, and the tier it is raised to. */
const approvalRule = z.object({ ref: z.string().trim().min(1).max(120), minimumTier: z.enum(TOOL_TIERS) });

/** `UC-21.2-01` … `-06`: what the owner may change about a project. */
export const updateProjectPolicyInput = z.object({
  key: z.string().trim().min(1),
  sensitivity: z.enum(SENSITIVITIES),
  status: z.enum(PROJECT_STATUSES),
  requireReviewerNotAuthor: z.boolean(),
  /** Connector codes the project allows. Empty means every registered connector. */
  allowedConnectors: z.array(z.string().trim().min(1)).max(64),
  /** Agent codes the project allows. Empty means every agent the trust level allows. */
  allowedAgents: z.array(z.string().trim().min(1)).max(64),
  /** Actions that need a human inside this project, each with the tier it is raised to. */
  approvalRules: z.array(approvalRule).max(64),
});

/**
 * `UC-21.2`: one project as a patch — the one write path for a project.
 *
 * Name the fields to change and nothing else: an omitted field is left alone, and the
 * three lists are replaced whole when they are named, because that is what a policy is.
 * `expectedVersion` is the version last read and goes in the SQL `WHERE`, so a project
 * somebody has saved since is refused rather than overwritten.
 */
export const updateProjectInput = z
  .object({
    key: z.string().trim().min(1),
    expectedVersion: z.number().int().positive(),
    nameEn: z.string().trim().min(1).max(120).optional(),
    nameAr: z.string().trim().min(1).max(120).optional(),
    /** Sensitive: everything in the project takes its sensitivity. */
    sensitivity: z.enum(SENSITIVITIES).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    requireReviewerNotAuthor: z.boolean().optional(),
    allowedConnectors: z.array(z.string().trim().min(1)).max(64).optional(),
    allowedAgents: z.array(z.string().trim().min(1)).max(64).optional(),
    approvalRules: z.array(approvalRule).max(64).optional(),
  })
  .strict()
  .refine(
    (patch) =>
      [
        "nameEn",
        "nameAr",
        "sensitivity",
        "status",
        "requireReviewerNotAuthor",
        "allowedConnectors",
        "allowedAgents",
        "approvalRules",
      ].some((field) => field in patch),
    { message: "An edit has to change something: name one field." },
  );

export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

/** `UC-21.3-01` … `-05`: a person or an agent joining or leaving a project. */
export const projectMemberInput = z.object({
  key: z.string().trim().min(1),
  principal: z.string().trim().min(1),
  isAgent: z.boolean(),
  projectRole: z.enum(["Owner", "Member"]),
});

export const removeProjectMemberInput = z.object({
  key: z.string().trim().min(1),
  principal: z.string().trim().min(1),
  isAgent: z.boolean(),
  /** `UC-21.3-05`: sent once the person has seen the open work the member still holds. */
  confirmed: z.boolean().default(false),
});

export const deleteProjectInput = z.object({ key: z.string().trim().min(1) });

/** Renaming a project changes only its bilingual name; the key stays what it was created with. */
export const renameProjectInput = z.object({
  key: z.string().trim().min(1),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
});

export type RenameProjectInput = z.infer<typeof renameProjectInput>;

export type UpdateProjectPolicyInput = z.infer<typeof updateProjectPolicyInput>;
export type ProjectMemberInput = z.infer<typeof projectMemberInput>;
export type RemoveProjectMemberInput = z.infer<typeof removeProjectMemberInput>;
