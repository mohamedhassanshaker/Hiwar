import { z } from "zod";

import { loadDirectory } from "@/features/organisation/service";
import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { AgentRejected } from "./errors";
import { loadToolConfiguration } from "./tool-configuration-service";
import {
  activateVersionInput,
  cancelRunInput,
  changeSkillsInput,
  changeToolGrantInput,
  createAgentInput,
  deleteAgentInput,
  knowledgeAccessInput,
  memoryAccessInput,
  publishInput,
  replayInput,
  runListInput,
  runBudgetInput,
  saveDraftInput,
  setTrustInput,
  testAgentInput,
} from "./schema";
import * as service from "./service";

/**
 * S-50 and S-51 as tools: designing an agent on someone's behalf (D253).
 *
 * Every write changes what an agent may do, so each is T2 and marked `authorisation`: the
 * approval goes to the holders of `approvals:decide` other than the requester, in a room
 * too, and that person reads the exact payload; in the assistant panel the requester decides
 * it (D284). The service checks the acting person's own
 * `agents:write`, `agents:publish` or, for the built-in Assistant, `agents:configure`, so a
 * tool reaches no further than the person behind the run. Edits land on the agent's draft;
 * runs use the active version until `agent_publish`.
 */
export const AGENT_TOOLS: PlatformTool[] = [
  action({
    subject: "agent",
    operation: "list",
    description:
      "Every agent, with its code, names, org unit, version, model, status and profile, and what a " +
      "new agent may be given: the org units and the model routes. The code is how every other " +
      "agent tool names an agent.",
    input: z.object({}),
    permission: "agents:read",
    run: async () => {
      const [{ agents }, choices] = await Promise.all([loadDirectory(), service.loadAgentChoices()]);
      return {
        agents: agents.map(({ id, name, nameAr, unit, ver, model, status, profile }) => ({
          code: id,
          nameEn: name,
          nameAr,
          unit,
          version: ver,
          model,
          status,
          profile,
        })),
        ...choices,
      };
    },
  }),

  action({
    subject: "agent",
    operation: "get",
    description:
      "One agent's configuration as its draft stands: instructions, profile, model, trust, run " +
      "budget, `versionLock` (sent back by a trust or budget change), its skills and the published " +
      "skills it could add (`skillShelf`, by version id), its connector tools and those it could add " +
      "(`toolShelf`, by tool id), its knowledge collections and memory scopes (by id, each granted or " +
      "not), its platform tools (`platformTools`) and every platform tool it could be granted " +
      "(`platformCatalogue`), and its versions.",
    input: z.object({ code: z.string().trim().min(1) }),
    permission: "agents:read",
    run: async ({ code }) => {
      const detail = await service.loadAgent(code);
      if (!detail) throw new Error(`There is no agent ${code}.`);
      const configuration = await loadToolConfiguration(code);
      return {
        ...detail,
        platformTools: configuration?.granted ?? [],
        platformCatalogue: configuration?.catalogue.map(({ name, tier }) => ({ name, tier })) ?? [],
      };
    },
  }),

  action({
    subject: "agent",
    operation: "create",
    description:
      "Create an agent with its code, bilingual names, org unit, execution profile, trust and model " +
      "route (from `agent_list`). It starts as a draft with no tools or skills; give it instructions " +
      "with `agent_edit`, tools with `agent_tool_grant_edit` and skills with `agent_skill_edit`, then " +
      "`agent_publish`.",
    input: createAgentInput,
    permission: "agents:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => ({ code: await service.createAgent(input) }),
  }),

  action({
    subject: "agent",
    operation: "edit",
    description:
      "Change an agent's draft: its instructions, execution profile, primary and fallback model " +
      "routes, and whether it uses memory. Name only the fields to change.",
    input: saveDraftInput,
    permission: "agents:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => {
      await service.saveDraft(input);
      return { code: input.code };
    },
  }),

  action({
    subject: "agent_tool_grant",
    operation: "edit",
    description:
      "Grant an agent's draft tools and take tools away, in one change: platform tools by name " +
      "(`grantPlatform`, `revokePlatform`, from `platformCatalogue`) and connector tools by id " +
      "(`grantTools`, `revokeTools`, from `toolShelf` and `tools`). A granted connector tool that " +
      "reads (T0) runs on its own; any other needs approval on each call until a person changes its mode.",
    input: changeToolGrantInput,
    permission: "agents:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => {
      await service.changeToolGrant(input);
      return { code: input.code };
    },
  }),

  action({
    subject: "agent_skill",
    operation: "edit",
    description:
      "Add skills to an agent's draft and take skills away, in one change, by skill version id " +
      "(`add` from `skillShelf`, `remove` from `skills`).",
    input: changeSkillsInput,
    permission: "agents:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => {
      await service.changeSkills(input);
      return { code: input.code };
    },
  }),

  action({
    subject: "agent_knowledge_access",
    operation: "edit",
    description: "Let an agent's draft search a knowledge collection, or stop it, by collection id.",
    input: knowledgeAccessInput,
    permission: "agents:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => {
      await service.setKnowledgeAccess(input);
      return { code: input.code };
    },
  }),

  action({
    subject: "agent_memory_access",
    operation: "edit",
    description: "Give an agent's draft Read or ReadWrite access to a memory scope, or `null` to take it away.",
    input: memoryAccessInput,
    permission: "agents:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => {
      await service.setMemoryAccess(input);
      return { code: input.code };
    },
  }),

  action({
    subject: "agent_trust",
    operation: "edit",
    description:
      "Set an agent's trust level. `version` is the `versionLock` from `agent_get`; a stale one is " +
      "refused, so read again and retry. Returns the new lock.",
    input: setTrustInput,
    permission: "agents:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => ({ versionLock: await service.setTrust(input) }),
  }),

  action({
    subject: "agent_run_budget",
    operation: "edit",
    description:
      "Set an agent's soft and hard run budget in AED, or `null` for none. `version` is the " +
      "`versionLock` from `agent_get`. Returns the new lock.",
    input: runBudgetInput,
    permission: "agents:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => ({ versionLock: await service.setRunBudget(input) }),
  }),

  action({
    subject: "agent",
    operation: "publish",
    description:
      "Publish an agent's draft as its next version, with release notes. From then on its runs use " +
      "the new configuration. Refused, with the reason, when the draft is not ready.",
    input: publishInput,
    permission: "agents:publish",
    authorisation: true,
    run: async (input) => ({ code: input.code, version: await service.publishVersion(input) }),
  }),

  action({
    subject: "agent",
    operation: "rollback",
    description:
      "Make an earlier published version of an agent its active one, by version number. From then " +
      "on its runs use that version's configuration and grant.",
    input: activateVersionInput,
    permission: "agents:publish",
    authorisation: true,
    run: async (input) => {
      await service.activateVersion(input);
      return { code: input.code, version: input.versionNumber };
    },
  }),

  action({
    subject: "agent_test_run",
    operation: "create",
    // Starts another agent's mission, so a person approves each one (D66).
    tier: "T2",
    description:
      "Try an agent in the playground with a sample input and return its answer. " +
      "Waits up to a minute for it.",
    input: testAgentInput,
    permission: "agents:invoke",
    run: async (input) => ({ code: input.code, answer: await service.testAgent(input) }),
  }),

  action({
    subject: "run",
    operation: "list",
    description:
      "Runs, newest first, as the run list shows them: each run's key (`RUN-…`), agent code, status, " +
      "what a waiting run waits on, start and end times, the context it ran in (`contextType`, and " +
      "`contextKey` for a work item, room or request) and the run that delegated it (`parentRunKey`). " +
      "Filter by `agentCode` and `status`; `limit` is 50 unless given, at most 200.",
    input: runListInput,
    permission: "agents:read",
    run: async ({ agentCode, status, limit }) => ({
      runs: (await service.loadRuns({ agentCode, status, limit })).map((run) => ({
        key: run.id,
        agentCode: run.agent,
        status: run.st,
        waitingOn: run.waitingOn,
        startedAt: run.at,
        endedAt: run.endedAt,
        contextType: run.contextType,
        contextKey: run.contextKey,
        parentRunKey: run.parentRunKey,
      })),
    }),
  }),

  action({
    subject: "run",
    operation: "get",
    description:
      "One run by its key, as the run viewer shows it: its status and context, token and tool call " +
      "counts, how many approvals it waits on, and its timeline of model and tool steps with each " +
      "step's result.",
    input: cancelRunInput,
    permission: "agents:read",
    run: async ({ key }) => {
      const detail = await service.loadRun(key);
      if (!detail) throw new AgentRejected(`There is no run ${key}.`, `لا توجد عملية ${key}.`);
      return detail;
    },
  }),

  action({
    subject: "run_replay",
    operation: "create",
    // Starts another agent's mission, so a person approves each one (D66).
    tier: "T2",
    description:
      "Replay a run by its key, from the start or from a step, with a reason, as the run viewer's " +
      "Replay does. Returns the new run's key.",
    input: replayInput,
    permission: "agents:invoke",
    run: async (input) => ({ key: await service.replayRun(input) }),
  }),

  action({
    subject: "run",
    operation: "delete",
    description:
      "Delete a finished run by its key, with its steps, approvals and questions, for instance so an " +
      "agent whose runs are in the way can be deleted. Refused for a run still going; cancel it first. " +
      "What the run produced (messages, artifacts) stays.",
    input: cancelRunInput,
    permission: "agents:invoke",
    run: async ({ key }) => {
      await service.deleteRun(key);
      return { deleted: key };
    },
  }),

  action({
    subject: "run_cancellation",
    operation: "create",
    // Stops work somebody else may be waiting on, so a person approves each one (D67).
    tier: "T2",
    description:
      "Cancel a queued, running or waiting run by its key, as the run viewer's Cancel does: its " +
      "mission stops, and it ends Cancelled.",
    input: cancelRunInput,
    permission: "agents:invoke",
    run: async ({ key }) => {
      await service.cancelRun(key);
      return { cancelled: key };
    },
  }),

  action({
    subject: "agent",
    operation: "delete",
    description:
      "Delete an agent that has never been used. Refused, saying what is in the way, while anything " +
      "uses it: its runs are named by key (`run_list` with its `agentCode` lists them all, and " +
      "`run_delete` removes a finished one). The built-in Assistant cannot be deleted.",
    input: deleteAgentInput,
    permission: "agents:publish",
    authorisation: true,
    run: async ({ code }) => {
      await service.deleteAgent(code);
      return { code };
    },
  }),
];
