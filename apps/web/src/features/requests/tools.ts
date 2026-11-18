import { z } from "zod";

import { action } from "@/mcp/action-tool";
import { sensitiveFieldsIn } from "./privileges";
import type { PlatformTool } from "@/mcp/tools";

import {
  assignRequestToAgentInput,
  attributeInput,
  audienceInput,
  createRequestInput,
  createRequestTypeInput,
  decisionInput,
  deleteRequestTypeInput,
  deleteStepInput,
  publishRequestTypeInput,
  removeAttributeInput,
  updateAttributeInput,
  updateRuleInput,
  requestKeyInput,
  requestTypeReadInput,
  ruleInput,
  saveDraftInput,
  updateStepInput,
  stepActionInput,
  stepEntryInput,
  stepInput,
} from "./schema";
import * as service from "./service";

/**
 * S-27 to S-30 as tools: what the Requests screens do, offered to an agent working on
 * someone's behalf.
 *
 * Designing a request type is several calls — create the type, add its steps, give each
 * an audience and its routing, declare the attributes, publish — so this is the module
 * that makes a composite mission like "a request type for merchant credential resets,
 * asking for the merchant id" something an agent can carry out rather than describe.
 *
 * A sub-resource is its own subject: adding a step is `request_type_step_create`, not a
 * verb on the type. That keeps one vocabulary across the catalogue, so a model that has
 * learnt projects can write request types without being told the names.
 */
