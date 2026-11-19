import { z } from "zod";

import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import type { Deployment } from "./types";
import * as repository from "./repository";
import {
  addStepInput,
  createDeploymentInput,
  createStorylineInput,
  deleteStepInput,
  deploymentCodeInput,
  saveDeploymentInput,
  setModeInput,
  simulateInput,
  storylineStepInput,
  type SaveDeploymentInput,
} from "./schema";
import * as service from "./service";
import { scenariosForCaller, startScenarioForCaller } from "./scenario-service";

/**
 * S-61 to S-65 as tools: what the Engage screens do, offered to an agent working on
 * someone's behalf.
 *
 * A channel's configuration holds its provider credential and the policy for unknown
 * senders, so it stays a console action. Deployments and storylines are offered (D253): an
 * agent can build one end to end. What decides who reaches what through a deployment (its
 * allowed origins, visitor identity, JWT secret, the person its agent acts as, its default
 * agent, its surfaces and going live) is escalated to an approval by someone other than the
 * requester (`exposureChanges`), and so is publishing a storyline, whose steps name the tools
 * and agent a visitor's conversation runs with. The draft edits around them are T1.
 */
/** The fields of a deployment save that change who may reach what through it (D253). */
export function exposureChanges(input: SaveDeploymentInput, current: Deployment | undefined): string[] {
  if (!current) return [];
  const same = (left: readonly string[], right: readonly string[]) => [...left].sort().join("\n") === [...right].sort().join("\n");
  const changed: string[] = [];
  if (input.defaultAgentCode !== current.a) changed.push("defaultAgentCode");
  if (input.status === "Enabled" && current.st !== "Enabled") changed.push("status");
  if (!same(input.surfaces, current.surf ? current.surf.split(" · ") : [])) changed.push("surfaces");
  if (!same(input.allowedOrigins, current.allowedOrigins)) changed.push("allowedOrigins");
  if (input.visitorIdentity !== current.visitorIdentity) changed.push("visitorIdentity");
  if (input.visitorJwtFallback !== current.visitorJwtFallback) changed.push("visitorJwtFallback");
  if (input.visitorJwtSecret !== undefined) changed.push("visitorJwtSecret");
  if (input.runAsPersonId !== undefined && input.runAsPersonId !== current.runAs) changed.push("runAsPersonId");
  return changed;
}

