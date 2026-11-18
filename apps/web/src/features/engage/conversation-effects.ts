import { createHash, randomInt } from "node:crypto";

import { logger } from "@/lib/logger";
import { callConnectorTool } from "@/lib/connector-runtime";
import { egressFetch } from "@/lib/egress";
import { callOperation, resolveOperation } from "@/features/connectors/openapi-call";
import { viaRuntime } from "@/features/connectors/discovery-service";
import { createRoomWithTranscript } from "@/features/rooms/service";
import { createFromConversation } from "@/features/requests/service";
import * as repository from "./repository";
import { askAgent } from "./visitor-agent";
import { render } from "./storyline";
import { type Advance, type Choice, type Conversation, type Storyline, type VisitorTurn } from "./storyline-types";
import { type VisitorLine, type RuntimeState } from "./conversation-view";
import { presentResult } from "./protocol";

/** How long a one-time code is good for, and how many tries it gets (`UC-65.1-09`). */
const OTP_TTL_MS = 5 * 60_000;

const OTP_ATTEMPTS = 3;

const OTP_RESENDS = 2;

function digest(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** A fresh one-time code, delivered where the conversation can reach the visitor. */
export async function issueOtp(conversationId: string, state: Conversation): Promise<NonNullable<RuntimeState["otp"]>> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const address = state.slots.phone ?? state.slots.email ?? state.slots.mobile ?? null;
  const delivered = await deliverOtp(conversationId, address, code);
  return {
    hash: digest(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    resends: 0,
    undeliverable: !delivered,
    // Kept so a designer running the preview can finish their own simulation; the public
    // widget never returns it.
    preview: code,
  };
}

/** Sends the code over the channel the conversation arrived on, when there is one. */
async function deliverOtp(conversationId: string, address: string | null, code: string): Promise<boolean> {
  const conversation = await repository.readConversation(conversationId);
  if (!conversation?.channelId || !address) return false;
  const credentials = await repository.channelCredentialsById(conversation.channelId);
  if (!credentials?.endpointUrl) return false;
  try {
    const answer = await egressFetch(credentials.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(credentials.secret ? { authorization: `Bearer ${credentials.secret}` } : {}) },
      body: JSON.stringify({ to: address, text: `Your one-time code is ${code}.` }),
      signal: AbortSignal.timeout(5_000),
    });
    return answer.ok;
  } catch (problem) {
    logger().warn({ problem, conversationId }, "the one-time code could not be delivered");
    return false;
  }
}

/** Carries out the effects of one engine step and says how to resume. */
export async function perform(
  conversationId: string,
  storyline: Storyline,
  runtime: RuntimeState,
  effects: Advance["effects"],
  turn: VisitorTurn,
): Promise<{ runtime: RuntimeState; lines: VisitorLine[]; resume: VisitorTurn | null }> {
  const lines: VisitorLine[] = [];
  let next: RuntimeState = runtime;

  for (const effect of effects) {
    switch (effect.kind) {
      case "VerifyOtp": {
        const checked = checkOtp(next, effect.code);
        next = checked.runtime;
        if (!checked.ok && checked.mayRetry) {
          lines.push({
            role: "System",
            kind: "Message",
            textEn: "That code is not right. Try again.",
            textAr: "الرمز غير صحيح. حاول مرة أخرى.",
            payload: {},
          });
          return { runtime: next, lines, resume: null };
        }
        return { runtime: next, lines, resume: { kind: "Resume", ok: checked.ok } };
      }

      case "Tool": {
        const outcome = await runTools(effect.refs, next.engine.slots);
        // A step that presents its result shows it in the widget (specification 6.2).
        const present = storyline.steps.find((step) => step.name === effect.step)?.config.present;
        if (outcome.ok && present) {
          lines.push({ role: "Agent", kind: "Blocks", textEn: null, textAr: null, payload: { blocks: presentResult(present, outcome.data, effect.step) } });
        }
        return { runtime: next, lines, resume: { kind: "Resume", ok: outcome.ok, slots: outcome.slots } };
      }

      case "Skill":
        // A skill is instruction rather than a call: the step records which ones applied.
        return { runtime: next, lines, resume: { kind: "Resume", ok: true } };

      case "Classify": {
        const matched = classify(effect.choices, lastVisitorText(turn));
        return {
          runtime: next,
          lines,
          resume: { kind: "Resume", ok: matched !== null, slots: effect.slot && matched ? { [effect.slot]: matched } : undefined },
        };
      }

      case "CreateWork": {
        const reference = await raiseRequest(conversationId, storyline, effect.requestTypeCode, effect.slots);
        return { runtime: next, lines, resume: { kind: "Resume", ok: reference !== null, reference: reference ?? undefined } };
      }

      case "Handoff": {
        await handOver(conversationId, effect.queue ?? next.handoffQueue ?? null);
        return { runtime: next, lines, resume: null };
      }

      case "Wait":
        return { runtime: next, lines, resume: { kind: "Resume", ok: true } };

      case "Subflow":
        // Nothing runs a subflow yet, so the step follows its own On error rather than
        // pretending it succeeded.
        return { runtime: next, lines, resume: { kind: "Resume", ok: false } };

      case "SideAnswer": {
        // Guided mode answers off-script questions, and a request the script ended without
        // acting on, with the deployment's agent, acting as its identity (D221, D339). The engine
        // has already put the conversation where it belongs; the reply is written when the run ends.
        const conversation = await repository.readConversation(conversationId);
        const deployment = conversation ? await repository.readRunnableDeployment(conversation.deploymentCode) : null;
        if (deployment) await askAgent(conversationId, deployment, effect.text);
        return { runtime: next, lines, resume: null };
      }
    }
  }
  return { runtime: next, lines, resume: null };
}

