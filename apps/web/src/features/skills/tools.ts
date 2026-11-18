import { z } from "zod";

import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { createSkillInput, skillNameInput, skillVersionCreateInput } from "./schema";
import * as service from "./service";

/**
 * S-53 as tools: what the Skills screen does, offered to an agent working on someone's
 * behalf.
 *
 * A skill is instructions every agent holding it will follow, so the catalogue offers
 * authoring one, benching it and publishing it — and not importing a package. An import
 * names the agents to enable it for, which is agent configuration; an agent that could
 * call it could give itself a skill, so it stays a console action.
 *
 * There is no `skill_edit`: the platform has no partial edit of a skill to wrap. A skill
 * changes by getting a new version, `skill_version_create` (D376), which is T2 because the
 * agents carrying the skill move to it and follow what it says from their next run.
 */
export const SKILL_TOOLS: PlatformTool[] = [
  action({
    subject: "skill",
    operation: "list",
    description:
      "Every skill installed, with where it came from, its current version, its " +
      "description, its tags, how many agent versions carry it, and the state of that " +
      "version. Each one also carries its security scan and which agents use it. Call this " +
      "first: the skill name is how every other tool names a skill.",
    input: z.object({}),
    permission: "skills:read",
    run: () => service.loadSkills(),
  }),

  action({
    subject: "skill",
    operation: "create",
    description:
      "Author a skill, with its name, bilingual titles, bilingual descriptions, source " +
      "type, version label and tags. The name is lowercase letters, digits and hyphens. " +
      "The description is required and is what an agent reads to decide whether to load " +
      "the skill, so write what it is for rather than what it is called. It is a draft " +
      "until it is published.",
    input: createSkillInput,
    permission: "skills:write",
    run: async (input) => {
      await service.createSkill(input);
      return { skillName: input.skillName };
    },
  }),

  action({
    subject: "skill_version",
    operation: "create",
    description:
      "Update an installed skill: its next version, made current, from the full text of its " +
      "files. Pass every file the new version should hold — `SKILL.md` with its frontmatter " +
      "(`name`, `description`, optional `allowed-tools`) and each reference or script — not only " +
      "the changed ones: a file left out is not in the new version. The description in " +
      "`SKILL.md` becomes the skill's description. The files are scanned as an imported package " +
      "is and refused with the reasons. With `moveAgents` (the default) the agents whose active " +
      "version or draft carries the skill move to it; earlier published agent versions keep " +
      "theirs. A bundled skill cannot be updated. Use `skill_create` for a skill that does not " +
      "exist yet.",
    input: skillVersionCreateInput,
    permission: "skills:write",
    tier: "T2",
    run: (input) => service.updateSkillFiles(input),
  }),

  action({
    subject: "skill",
    operation: "publish",
    description:
      "Publish a skill's current version. Returns which agents carry it and on which " +
      "version — an agent pinned to an older one does not move.",
    input: skillNameInput,
    permission: "skills:write",
    run: ({ skillName }) => service.publishSkill(skillName),
  }),

  action({
    subject: "skill",
    operation: "delete",
    description:
      "Delete a skill, with its versions and scan result. Refused while an agent's active " +
      "version or open draft carries it, and the refusal names them.",
    input: skillNameInput,
    permission: "skills:write",
    run: async ({ skillName }) => {
      await service.deleteSkill(skillName);
      return { deleted: skillName };
    },
  }),
];