export const ENGAGE_TOOLS: PlatformTool[] = [
  action({
    subject: "channel",
    operation: "list",
    description:
      "Every channel the platform speaks on, with its status, whether it is enabled, " +
      "what it is bound to, its rate limit, its unknown-sender and business-hours policy, " +
      "whether a credential is stored, and the result of its last test. Read this to say " +
      "why a message did not reach somebody.",
    input: z.object({}),
    permission: "channels:read",
    run: () => service.loadChannelBoard(),
  }),

  action({
    subject: "deployment",
    operation: "list",
    description:
      "Every embedded deployment: its code, names, default agent, status, surfaces, " +
      "allowed origins, visitor identity mode, handoff queue, widget appearance, its " +
      "storyline draft as the editor shows it, the snippet a host site pastes, and the " +
      "conversations and ratings of the last thirty days. Empty when embedded " +
      "deployments are turned off in Settings.",
    input: z.object({}),
    permission: "channels:read",
    run: () => service.loadDeployments(),
  }),

  action({
    subject: "deployment",
    operation: "create",
    description:
      "Create an embedded deployment with its code, bilingual names, default agent and the surfaces " +
      "it is published on. It starts as a draft; give it a storyline with `storyline_create` and " +
      "configure it with `deployment_edit`.",
    input: createDeploymentInput,
    permission: "channels:write",
    run: async (input) => {
      await service.createDeployment(input);
      return { code: input.code };
    },
  }),

  action({
    subject: "deployment",
    operation: "edit",
    description:
      "Save a deployment's whole configuration: names, default agent, status, surfaces, allowed " +
      "origins, visitor identity, handoff queue, the person its agent acts as (`runAsPersonId`), rate " +
      "limit, the widget's title, colour, welcome, disclaimer, quick actions, voice, read aloud and " +
      "timeouts. Read it with `deployment_list` first and send every field back with `version`; a " +
      "stale version is refused. Going live and anything that changes who may reach what waits for " +
      "a person's approval.",
    input: saveDeploymentInput,
    permission: "channels:write",
    authorisation: true,
    escalates: async (input) => exposureChanges(input, (await repository.listDeployments()).find((one) => one.id === input.code)),
    run: async (input) => {
      await service.saveDeployment(input);
      return { code: input.code };
    },
  }),

  action({
    subject: "deployment",
    operation: "delete",
    description:
      "Delete a deployment with its surfaces, storylines and conversation history. Refused while a " +
      "channel still binds to it.",
    input: deploymentCodeInput,
    permission: "channels:write",
    run: async ({ code }) => {
      await service.deleteDeployment(code);
      return { code };
    },
  }),

  action({
    subject: "storyline",
    operation: "create",
    description:
      "Give a deployment a storyline, as an empty draft. Without `storyline` it is the deployment's " +
      "own, under its code, which opens its conversations; with one, it is a further scenario its " +
      "quick actions start. Add steps with `storyline_step_create`.",
    input: createStorylineInput,
    permission: "channels:write",
    run: async ({ code, storyline }) => {
      await service.createStoryline(code, storyline);
      return { code: storyline?.code ?? code };
    },
  }),

  action({
    subject: "storyline",
    operation: "edit",
    description:
      "Set a storyline draft's mode: how its steps lead the visitor through the conversation. " +
      "Guided offers the steps and has the agent answer anything else the visitor writes; Strict takes only the steps.",
    input: setModeInput,
    permission: "channels:write",
    run: async (input) => {
      await service.setStorylineMode(input);
      return { code: input.code };
    },
  }),

  action({
    subject: "storyline_step",
    operation: "create",
    description:
      "Add a step to a storyline draft, named in lowercase, after the step named `afterName` (or " +
      "first). It starts as an empty Message step; give it its type and settings with " +
      "`storyline_step_edit`, which also says how to build a menu.",
    input: addStepInput,
    permission: "channels:write",
    run: async (input) => {
      await service.addStorylineStep(input);
      return { code: input.code, step: input.name };
    },
  }),

  action({
    subject: "storyline_step",
    operation: "edit",
    description:
      "Save one step of a storyline draft: its type, bilingual message, the slot it fills, attempts, " +
      "verification, handoff queue, the tools, skills and agent it runs with, the next step, what " +
      "happens on error, and its type's own settings in `config`. Send every field. `config` takes " +
      "only the keys its schema lists; any other is refused. A menu is two steps: an Ask step whose " +
      "`slot` stores the answer and whose `config.choices` the visitor sees as buttons, then a " +
      "Decide step, which shows nothing, routing on that slot with `config.branches` and " +
      "`config.otherwise`. For example Ask `menu` {slot: \"topic\", messageEn: \"What do you need?\", " +
      "nextStepName: \"route\", config: {choices: [{value: \"payments\", en: \"Payments\", ar: " +
      "\"المدفوعات\"}, {value: \"entities\", en: \"List entities\", ar: \"قائمة الجهات\"}]}}, then " +
      "Decide `route` {config: {branches: [{slot: \"topic\", equals: \"payments\", goto: " +
      "\"payments_menu\"}, {slot: \"topic\", equals: \"entities\", goto: \"list_entities\"}], " +
      "otherwise: \"menu\"}}.",
    input: storylineStepInput,
    permission: "channels:write",
    run: async (input) => {
      await service.saveStorylineStep(input);
      return { code: input.code, step: input.name };
    },
  }),

  action({
    subject: "storyline_step",
    operation: "delete",
    description: "Remove a step from a storyline draft. Returns the steps that pointed at it, which need a new next step.",
    input: deleteStepInput,
    permission: "channels:write",
    // A draft's step: nothing uses it until the storyline is published.
    tier: "T1",
    run: (input) => service.deleteStorylineStep(input),
  }),

  action({
    subject: "storyline",
    operation: "publish",
    description:
      "Publish a storyline draft as its next version, which visitors then talk to. Refused, listing " +
      "what blocks it, when the draft is not ready; read `storyline_problem_list` first.",
    input: deploymentCodeInput,
    permission: "channels:write",
    authorisation: true,
    run: async ({ code }) => ({ code, version: await service.publishStoryline(code) }),
  }),

  action({
    subject: "storyline_problem",
    operation: "list",
    description:
      "Everything that would block a storyline draft from being published: a step with no " +
      "way out, a missing Arabic message, a Tool step naming a tool its agent is not " +
      "allowed, and the rest. An empty list means the draft is ready. Read this before " +
      "asking a person to publish.",
    input: deploymentCodeInput,
    permission: "channels:read",
    run: async ({ code }) => ({ problems: await service.publishProblemsOf(code) }),
  }),

  action({
    subject: "storyline_simulation",
    operation: "create",
    description:
      "Play a storyline draft through against test variables and a list of visitor " +
      "replies, and read the conversation it produces, the slots it filled and how it " +
      "ended. Nothing is written and no tool is called: an effect is reported as having " +
      "succeeded, so what comes back is the path, not the plumbing. Send `fail` as a " +
      "reply to drive the step's On error path.",
    input: simulateInput,
    permission: "channels:write",
    // Nothing is stored and nothing outside the engine is called, so this is a read in
    // everything but the permission the service checks.
    tier: "T0",
    run: (input) => service.simulateStoryline(input),
  }),

  action({
    subject: "conversation_scenario",
    operation: "list",
    description:
      "When answering a website visitor: the services the website offers (its quick actions), " +
      "each with the scenario code that starts it. Refused in any other run.",
    input: z.object({}),
    permission: "agents:invoke",
    run: async () => ({ scenarios: await scenariosForCaller() }),
  }),

  action({
    subject: "conversation_scenario",
    operation: "create",
    description:
      "When answering a website visitor who asked for one of the website's services in their own " +
      "words, start that service's scenario in their conversation instead of answering yourself. " +
      "Pass every value they already gave under the name the scenario asks for it by, for example " +
      "`{ \"account\": \"1.23456789\" }`; each is checked like any other answer and the steps that " +
      "ask for it are skipped. Never guess a value. Get the codes from `conversation_scenario_list`.",
    input: z.object({
      scenario: z.string().trim().min(1).max(64),
      prefill: z.record(z.string(), z.string().max(400)).default({}),
    }),
    permission: "agents:invoke",
    run: (input) => startScenarioForCaller(input),
  }),
];
