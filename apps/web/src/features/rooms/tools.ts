import { z } from "zod";

import { SERVER_PAGE_SIZE } from "@/lib/paging";
import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { closeRoomInput, createRoomInput, forkRoomInput, participantInput, roomKeyInput, setTurnTakingInput } from "./schema";
import * as service from "./service";

/**
 * S-22 and S-23 as tools: setting up and running discussion rooms (D253).
 *
 * Posting a message is not offered. A message posted through a tool would be the person's,
 * and a person's message is what starts an agent's mission in a room, so an agent posting
 * would start other agents' missions: the agent-to-agent traffic D66 rules out.
 */
export const ROOM_TOOLS: PlatformTool[] = [
  action({
    subject: "room",
    operation: "list",
    description:
      "The discussion rooms the acting person may see, latest activity first, 50 a page, with each one's key, " +
      "project, status and participants, how many match (`total`), and counters over every room they may see. " +
      "Filter by `status` (Active, Idle, Paused, Closed, Archived), `projectKey`, or `q` (title or key).",
    input: z.object({
      status: z.enum(["Active", "Idle", "Paused", "Closed", "Archived"]).optional(),
      projectKey: z.string().max(64).optional(),
      q: z.string().max(200).optional(),
      page: z.number().int().min(1).optional(),
    }),
    permission: "rooms:read",
    run: async (input) => {
      const page = input.page ?? 1;
      const listed = await service.loadRooms(
        { status: input.status, projectKey: input.projectKey, text: input.q?.trim() || undefined },
        { limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE },
      );
      return { ...listed, page };
    },
  }),

  action({
    subject: "room",
    operation: "create",
    description:
      "Create a discussion room in a project, with bilingual titles, its type, turn-taking policy, " +
      "status, and its participants (person ids or agent codes; the first agent leads). The acting " +
      "person is its owner. Returns the room's key.",
    input: createRoomInput,
    permission: "rooms:write",
    run: async (input) => ({ key: await service.createRoom(input) }),
  }),

  action({
    subject: "room",
    operation: "edit",
    description: "Change a room's turn-taking policy. `version` is the room's version; a stale one is refused.",
    input: setTurnTakingInput,
    permission: "rooms:moderate",
    run: async (input) => {
      await service.setTurnTaking(input);
      return { key: input.roomKey };
    },
  }),

  action({
    subject: "room_participant",
    operation: "create",
    description: "Add a person (by id) or an agent (by code) to a room.",
    input: participantInput.omit({ action: true }),
    permission: "rooms:moderate",
    run: async (input) => {
      await service.setParticipant({ ...input, action: "Add" });
      return { key: input.roomKey };
    },
  }),

  action({
    subject: "room_participant",
    operation: "delete",
    description: "Take a person (by id) or an agent (by code) out of a room. Their messages stay.",
    input: participantInput.omit({ action: true }),
    permission: "rooms:moderate",
    // Membership, not a record: whoever is taken out can be added back.
    tier: "T1",
    run: async (input) => {
      await service.setParticipant({ ...input, action: "Remove" });
      return { key: input.roomKey };
    },
  }),

  action({
    subject: "room_closure",
    operation: "create",
    description:
      "Close a room, writing its final handoff: the goal, the decisions taken, the open questions " +
      "and the next step.",
    input: closeRoomInput,
    permission: "rooms:moderate",
    run: async (input) => {
      await service.closeRoom(input);
      return { key: input.roomKey };
    },
  }),

  action({
    subject: "room_fork",
    operation: "create",
    description:
      "Fork a room: a new room linked to this one, with bilingual titles, carrying over what should " +
      "change and the last messages. Returns the new room's key.",
    input: forkRoomInput,
    permission: "rooms:write",
    run: async (input) => ({ key: await service.forkRoom(input) }),
  }),

  action({
    subject: "room",
    operation: "delete",
    description: "Delete a room with its messages. Refused while anything else still points at it.",
    input: roomKeyInput,
    permission: "rooms:moderate",
    run: async ({ roomKey }) => {
      await service.deleteRoom(roomKey);
      return { key: roomKey };
    },
  }),
];
