import { z } from "zod";

import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { sensitiveFieldsIn } from "./privileges";
import { orgUnitInput, orgUnitRemovalInput, personIdInput, updateOrgUnitInput } from "./schema";
import * as service from "./service";

/**
 * S-41 and S-42 as tools: the org units, the people and the roles, offered to an agent
 * working on someone's behalf.
 *
 * The organisation is what everything else is scoped by — a person belongs to a unit, a
 * project belongs to a unit, and a role grant is scoped to one — so an agent that can
 * read it can answer "whose is this" and "who should see it" before it acts. Writing it
 * is a narrower privilege than reading it, and inviting people is narrower still, because
 * an invitation creates a principal and gives it a role.
 */
export const ORGANISATION_TOOLS: PlatformTool[] = [
  action({
    subject: "org_unit",
    operation: "list",
    description:
      "Every org unit, with its id, code, bilingual names, whether it is a root, its lead " +
      "and how many people, agents and projects it holds. Call this first: the id is how " +
      "an edit or a delete names a unit, and the counts say what a move would carry.",
    input: z.object({}),
    permission: "organisation:read",
    run: () => service.loadOrgUnits(),
  }),

  action({
    subject: "org_unit",
    operation: "create",
    description:
      "Create an org unit, with its code, bilingual names, and optionally the unit above " +
      "it and the person who leads it. The code is unique; a duplicate is refused. A unit " +
      "with no parent is a root of the organisation. Returns its id.",
    input: orgUnitInput,
    permission: "organisation:write",
    run: async (input) => ({ id: await service.createOrgUnit(input) }),
  }),

  action({
    subject: "org_unit",
    operation: "edit",
    description:
      "Change one org unit: its bilingual names, the unit above it (null puts it at the " +
      "top) and the person who leads it (null clears it). Name only the fields to change. " +
      "`expectedVersion` is the version last read — a unit somebody has saved since is " +
      "refused, so read it again and retry. A parent that would put the unit under itself " +
      "is refused. Returns what changed, before and after, and what moves with the unit.",
    input: updateOrgUnitInput,
    permission: "organisation:write",
    // T1 to rename a unit, a decision when it moves everything under it: the server reads
    // the payload and escalates (D58).
    escalates: (input) => sensitiveFieldsIn(input),
    run: (input) => service.updateOrgUnit(input),
  }),

  action({
    subject: "org_unit",
    operation: "delete",
    description:
      "Delete an org unit. Refused while it still holds people, agents, projects or child " +
      "units, and the refusal says how many of each; move them first.",
    input: orgUnitRemovalInput,
    permission: "organisation:write",
    run: async (input) => {
      await service.removeOrgUnit(input.id, input.code);
      return { deleted: input.code };
    },
  }),

  action({
    subject: "person",
    operation: "list",
    description:
      "People on the platform, whatever their status: their id, address, name, job " +
      "title, org unit, sign-in method, and the roles and scope they hold. Includes people " +
      "who are only invited or are suspended, which the directory does not. Use it to find " +
      "the person an action names before naming them by id. `q` matches name or address, " +
      "`status` is Active, Invited, Pending or Suspended; `limit` is 50 unless given, at most 200, from " +
      "`offset`, and `total` is how many match.",
    input: z.object({
      q: z.string().trim().max(200).optional(),
      status: z.enum(["Active", "Invited", "Pending", "Suspended"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    permission: "organisation:read",
    run: async ({ q, status, limit, offset }) => {
      const listed = await service.loadPeopleAndRoles({ text: q, status, limit, offset });
      return { people: listed.people, total: listed.peopleTotal };
    },
  }),

  action({
    subject: "person",
    operation: "delete",
    description:
      "Delete a person who is Invited or Suspended, by the id `person_list` gives. Refused for " +
      "an Active person (suspend them in the console first) and for one a record still refers " +
      "to (a work item, a decision, a project they own…), and the refusal names that record's " +
      "table; such a person stays suspended. Each call waits for an approval.",
    input: personIdInput,
    // D381, amending D108: the one `permissions:write` tool. Deleting can only take a principal
    // away, never widen what anyone may reach, so it is T2 rather than outside the catalogue.
    permission: "permissions:write",
    tier: "T2",
    run: async ({ personId }) => {
      await service.deletePerson(personId);
      return { deleted: personId };
    },
  }),

  // There is deliberately no `person_create`. Inviting somebody creates a principal and
  // grants it a role, which is a change to authorization — and decision (e) puts every
  // such tool permanently outside the catalogue, not merely behind an approval. An agent
  // must never be able to widen its own or another agent's access, and the shortest path
  // to doing so is to invite a principal that holds more. `platform-tools.test.ts`
  // enforces this for the whole catalogue.

  action({
    subject: "role",
    operation: "list",
    description:
      "Every role, with its code, bilingual names, how many people hold it and whether it " +
      "is granted across the whole organisation. The code is how an invitation or a " +
      "placement names a role.",
    input: z.object({}),
    permission: "organisation:read",
    run: async () => ({ roles: (await service.loadPeopleAndRoles()).roles }),
  }),
];