export const REQUEST_TOOLS: PlatformTool[] = [
  action({
    subject: "request_type",
    operation: "create",
    description:
      "Create a request type as a draft, with its code, bilingual names, category and how " +
      "it decomposes. The code must be unique; a duplicate is refused. Returns the code. " +
      "The type takes no requests until it is published.",
    input: createRequestTypeInput,
    permission: "request_types:write",
    run: async (input) => ({ code: await service.createRequestType(input) }),
  }),

  action({
    subject: "request_type",
    operation: "edit",
    description:
      "Set a draft request type's general settings: category, decomposition, SLA as a " +
      "count and an interval, default project, intake channels and entry modes. The " +
      "published version is untouched.",
    input: saveDraftInput,
    permission: "request_types:write",
    run: (input) => service.saveDraft(input),
  }),

  action({
    subject: "request_type",
    operation: "publish",
    description:
      "Publish a valid draft as a new version. Refused while the flow has a hole — an " +
      "unreachable step, a dead end, or a step nobody can act on. Requests already in " +
      "flight keep the version they were raised against.",
    input: publishRequestTypeInput,
    permission: "request_types:write",
    run: (input) => service.publishRequestType(input),
  }),

  action({
    subject: "request_type",
    operation: "get",
    description:
      "Read one request type as the designer shows it: its steps in order, each step's audiences " +
      "and routing rules in order (the position an audience or rule delete takes), its attributes " +
      "and general settings. `version` is Draft for the draft being designed, Published otherwise.",
    input: requestTypeReadInput,
    permission: "requests:read",
    run: async ({ code, version }) =>
      (await service.loadRequestTypeDetail(code, version === "Draft" ? "draft" : "published")) ?? { missing: code },
  }),

  action({
    subject: "request_type",
    operation: "delete",
    description:
      "Delete a request type with all its versions, draft and published. Set withRequests to " +
      "delete every request of it and their history too, which cannot be undone; without it a " +
      "type with requests is refused. Refused while work items, schedules, storyline steps, or " +
      "approvals and conversations on its requests still use it, and the refusal says which.",
    input: deleteRequestTypeInput,
    permission: "request_types:write",
    run: async (input) => {
      await service.deleteRequestType(input.code, input.withRequests);
      return { deleted: input.code };
    },
  }),

  action({
    subject: "request_type_step",
    operation: "create",
    description:
      "Add a transition step to the end of a draft request type's ordered flow, with an " +
      "optional SLA of its own.",
    input: stepInput,
    permission: "request_types:write",
    run: (input) => service.addStep(input),
  }),

  action({
    subject: "request_type_step",
    operation: "edit",
    description:
      "Change one step of a draft: its names, its SLA (a count and an interval, or null " +
      "for both to clear it), whether it is terminal and what it ends the request as. " +
      "Name only the fields to change; anything omitted is left alone and an explicit " +
      "null clears it. `expectedVersion` is the version last read — a step somebody has " +
      "saved since is refused, so read it again and retry. Marking a step terminal " +
      "discards its audiences and outgoing rules and needs the publish privilege. " +
      "Returns what changed, before and after.",
    input: updateStepInput,
    permission: "request_types:write",
    // T1 to rename a step, a decision when it makes one terminal: the server reads the
    // payload and escalates (D58), rather than the tool claiming one tier for both.
    escalates: (input) => sensitiveFieldsIn(input),
    run: (input) => service.updateStep(input),
  }),

  action({
    subject: "request_type_step",
    operation: "delete",
    description:
      "Delete a step from a draft. Rules that point at it are named first; pass confirmed " +
      "to go ahead once they have been read.",
    input: deleteStepInput,
    permission: "request_types:write",
    run: (input) => service.deleteStep(input),
  }),

  action({
    subject: "request_type_audience",
    operation: "create",
    description:
      "Give a step an audience and what it may do there: a person, an agent, a group, a " +
      "role, or the requester. An agent audience works the step itself when a request " +
      "reaches it.",
    input: audienceInput,
    permission: "request_types:write",
    run: (input) => service.addAudience(input),
  }),

  action({
    subject: "request_type_rule",
    operation: "create",
    description:
      "Add a routing rule out of a step — a condition on an attribute, or a named action — " +
      "and the step it routes to. An action rule with an expression routes that action only " +
      "while the expression holds, so one action can branch on attributes. Rules are tried in " +
      "order and the first match wins. A rule may point backwards.",
    input: ruleInput,
    permission: "request_types:write",
    run: (input) => service.addRule(input),
  }),

  action({
    subject: "request_type_rule",
    operation: "edit",
    description:
      "Change a routing rule of a draft step in place, by its 1-based position in the order the " +
      "step's rules are tried, as request_type_get (Draft) shows it: its kind, expression, " +
      "actionName or toStepName. Name only the fields to change; the rule keeps its place.",
    input: updateRuleInput,
    permission: "request_types:write",
    run: async (input) => {
      await service.updateRule(input);
      return { code: input.code, step: input.stepName, updated: input.position };
    },
  }),

  action({
    subject: "request_type_audience",
    operation: "delete",
    description:
      "Take an audience off a draft step, by its 1-based position in the step's audience list as " +
      "request_type_get (Draft) shows it.",
    input: stepEntryInput,
    permission: "request_types:write",
    run: async (input) => {
      await service.removeAudience(input);
      return { code: input.code, step: input.stepName, removed: input.position };
    },
  }),

  action({
    subject: "request_type_rule",
    operation: "delete",
    description:
      "Take a routing rule off a draft step, by its 1-based position in the order the step's rules " +
      "are tried, as request_type_get (Draft) shows it.",
    input: stepEntryInput,
    permission: "request_types:write",
    run: async (input) => {
      await service.removeRule(input);
      return { code: input.code, step: input.stepName, removed: input.position };
    },
  }),

  action({
    subject: "request_type_attribute",
    operation: "create",
    description:
      "Declare an attribute of a request type: its key, bilingual labels, data type and " +
      "whether it is required. An Enum (a list) needs enumValues, each a value with an English " +
      "and an Arabic label. With no stepName it is asked on the request form, which the agentic " +
      "entry extracts; with a stepName it is asked, and required, when that step's action is taken.",
    input: attributeInput,
    permission: "request_types:write",
    run: (input) => service.addAttribute(input),
  }),

  action({
    subject: "request_type_attribute",
    operation: "edit",
    description:
      "Change one attribute of a draft request type, by its key: its labels, data type, " +
      "whether it is required, a list's enumValues, stepName (null for the request form), or " +
      "position (from 1), its place in the order the form and the steps ask attributes in. " +
      "Name only the fields to change. The key itself does not change. Returns it before and after.",
    input: updateAttributeInput,
    permission: "request_types:write",
    run: (input) => service.updateAttribute(input),
  }),

  action({
    subject: "request_type_attribute",
    operation: "delete",
    description: "Remove an attribute from a draft request type.",
    input: removeAttributeInput,
    permission: "request_types:write",
    run: (input) => service.removeAttribute(input),
  }),

  action({
    subject: "request",
    operation: "create",
    description:
      "Raise a request of a published type, with its attributes filled in. It starts at " +
      "the first transition step. Set parentKey to raise it as a sub request of one you may " +
      "see. Returns the request key.",
    input: createRequestInput,
    permission: "requests:write",
    run: async (input) => ({ key: await service.createRequest(input) }),
  }),

  action({
    subject: "request_step_action",
    operation: "create",
    description:
      "Take an action on the step a request is at — the name of a routing rule out of it, " +
      "such as Approve — and let the rules decide where it goes next. Refused for someone " +
      "who is not a 'can act' audience of that step. Give values for the attributes the step " +
      "asks (request_type_get lists them by step) in attributes. Approving a request raised by " +
      "the person you act for waits for another person's approval first.",
    input: stepActionInput,
    permission: "requests:write",
    run: (input) => service.takeStepAction(input),
    escalates: (input, personId) => service.stepActionEscalates(input, personId),
  }),

  action({
    subject: "request_agent_assignment",
    operation: "create",
    // Starts another agent's mission on the step, so a person approves each one (D66).
    tier: "T2",
    description:
      "Assign the step a request is at to an agent, as the request's Assign to agent does: the " +
      "agent starts a run that works the step. Refused for someone who may not act on that step. " +
      "Says whether the run started, and why not.",
    input: assignRequestToAgentInput,
    permission: "requests:write",
    run: (input) => service.assignToAgent(input),
  }),

  action({
    subject: "request_change_request",
    operation: "create",
    description:
      "Return a request to its requester, at its first step, because details are missing or " +
      "incorrect. The comment is the whole instruction: say what to add or correct. Refused " +
      "for someone who is not a 'can act' audience of the step it is at.",
    input: decisionInput,
    permission: "requests:write",
    run: (input) => service.requestChanges(input.key, input.comment, input.attachments),
  }),

  action({
    subject: "request_rejection",
    operation: "create",
    description:
      "Reject a request at the step it is at, ending it as Rejected: it duplicates another or " +
      "is the wrong request. The comment says why. Where the step has a rejecting action of its " +
      "own, take that with request_step_action_create instead. Refused for someone who is not " +
      "a 'can act' audience of the step.",
    input: decisionInput,
    permission: "requests:write",
    run: async (input) => {
      await service.rejectRequest(input.key, input.comment, input.attachments);
      return { rejected: input.key };
    },
  }),

  action({
    subject: "request",
    operation: "list",
    description:
      "List the requests the person you act for may see, newest first: key, title, type, " +
      "project, status and when each was submitted, with how many match. Narrow it with " +
      "query (words in the title or key), status or typeCode, and page with limit and offset. " +
      "Use it to find a request that duplicates the one you are working, then read that one " +
      "with request_read.",
    input: z.object({
      query: z.string().max(200).optional(),
      status: z.string().max(40).optional(),
      typeCode: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    permission: "requests:read",
    run: async ({ query, status, typeCode, limit, offset }) => {
      const listed = await service.loadRequests({ q: query?.trim() || undefined, status, typeCode }, { limit, offset });
      return {
        total: listed.total,
        requests: listed.requests.map((request) => ({
          key: request.k,
          title: request.t,
          type: request.ty,
          project: request.p,
          status: request.st,
          submittedAt: request.submittedAt,
        })),
      };
    },
  }),

  action({
    subject: "request",
    operation: "delete",
    description:
      "Delete a request. Refused, saying what is in the way, while an approval, a conversation, a " +
      "child request, a schedule run or a work item still points at it.",
    input: requestKeyInput,
    permission: "requests:write",
    run: async ({ key }) => {
      await service.deleteRequest(key);
      return { key };
    },
  }),
];
