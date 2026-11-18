import { checkField } from "./fields";
import { verifyVisitorToken } from "./identity";
import * as repository from "./repository";
import { advance, newConversation } from "./storyline";
import { type Advance, type Choice, type Emission, type Storyline, type VisitorTurn } from "./storyline-types";
import { VisitorRefused, readState, view, type VisitorLine, type VisitorView, type RuntimeState } from "./conversation-view";
import { issueOtp, perform } from "./conversation-effects";
import { askAgent } from "./visitor-agent";
import { noteVisitorInRoom } from "@/features/rooms/service";

/**
 * The visitor runtime (S-65): the storyline engine joined to the database and to the
 * outside world.
 *
 * The engine decides; this performs. A visitor turn comes in, the engine says what to show
 * and what to do, the effects are carried out here, and whatever the engine says next is
 * written down. The widget, the designer's preview and an inbound channel message all come
 * through these two functions, so a storyline behaves the same wherever it runs.
 */

/** The window the per-visitor rate limit counts over (`UC-65.1-12`). */
const RATE_WINDOW_MS = 60_000;

/** The transcript lines the engine's emissions are written as, one each, in order. */
function linesOf(emissions: Emission[]): VisitorLine[] {
  return emissions.map((emission) => {
    switch (emission.kind) {
      case "Message":
        return { role: "Agent", kind: "Message", textEn: emission.en, textAr: emission.ar, payload: { verbatim: emission.verbatim } };
      case "Confirm":
        return { role: "Agent", kind: "Confirm", textEn: emission.en, textAr: emission.ar, payload: {} };
      case "QuickReplies":
        return { role: "Agent", kind: "QuickReplies", textEn: null, textAr: null, payload: { choices: emission.choices } };
      case "FormPrompt":
        return { role: "Agent", kind: "FormPrompt", textEn: null, textAr: null, payload: { fields: emission.fields } };
      case "OtpPrompt":
        return { role: "System", kind: "OtpPrompt", textEn: null, textAr: null, payload: { method: emission.method } };
      case "Verified":
        return { role: "System", kind: "Verified", textEn: null, textAr: null, payload: { method: emission.method } };
      case "HandoffOffer":
        return { role: "System", kind: "HandoffOffer", textEn: null, textAr: null, payload: {} };
      case "Reference":
        return { role: "Agent", kind: "Reference", textEn: emission.value, textAr: emission.value, payload: {} };
      case "Ended":
        return { role: "System", kind: "Ended", textEn: null, textAr: null, payload: { outcome: emission.outcome } };
    }
  });
}

/** `UC-65.1-10`: the widget loads only where the deployment says it may. */
function originAllowed(allowed: string[], origin: string | null): boolean {
  if (allowed.length === 0) return false;
  if (!origin) return false;
  return allowed.some((one) => one.replace(/\/$/, "").toLowerCase() === origin.replace(/\/$/, "").toLowerCase());
}

/**
 * The deployment a visitor opens, refused with `DeploymentOff` when it does not exist or is not
 * Enabled, and with `OriginNotAllowed` when the origin is checked and not allowed.
 */
async function deploymentOf(code: string, origin: string | null, options: { checkOrigin: boolean }) {
  const deployment = await repository.readRunnableDeployment(code);
  if (!deployment) throw new VisitorRefused("DeploymentOff", `No deployment ${code}.`, `لا يوجد تطبيق مضمّن بالرمز ${code}.`);
  if (deployment.status !== "Enabled") throw new VisitorRefused("DeploymentOff", "This assistant is not available.", "هذا المساعد غير متاح.");
  if (options.checkOrigin && !originAllowed(deployment.allowedOrigins, origin)) {
    throw new VisitorRefused("OriginNotAllowed", "This website is not allowed to load the assistant.", "هذا الموقع غير مسموح له بتحميل المساعد.");
  }
  return deployment;
}

/**
 * Opens a conversation, or returns the one this visitor already has open.
 *
 * @param input `origin` is the host page; `preview` is a designer running it from the
 *   console, which skips the origin check and surfaces the one-time code.
 */