function lastVisitorText(turn: VisitorTurn): string {
  return turn.kind === "Reply" ? turn.text : "";
}

/** Matches free text to one of a Classify step's choices. */
function classify(choices: Choice[], text: string): string | null {
  const typed = text.trim().toLowerCase();
  if (typed === "") return null;
  const hit = choices.find((choice) => [choice.value, choice.en, choice.ar].some((label) => label.toLowerCase() === typed));
  return hit?.value ?? null;
}

/**
 * Checks a typed one-time code against the stored hash. A match or an expired code clears the
 * code; a wrong one counts an attempt. `mayRetry` says whether the visitor may try again: within
 * `OTP_ATTEMPTS` for a wrong code, within `OTP_RESENDS` for an expired one.
 */
function checkOtp(runtime: RuntimeState, code: string): { runtime: RuntimeState; ok: boolean; mayRetry: boolean } {
  const otp = runtime.otp;
  if (!otp) return { runtime, ok: false, mayRetry: false };
  if (Date.now() > otp.expiresAt) {
    const resends = otp.resends + 1;
    // `UC-65.1-09`: an expired code may be sent again, within limits.
    return { runtime: { ...runtime, otp: undefined }, ok: false, mayRetry: resends <= OTP_RESENDS };
  }
  if (digest(code) === otp.hash) return { runtime: { ...runtime, otp: undefined }, ok: true, mayRetry: false };
  const attempts = otp.attempts + 1;
  return { runtime: { ...runtime, otp: { ...otp, attempts } }, ok: false, mayRetry: attempts < OTP_ATTEMPTS };
}

/** Runs a Tool step's `connector/tool` references with the slots as arguments. */
async function runTools(refs: string[], slots: Record<string, string>): Promise<{ ok: boolean; slots: Record<string, string>; data: unknown }> {
  const collected: Record<string, string> = {};
  let data: unknown = null;
  for (const ref of refs) {
    const [connectorCode, ...rest] = ref.split("/");
    const name = rest.join("/");
    if (!connectorCode || !name) return { ok: false, slots: collected, data };
    try {
      // An OpenAPI connector's operation is issued here, where its credential is stored; an
      // MCP connector's tool goes to the connector runtime (D223).
      const operation = (await repository.connectorTransport(connectorCode)) === "OpenApi" ? await resolveOperation(connectorCode, name) : null;
      const result = operation
        ? await callOperation(operation, slots).then((answer) => {
            if (!answer.ok) throw new Error(`${ref} answered ${answer.status}`);
            return { structured: answer.body, content: answer.body };
          })
        : await viaRuntime(connectorCode, () => callConnectorTool(connectorCode, name, slots));
      const structured = result.structured;
      data = structured ?? result.content;
      if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        for (const [key, value] of Object.entries(structured as Record<string, unknown>)) {
          if (typeof value === "string" || typeof value === "number") collected[key] = String(value);
        }
      }
    } catch (problem) {
      logger().warn({ problem, ref }, "a storyline tool step failed");
      return { ok: false, slots: collected, data };
    }
  }
  return { ok: true, slots: collected, data };
}

/** `UC-65.1-04`: the Create work step raises the request and returns its reference. */
async function raiseRequest(
  conversationId: string,
  storyline: Storyline,
  requestTypeCode: string | null,
  slots: Record<string, string>,
): Promise<string | null> {
  if (!requestTypeCode) return null;
  const conversation = await repository.readConversation(conversationId);
  if (!conversation) return null;

  const project = await repository.projectForRequestType(requestTypeCode);
  if (!project || !conversation.externalContactId) return null;

  const title = `${storyline.code} from the ${conversation.deploymentCode} assistant`;
  try {
    const key = await createFromConversation({
      projectKey: project,
      requestTypeCode,
      titleEn: title,
      titleAr: title,
      descriptionEn: Object.entries(slots)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\n"),
      attributes: slots,
      externalContactId: conversation.externalContactId,
      channel: "Widget",
    });
    await repository.linkConversationRequest(conversationId, key);
    return key;
  } catch (problem) {
    logger().error({ problem, conversationId, requestTypeCode }, "a storyline could not raise its request");
    return null;
  }
}

/**
 * `UC-65.1-08`: the conversation moves to the handoff queue with its context.
 *
 * The queue is a project, so the handoff is a discussion room in it carrying the whole
 * transcript. The project's own members then see it where they see everything else.
 */
async function handOver(conversationId: string, queue: string | null): Promise<void> {
  const conversation = await repository.readConversation(conversationId);
  if (!conversation || !queue) return;
  const owner = await repository.projectOwner(queue);
  if (!owner) {
    logger().warn({ conversationId, queue }, "a handoff names a queue that is not a project");
    return;
  }

  const transcript = await repository.readTranscript(conversationId);
  const roomKey = await createRoomWithTranscript({
    projectKey: queue,
    actingPersonId: owner,
    titleEn: `Handover from the ${conversation.deploymentCode} assistant`,
    transcript: transcript.map((line) => `${line.role}: ${render(line.textEn, {}) || line.kind}`),
  });

  const roomId = await repository.roomIdByKey(roomKey);
  if (roomId) await repository.linkConversationRoom(conversationId, roomId);
}
