import { z } from "zod";

import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { runNowInput, saveScheduleInput, setScheduleActiveInput, type SaveScheduleInput } from "./schema";
import * as repository from "./repository";
import * as service from "./service";

/** A schedule that gives its work to an agent starts that agent on every firing, unattended. */
const agentAudience = (input: SaveScheduleInput) => (input.audienceType === "Agent" ? ["audienceType"] : []);

/** Requirement 32 as tools: scheduled work items and requests (D253). */
export const SCHEDULE_TOOLS: PlatformTool[] = [
  action({
    subject: "schedule",
    operation: "list",
    description:
      "Scheduled work items by title: what each creates, for whom, how often, when it next fires, " +
      "whether it is active, its id and its version. `q` matches the title; `limit` is 50 unless " +
      "given, at most 200, from `offset`.",
    input: z.object({
      q: z.string().trim().max(200).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    permission: "schedules:read",
    run: ({ q, limit, offset }) => service.loadSchedules({ text: q, limit, offset }),
  }),

  action({
    subject: "schedule",
    operation: "create",
    description:
      "Schedule a work item or a request to be created on a timetable or an event, in a project, for " +
      "an agent, a person or a group, with bilingual titles and instructions. Leave `id` out. A " +
      "schedule that gives its work to an agent waits for a person's approval. Returns the id.",
    input: saveScheduleInput,
    permission: "schedules:write",
    escalates: agentAudience,
    run: async (input) => {
      if (input.id) throw new Error("A new schedule has no id; change an existing one with schedule_edit.");
      return { id: await service.saveSchedule(input) };
    },
  }),

  action({
    subject: "schedule",
    operation: "edit",
    description: "Save an existing schedule, named by `id`, with every field as it should now be.",
    input: saveScheduleInput,
    permission: "schedules:write",
    escalates: agentAudience,
    run: async (input) => {
      if (!input.id) throw new Error("Name the schedule to change by its id; create one with schedule_create.");
      return { id: await service.saveSchedule(input) };
    },
  }),

  action({
    subject: "schedule_activation",
    operation: "edit",
    description: "Pause a schedule or start it again. `version` is the schedule's version.",
    input: setScheduleActiveInput,
    permission: "schedules:write",
    run: async (input) => {
      await service.setScheduleActive(input);
      return { id: input.id, active: input.active };
    },
  }),

  action({
    subject: "schedule_run",
    operation: "create",
    description:
      "Fire a schedule now, as its Run now button does: it creates what the schedule creates, for " +
      "its audience, once. A schedule that gives its work to an agent waits for a person's approval.",
    input: runNowInput,
    permission: "schedules:write",
    escalates: async ({ id }) => ((await repository.readForFiring(id))?.audienceType === "Agent" ? ["audienceType"] : []),
    run: ({ id }) => service.runNow(id),
  }),

  action({
    subject: "schedule",
    operation: "delete",
    description: "Delete a schedule. What it already created stays.",
    input: runNowInput,
    permission: "schedules:write",
    run: async ({ id }) => {
      await service.deleteSchedule(id);
      return { id };
    },
  }),
];