export async function openConversation(input: {
  deploymentCode: string;
  visitorKey: string;
  origin: string | null;
  /** `UC-63.1-06`: the token the host site signed, when it works that way. */
  identityToken?: string | null;
  channelId?: string | null;
  externalContactId?: string | null;
  preview?: boolean;
}): Promise<VisitorView> {
  const deployment = await deploymentOf(input.deploymentCode, input.origin, { checkOrigin: !input.preview });

  // `UC-63.1-06`: a deployment that expects a signed visitor either gets one, or does what
  // it was configured to do without one.
  let visitorKey = input.visitorKey;
  if (!input.preview && deployment.visitorIdentity === "SignedJwt") {
    const secret = await repository.visitorTokenSecret(input.deploymentCode);
    const identified = input.identityToken && secret ? verifyVisitorToken(input.identityToken, secret) : null;
    if (identified) {
      visitorKey = `jwt:${identified.subject}`;
    } else if (deployment.visitorJwtFallback === "Refuse") {
      throw new VisitorRefused("IdentityRequired", "This assistant needs you to be signed in.", "يتطلب هذا المساعد تسجيل الدخول.");
    }
  }

  const existing = await repository.openConversationFor(deployment.id, visitorKey);
  if (existing) return view(existing.id, Boolean(input.preview));

  const versionId = deployment.activeStorylineVersionId;
  const conversationId = await repository.createConversation({
    deploymentId: deployment.id,
    storylineVersionId: versionId,
    visitorKey,
    channelId: input.channelId ?? null,
    externalContactId: input.externalContactId ?? null,
  });

  // The greeting carries the deployment's quick actions under it (widget specification 8).
  const welcome: VisitorLine[] =
    deployment.welcomeEn || deployment.quickActions.length
      ? [{ role: "Agent", kind: "Message", textEn: deployment.welcomeEn ?? "", textAr: deployment.welcomeAr ?? deployment.welcomeEn ?? "", payload: { welcome: true } }]
      : [];
  await repository.appendConversationMessages(conversationId, welcome);

  if (!versionId) {
    // A deployment with no published storyline still talks: it is a free conversation.
    await repository.saveConversationState({
      id: conversationId,
      state: { engine: newConversation() },
      slots: {},
      storylineVersionId: null,
      stepName: null,
      outcome: null,
      ended: false,
    });
    return view(conversationId, Boolean(input.preview));
  }

  const storyline = await repository.readRunnableStoryline(versionId);
  if (!storyline) throw new VisitorRefused("NoStoryline", "This assistant has no script to follow.", "لا يوجد سيناريو يتبعه هذا المساعد.");

  await settle(conversationId, storyline, { engine: newConversation() }, { kind: "Open" }, deployment.handoffQueue, versionId);
  return view(conversationId, Boolean(input.preview));
}

/**
 * A quick action, or the agent, starts one of the deployment's storylines in this
 * conversation (widget specification 8). Values given with it are checked like any other
 * answer and skip the steps that would ask for them.
 */
export async function startScenario(input: {
  conversationId: string;
  visitorKey: string;
  scenario: string;
  label: string;
  prefill?: Record<string, string>;
}): Promise<void> {
  const conversation = await repository.readConversation(input.conversationId);
  if (!conversation) throw new VisitorRefused("NoConversation", "This conversation no longer exists.", "لم تعد هذه المحادثة موجودة.");
  if (conversation.visitorKey !== input.visitorKey) throw new VisitorRefused("NotYours", "This conversation belongs to somebody else.", "هذه المحادثة تخص شخصاً آخر.");
  if (conversation.outcome !== null) throw new VisitorRefused("NoConversation", "This conversation has ended.", "انتهت هذه المحادثة.");
  const deployment = await repository.readRunnableDeployment(conversation.deploymentCode);
  if (!deployment) throw new VisitorRefused("DeploymentOff", "This assistant is not available.", "هذا المساعد غير متاح.");

  const versionId = await repository.publishedStorylineOf(deployment.id, input.scenario);
  if (!versionId) throw new VisitorRefused("NoStoryline", "That service is not available right now.", "هذه الخدمة غير متاحة الآن.");
  const storyline = await repository.readRunnableStoryline(versionId);
  if (!storyline) throw new VisitorRefused("NoStoryline", "That service is not available right now.", "هذه الخدمة غير متاحة الآن.");

  const slots: Record<string, string> = {};
  for (const [slot, value] of Object.entries(input.prefill ?? {})) {
    const spec = storyline.steps.find((step) => step.type === "Ask" && step.slot === slot)?.config.field;
    const checked = spec ? checkField(spec, value) : { ok: true as const, value };
    if (checked.ok) slots[slot] = checked.value;
  }

  await repository.appendConversationMessages(input.conversationId, [
    { role: "Visitor", kind: "Message", textEn: input.label, textAr: input.label, payload: { scenario: input.scenario } },
  ]);
  const previous = readState(conversation.stateJson ?? {});
  await settle(
    input.conversationId,
    storyline,
    { ...previous, engine: { ...newConversation(), slots, prefilled: Object.keys(slots) } },
    { kind: "Open" },
    deployment.handoffQueue,
    versionId,
  );
  await repository.recordWidgetEvent({
    deploymentId: deployment.id,
    conversationId: input.conversationId,
    name: "scenario.started",
    props: { scenario: input.scenario, entry: Object.keys(slots).length ? "typed" : "chip" },
  });
}

