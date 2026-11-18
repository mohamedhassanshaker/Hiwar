import { z } from "zod";

import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { sensitiveFieldsIn } from "./privileges";
import {
  createProjectInput,
  deleteProjectInput,
  projectMemberInput,
  removeProjectMemberInput,
  updateProjectInput,
} from "./schema";
import * as service from "./service";

/**
 * S-20 and S-21 as tools: what the Projects screens do, offered to an agent working on
 * someone's behalf.
 *
 * A project is the container everything else is raised in, so an agent that can read the
 * list can answer "where does this belong" before it creates a work item or a request,
 * and an agent setting one up can do the whole thing — create it, admit the people and
 * the agents that will work in it, and set the policy they work under.
 */
export const PROJECT_TOOLS: PlatformTool[] = [
  action({
    subject: "project",
    operation: "list",
    description:
      "Every project the acting person may see, with its key, its sensitivity and status, " +
      "what it contains, its members, its allowed connectors and agents, its approval " +
      "rules and its version. Call this first: the key is how every other tool names a " +
      "project, and the version is what an edit has to name back.",
    input: z.object({}),
    permission: "projects:read",
    run: () => service.loadProjects(),
  }),

  action({
    subject: "project",
    operation: "create",
    description:
      "Create a project, with its key, bilingual names, org unit, owner, sensitivity, " +
      "status and optional bilingual description. The key is short and in capitals, and is what every work item, request and " +
      "room in the project is addressed by; it cannot be changed afterwards. The owner " +
      "becomes its first member.",
    input: createProjectInput,
    permission: "projects:write",
    run: async (input) => {
      await service.createProject(input);
      return { key: input.key };
    },
  }),

  action({
    subject: "project",
    operation: "edit",
    description:
      "Change a project: its bilingual names, its status, its sensitivity, whether a " +
      "reviewer must differ from the author, which connectors and agents it allows, and " +
      "which actions need a human approval inside it. Name only the fields to change; " +
      "anything omitted is left alone, and each of the three lists is replaced whole by " +
      "the one sent. `expectedVersion` is the version last read — a project somebody has " +
      "saved since is refused, so read it again and retry. Returns what changed, before " +
      "and after, with the allowed connectors, agents and approval rules the edit dropped.",
    input: updateProjectInput,
    permission: "projects:write",
    // T1 to rename a project, a decision when it changes who may work in it or what they
    // may do unattended: the server reads the payload and escalates (D58).
    escalates: (input) => sensitiveFieldsIn(input),
    run: (input) => service.updateProject(input),
  }),

  action({
    subject: "project",
    operation: "delete",
    description:
      "Delete a project. Refused while it still holds anything — rooms, work items, " +
      "requests, artifacts, files, schedules, knowledge collections, or a request type " +
      "naming it as a default — and the refusal says what is still there.",
    input: deleteProjectInput,
    permission: "projects:write",
    run: async (input) => {
      await service.deleteProject(input.key);
      return { deleted: input.key };
    },
  }),

  action({
    subject: "project_member",
    operation: "create",
    description:
      "Put a person or an agent in a project, as Owner or Member. An agent is named by its " +
      "code and is refused when the project's allowed agents leave it out — change the " +
      "policy first rather than going round it.",
    input: projectMemberInput,
    permission: "projects:write",
    run: async (input) => {
      await service.addMember(input);
      return { added: input.principal };
    },
  }),

  action({
    subject: "project_member",
    operation: "delete",
    description:
      "Take a person or an agent out of a project. The open work they still hold is named " +
      "first and nothing is removed; pass confirmed to go ahead once it has been read. The " +
      "work stays assigned to them. The last owner may not leave.",
    input: removeProjectMemberInput,
    permission: "projects:write",
    run: (input) => service.removeMember(input),
  }),
];
