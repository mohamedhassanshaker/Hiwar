import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { sensitiveFieldsIn } from "./privileges";
import {
  approveInput,
  assignInput,
  commentInput,
  subItemInput,
  updateWorkItemInput,
  workItemKeyInput,
} from "./schema";
import * as service from "./service";

/**
 * S-24 and S-25 as tools: what the board and the work item drawer do, offered to an agent
 * working on someone's behalf.
 *
 * Creating an item, reading one and searching the board are already in the catalogue;
 * what is here is the rest of an item's life — editing it, moving it through review, and
 * the comments and sub items that accumulate on it — so an agent given a piece of work
 * can carry it to the end rather than only start it.
 *
 * A review, an approval and a change request are each their own subject: each is a record
 * in the item's history with its own rule about who may add it, not a field of the item.
 */
export const WORK_ITEM_TOOLS: PlatformTool[] = [
  action({
    subject: "work_item",
    operation: "edit",
    description:
      "Change one work item: its bilingual titles, its description (null clears it), its " +
      "priority, its due date (null clears it) and its status. Name only the fields to " +
      "change; anything omitted is left alone. `expectedVersion` is the version last read " +
      "— an item somebody has moved since is refused, so read it again and retry. A " +
      "status the flow does not allow from the current one is refused and named. Returns " +
      "what changed, before and after, and how many sub items are still open if this " +
      "closes the item.",
    input: updateWorkItemInput,
    permission: "work_items:write",
    // T1 to retitle or reprioritise, a decision when it says the work is finished,
    // cancelled or started again: the server reads the payload and escalates (D58).
    escalates: (input) => sensitiveFieldsIn(input),
    run: (input) => service.updateWorkItem(input),
  }),

  action({
    subject: "work_item_assignee",
    operation: "edit",
    description:
      "Give a work item to a person (by id) or an agent (by code). A person's item in the backlog " +
      "moves to To do; an agent starts on it at once. The reviewer cannot also be the assignee.",
    input: assignInput,
    permission: "work_items:write",
    run: async ({ key, assignee }) => {
      await service.assign(key, assignee);
      return { key, assignee };
    },
  }),

  action({
    subject: "work_item",
    operation: "delete",
    description:
      "Delete a work item. Refused while an approval was decided on it, a schedule firing " +
      "created it, or a sub item still sits under it, and the refusal says which. Cancel " +
      "the work instead when it happened but should not have.",
    input: workItemKeyInput,
    permission: "work_items:write",
    run: async (input) => {
      await service.deleteWorkItem(input.key);
      return { deleted: input.key };
    },
  }),

  action({
    subject: "work_item_review",
    operation: "create",
    description:
      "Hand a work item to its reviewer: it moves to In review and the reviewer is told. " +
      "Only work that is To do or in progress can be submitted. Call this when the work " +
      "is finished rather than moving it to Done, which is the reviewer's decision.",
    input: workItemKeyInput,
    permission: "work_items:write",
    run: async (input) => {
      await service.submitForReview(input.key);
      return { submitted: input.key };
    },
  }),

  action({
    subject: "work_item_approval",
    operation: "create",
    description:
      "Approve a work item, which finishes it. Refused for the person who raised the work " +
      "or is doing it, and refused while sub items are still open unless `override` says " +
      "why they no longer matter. The request the work belongs to is told when its last " +
      "item is done.",
    input: approveInput,
    permission: "work_items:write",
    run: async (input) => {
      await service.approve(input.key, input.override);
      return { approved: input.key };
    },
  }),

  action({
    subject: "work_item_change_request",
    operation: "create",
    description:
      "Send a work item back from review with what has to change. Only work in review can " +
      "be sent back. Say what to change, not that it is wrong: the comment is the whole " +
      "instruction, and an agent assignee is started again with it.",
    input: commentInput,
    permission: "work_items:write",
    run: async (input) => {
      await service.requestChanges(input.key, input.text);
      return { sentBack: input.key };
    },
  }),

  action({
    subject: "work_item_comment",
    operation: "create",
    description:
      "Comment on a work item. An `@handle` names a person, who is notified; the handle is " +
      "the part of their address before the `@`. Returns the handles that were matched, so " +
      "a name nobody was notified about can be corrected rather than assumed delivered.",
    input: commentInput,
    permission: "work_items:write",
    run: (input) => service.comment(input.key, input.text),
  }),

  action({
    subject: "work_item_sub_item",
    operation: "create",
    description:
      "Add a sub item under a work item, in the same project. Use this to break work into " +
      "the steps it is actually made of; a parent with open sub items cannot be approved " +
      "without a reason. A sub item has no sub items of its own. Returns its key.",
    input: subItemInput,
    permission: "work_items:write",
    run: async (input) => ({ key: await service.addSubItem(input.parentKey, input.titleEn) }),
  }),
];