/** One visitor turn, performed and written down. */
export async function takeTurn(input: {
  conversationId: string;
  visitorKey: string;
  turn: VisitorTurn;
  preview?: boolean;
}): Promise<VisitorView> {
  const conversation = await repository.readConversation(input.conversationId);
  if (!conversation) throw new VisitorRefused("NoConversation", "This conversation no longer exists.", "لم تعد هذه المحادثة موجودة.");
  if (conversation.visitorKey !== input.visitorKey) throw new VisitorRefused("NotYours", "This conversation belongs to somebody else.", "هذه المحادثة تخص شخصاً آخر.");

  const deployment = await repository.readRunnableDeployment(conversation.deploymentCode);
  if (!deployment) throw new VisitorRefused("DeploymentOff", "This assistant is not available.", "هذا المساعد غير متاح.");

  // `UC-65.1-12`: counted over the visitor's own turns, so one busy visitor cannot be
  // throttled by another's traffic.
  const sent = await repository.countVisitorTurnsSince(deployment.id, input.visitorKey, new Date(Date.now() - RATE_WINDOW_MS));
  if (sent >= deployment.rateLimitPerVisitor) {
    throw new VisitorRefused("RateLimited", "You are sending messages faster than we can answer. Please wait a moment.", "ترسل الرسائل أسرع مما يمكننا الرد عليه. انتظر لحظة من فضلك.");
  }

  const storyline = conversation.storylineVersionId ? await repository.readRunnableStoryline(conversation.storylineVersionId) : null;
  const state = readState(conversation.stateJson ?? {});
  await repository.appendConversationMessages(input.conversationId, [visitorLine(input.turn, chosenAt(storyline, state.engine.stepName, input.turn))]);

  // Handed over: the visitor is talking to a person in the handoff room now, not to the
  // script or the agent (widget specification 12).
  if (conversation.outcome === "HandedOff" && conversation.roomId) {
    if (input.turn.kind === "Reply" && input.turn.text.trim() !== "") await noteVisitorInRoom(conversation.roomId, input.turn.text.trim());
    return view(input.conversationId, Boolean(input.preview));
  }

  // Taken over on the Conversations screen (D342): the person answers, so the script and the
  // agent do nothing with the turn but keep it in the transcript.
  if (conversation.agentPausedAt) return view(input.conversationId, Boolean(input.preview));

  if (!conversation.storylineVersionId) {
    // A free conversation: the deployment's agent answers what the visitor wrote (D221).
    if (input.turn.kind === "Reply" && input.turn.text.trim() !== "") await askAgent(input.conversationId, deployment, input.turn.text);
    return view(input.conversationId, Boolean(input.preview));
  }
  if (!storyline) throw new VisitorRefused("NoStoryline", "This assistant has no script to follow.", "لا يوجد سيناريو يتبعه هذا المساعد.");

  await settle(
    input.conversationId,
    storyline,
    state,
    input.turn,
    deployment.handoffQueue,
    conversation.storylineVersionId,
  );
  return view(input.conversationId, Boolean(input.preview));
}

/** `UC-65.1-14`: the rating asked for when a conversation ends. */
export async function rateConversation(conversationId: string, visitorKey: string, rating: number): Promise<void> {
  const conversation = await repository.readConversation(conversationId);
  if (!conversation || conversation.visitorKey !== visitorKey) throw new VisitorRefused("NotYours", "This conversation belongs to somebody else.", "هذه المحادثة تخص شخصاً آخر.");
  await repository.rateConversation(conversationId, rating);
}

/** The current step's choice a reply names by its value, as a tapped chip sends it. */
function chosenAt(storyline: Storyline | null, stepName: string | null, turn: VisitorTurn): Choice | null {
  if (turn.kind !== "Reply" || !storyline) return null;
  const step = storyline.steps.find((one) => one.name === stepName);
  return step?.config.choices?.find((choice) => choice.value === turn.text) ?? null;
}

/**
 * The transcript line a visitor turn is written as; a one-time code is never recorded. A tapped
 * choice reads as its label, with its value kept beside it.
 */
function visitorLine(turn: VisitorTurn, choice: Choice | null = null): VisitorLine {
  switch (turn.kind) {
    case "Reply":
      if (choice) return { role: "Visitor", kind: "Message", textEn: choice.en, textAr: choice.ar || choice.en, payload: { value: choice.value } };
      return { role: "Visitor", kind: "Message", textEn: turn.text, textAr: turn.text, payload: {} };
    case "Otp":
      // The code itself is never written down.
      return { role: "Visitor", kind: "Otp", textEn: null, textAr: null, payload: {} };
    case "Confirm":
      return { role: "Visitor", kind: "Confirm", textEn: "Yes, confirm", textAr: "نعم، تأكيد", payload: {} };
    case "Change":
      return { role: "Visitor", kind: "Change", textEn: "Change", textAr: "تعديل", payload: {} };
    case "TalkToPerson":
      return { role: "Visitor", kind: "TalkToPerson", textEn: "Talk to a person", textAr: "التحدث مع موظف", payload: {} };
    case "Form":
      return { role: "Visitor", kind: "Form", textEn: null, textAr: null, payload: { values: turn.values } };
    case "Back":
      return { role: "Visitor", kind: "Back", textEn: "Back", textAr: "رجوع", payload: {} };
    case "MainMenu":
      return { role: "Visitor", kind: "MainMenu", textEn: "Main menu", textAr: "القائمة الرئيسية", payload: {} };
    default:
      return { role: "Visitor", kind: turn.kind, textEn: null, textAr: null, payload: {} };
  }
}

/**
 * Runs the engine, performs whatever it asks for, and keeps going until the conversation is
 * waiting on the visitor or has ended.
 *
 * The loop is bounded by the number of steps: every effect either moves the conversation on
 * or ends it, so a script cannot keep the request open.
 */
async function settle(
  conversationId: string,
  storyline: Storyline,
  state: RuntimeState,
  turn: VisitorTurn,
  handoffQueue: string | null,
  storylineVersionId: string,
): Promise<void> {
  let runtime: RuntimeState = { ...state, handoffQueue: handoffQueue ?? state.handoffQueue };
  let result: Advance = advance(storyline, runtime.engine, turn);
  const lines: VisitorLine[] = [];

  for (let guard = 0; guard <= storyline.steps.length + 2; guard += 1) {
    runtime = { ...runtime, engine: result.state };
    lines.push(...linesOf(result.emissions));

    // Minting the code belongs to the runtime, not the engine: the engine only says that
    // the step is waiting for one.
    if (result.state.awaiting === "Otp" && !runtime.otp) {
      const otp = await issueOtp(conversationId, result.state);
      runtime = { ...runtime, otp };
      if (otp.undeliverable) {
        lines.push({
          role: "System",
          kind: "Message",
          textEn: "We could not send a one-time code.",
          textAr: "تعذر إرسال رمز التحقق.",
          payload: {},
        });
      }
    }

    if (result.effects.length === 0) break;

    const performed = await perform(conversationId, storyline, runtime, result.effects, turn);
    runtime = performed.runtime;
    lines.push(...performed.lines);
    if (!performed.resume) break;
    result = advance(storyline, runtime.engine, performed.resume);
  }

  await repository.appendConversationMessages(conversationId, lines);
  await recordProgress(conversationId, storyline, state.engine, runtime.engine);
  await repository.saveConversationState({
    id: conversationId,
    state: { ...runtime },
    slots: runtime.engine.slots,
    storylineVersionId,
    stepName: runtime.engine.stepName,
    outcome: runtime.engine.outcome,
    ended: runtime.engine.outcome !== null,
  });
}

/**
 * The scenario events a dashboard reads (widget specification 15): a step completed, a
 * value refused (never the value itself), the scenario ended.
 */
async function recordProgress(
  conversationId: string,
  storyline: Storyline,
  before: RuntimeState["engine"],
  after: RuntimeState["engine"],
): Promise<void> {
  const conversation = await repository.readConversation(conversationId);
  if (!conversation) return;
  const events: { name: string; props: Record<string, unknown> }[] = [];
  if (before.stepName && before.stepName !== after.stepName) {
    events.push({ name: "scenario.step_completed", props: { scenario: storyline.code, step: before.stepName, attempts: before.attempts[before.stepName] ?? 0 } });
  }
  if (before.stepName && (after.attempts[before.stepName] ?? 0) > (before.attempts[before.stepName] ?? 0)) {
    const step = storyline.steps.find((one) => one.name === before.stepName);
    events.push({ name: "scenario.validation_failed", props: { scenario: storyline.code, field: step?.slot ?? before.stepName } });
  }
  if (before.outcome === null && after.outcome !== null) {
    events.push({ name: "scenario.ended", props: { scenario: storyline.code, end: after.outcome, step: before.stepName } });
  } else if (before.stepName !== null && after.stepName === null && after.outcome === null) {
    // A Guided script that runs out keeps the conversation open for the agent; the scenario
    // itself is complete.
    events.push({ name: "scenario.ended", props: { scenario: storyline.code, end: "Completed", step: before.stepName } });
  }
  for (const event of events) {
    await repository.recordWidgetEvent({ deploymentId: conversation.deploymentId, conversationId, ...event });
  }
}
