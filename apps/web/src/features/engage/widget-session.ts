import { createHmac, randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { isFeatureEnabled } from "@/features/governance/service";
import { env } from "@/lib/env";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import { buckets, objectStoreConfigured, putObject } from "@/lib/objects";
import { bytesOfDataUrl, quarantineReason, uploadRefusal } from "@/lib/uploads";
import { readState, VisitorRefused, type RuntimeState } from "./conversation-view";
import { issueOtp } from "./conversation-effects";
import { openConversation, startScenario, takeTurn } from "./conversation";
import { checkField } from "./fields";
import { messagesOf, type Action, type Lang, type WidgetErrorCode, type WidgetMessage } from "./protocol";
import * as repository from "./repository";
import type { VisitorTurn } from "./storyline-types";

/**
 * The embedded widget's session (widget specification sections 5, 11 and 14, D231).
 *
 * A session is one conversation. The widget holds a short-lived token that names it, the
 * visitor's key and the identity level reached; every call presents it, and every call
 * returns a fresh one, so an active visitor never sees it expire and an idle one does.
 */

const ISSUER = "awp-widget";
const AUDIENCE = "awp-widget-session";
/** Specification 11.3: 30 minutes, sliding. */
const SESSION_TOKEN_SECONDS = 30 * 60;

export type IdentityLevel = "anonymous" | "otp_verified" | "logged_in";

export type SessionClaims = {
  conversationId: string;
  deploymentCode: string;
  visitorKey: string;
  lang: Lang;
  page: string | null;
  /** A designer's console preview: no origin check, and the one-time code is shown. */
  preview: boolean;
};

/** A refusal in the protocol's terms, in both languages, with the status the route answers. */
export class WidgetRefused extends Error {
  constructor(
    readonly code: WidgetErrorCode,
    message: string,
    readonly messageAr: string,
    readonly status: number,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "WidgetRefused";
  }
}

/** The signing key, derived from the platform secret for this one purpose. */
function key(): Uint8Array {
  const secret = env().AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set; no widget session can be signed");
  return new Uint8Array(createHmac("sha256", secret).update("awp-widget-session").digest());
}

/** A session token for these claims, HS256, with the conversation as subject, for 30 minutes. */
async function sign(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.conversationId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TOKEN_SECONDS}s`)
    .sign(key());
}

/** Reads a session token back, or refuses it as expired. */
export async function verifySession(token: string | null, conversationId?: string): Promise<SessionClaims> {
  if (!token) throw new WidgetRefused("SESSION_EXPIRED", "Your session ended for your security. Start again to continue.", "انتهت جلستك حفاظاً على أمانك. ابدأ من جديد للمتابعة.", 401);
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: AUDIENCE });
    const claims: SessionClaims = {
      conversationId: String(payload.conversationId),
      deploymentCode: String(payload.deploymentCode),
      visitorKey: String(payload.visitorKey),
      lang: payload.lang === "ar" ? "ar" : "en",
      page: payload.page ? String(payload.page) : null,
      preview: payload.preview === true,
    };
    if (conversationId && claims.conversationId !== conversationId) {
      throw new WidgetRefused("SESSION_EXPIRED", "This session is for another conversation.", "هذه الجلسة لمحادثة أخرى.", 403);
    }
    return claims;
  } catch (problem) {
    if (problem instanceof WidgetRefused) throw problem;
    throw new WidgetRefused("SESSION_EXPIRED", "Your session ended for your security. Start again to continue.", "انتهت جلستك حفاظاً على أمانك. ابدأ من جديد للمتابعة.", 401);
  }
}

/** The settings the widget draws itself from, in both languages. */
export type WidgetConfig = {
  deployment: string;
  title: { en: string; ar: string };
  accentColour: string | null;
  disclaimer: { en: string; ar: string; dismissible: boolean } | null;
  voiceInput: boolean;
  readAloud: boolean;
  idleMinutes: number;
  /** "Talk to a person" is offered only when the deployment has a handoff queue to send it to. */
  handoff: boolean;
};

export type SessionView = {
  sessionId: string;
  sessionToken: string;
  identityLevel: IdentityLevel;
  config: WidgetConfig;
  messages: WidgetMessage[];
  /** What the visitor may do next. */
  state: {
    ended: boolean;
    pending: boolean;
    awaiting: RuntimeState["engine"]["awaiting"];
    handoff: "queued" | "connected" | null;
    /** A half-finished scenario from earlier: the widget offers to continue it or start over. */
    resumable: boolean;
    rating: number | null;
  };
  /** Only in a console preview: the code the platform could not deliver anywhere. */
  previewOtp?: string;
};

/**
 * Rethrows a runtime refusal as a `WidgetRefused` with the protocol's code and status; a rate
 * limit carries a 60-second retry. Anything else is rethrown unchanged.
 */
function refusalOf(problem: unknown): never {
  if (problem instanceof VisitorRefused) {
    const map: Record<VisitorRefused["reason"], [WidgetErrorCode, number]> = {
      OriginNotAllowed: ["ORIGIN_NOT_ALLOWED", 403],
      DeploymentOff: ["DEPLOYMENT_DISABLED", 403],
      NoStoryline: ["NOT_FOUND", 404],
      NotYours: ["SESSION_EXPIRED", 403],
      RateLimited: ["RATE_LIMITED", 429],
      NoConversation: ["SESSION_EXPIRED", 404],
      IdentityRequired: ["IDENTITY_REQUIRED", 403],
    };
    const [code, status] = map[problem.reason];
    const retryAfter = code === "RATE_LIMITED" ? 60 : null;
    throw new WidgetRefused(code, problem.message, problem.messageAr, status, retryAfter);
  }
  throw problem;
}

/** The OTP's destination, shown masked: the visitor sees where the code went, not the number. */
function maskedTarget(slots: Record<string, string>): string | null {
  const address = slots.phone ?? slots.mobile ?? slots.email ?? null;
  if (!address) return null;
  if (address.includes("@")) {
    const [name, domain] = address.split("@");
    return `${name.slice(0, 1)}•••@${domain}`;
  }
  return `••••••${address.slice(-2)}`;
}

/** The session as the widget draws it, with a fresh token. */
export async function sessionView(claims: SessionClaims): Promise<SessionView> {
  const conversation = await repository.readConversation(claims.conversationId);
  if (!conversation) throw new WidgetRefused("SESSION_EXPIRED", "This conversation no longer exists.", "لم تعد هذه المحادثة موجودة.", 404);
  const deployment = await repository.readRunnableDeployment(conversation.deploymentCode);
  if (!deployment) throw new WidgetRefused("DEPLOYMENT_DISABLED", "This assistant is not available.", "هذا المساعد غير متاح.", 403);

  const runtime = readState(conversation.stateJson ?? {});
  const [lines, storyline, pending, room] = await Promise.all([
    repository.readTranscript(conversation.id),
    conversation.storylineVersionId ? repository.readRunnableStoryline(conversation.storylineVersionId) : Promise.resolve(null),
    repository.agentAnswering(conversation.id),
    repository.handoffStateOf(conversation.id),
  ]);
  const ended = conversation.outcome !== null && conversation.outcome !== "HandedOff";
  const handoff = room;

  const messages = messagesOf({
    lines,
    state: runtime.engine,
    storyline,
    slots: runtime.engine.slots,
    quickActions: deployment.quickActions,
    page: claims.page,
    lang: claims.lang,
    pending,
    handoff,
    otpTarget: maskedTarget(runtime.engine.slots),
    ended,
    handoffAvailable: deployment.handoffQueue !== null,
    agentPaused: conversation.agentPausedAt !== null,
  });

  return {
    sessionId: conversation.id,
    sessionToken: await sign(claims),
    identityLevel: runtime.engine.verified ? "otp_verified" : "anonymous",
    config: configOf(deployment),
    messages,
    state: {
      ended,
      pending,
      awaiting: runtime.engine.awaiting,
      handoff,
      resumable: Boolean(runtime.resumable) && !ended,
      rating: conversation.rating,
    },
    ...(claims.preview && runtime.otp?.preview ? { previewOtp: runtime.otp.preview } : {}),
  };
}

/** The widget's settings from a deployment; an empty Arabic text falls back to the English. */
function configOf(deployment: repository.RunnableDeployment): WidgetConfig {
  return {
    deployment: deployment.code,
    title: { en: deployment.widgetTitleEn || deployment.code, ar: deployment.widgetTitleAr || deployment.widgetTitleEn || deployment.code },
    accentColour: deployment.accentColour,
    disclaimer: deployment.disclaimerEn
      ? { en: deployment.disclaimerEn, ar: deployment.disclaimerAr || deployment.disclaimerEn, dismissible: deployment.disclaimerDismissible }
      : null,
    voiceInput: deployment.voiceInput,
    readAloud: deployment.readAloud,
    idleMinutes: deployment.sessionIdleMinutes,
    handoff: deployment.handoffQueue !== null,
  };
}

/** What the loader needs before a session exists: the launcher's title and the colours. */
export async function publicConfig(deploymentCode: string): Promise<WidgetConfig | null> {
  if (!(await isFeatureEnabled(FEATURE_FLAGS.embeddedDeployments))) return null;
  const deployment = await repository.readRunnableDeployment(deploymentCode);
  if (!deployment || deployment.status !== "Enabled") return null;
  return configOf(deployment);
}

/**
 * `POST /sessions`: start a session, or pick the visitor's earlier one back up.
 *
 * An earlier conversation is picked up while it is within the deployment's idle timeout, or
 * while a half-finished scenario in it is within the saved-progress retention; then the
 * widget offers to continue or start over. Anything older is ended and a new one opened.
 */
export async function startSession(input: {
  deploymentCode: string;
  lang: Lang;
  page: string | null;
  host: string | null;
  visitorKey: string | null;
  /** The designer running the console preview, whose key the preview's conversation is under. */
  previewBy: string | null;
}): Promise<SessionView> {
  const preview = input.previewBy !== null;
  // Settings → Feature flags turns every widget off at once (`UC-75.3-01`).
  const deployment = (await isFeatureEnabled(FEATURE_FLAGS.embeddedDeployments)) ? await repository.readRunnableDeployment(input.deploymentCode) : null;
  if (!deployment || deployment.status !== "Enabled") {
    throw new WidgetRefused("DEPLOYMENT_DISABLED", "This assistant is not available.", "هذا المساعد غير متاح.", 403);
  }
  if (!preview && !(await repository.surfaceEnabled(deployment.id, "Widget"))) {
    throw new WidgetRefused("DEPLOYMENT_DISABLED", "This assistant is not available on the web.", "هذا المساعد غير متاح على الويب.", 403);
  }
  const visitorKey = input.visitorKey && /^[A-Za-z0-9:_-]{8,128}$/.test(input.visitorKey) ? input.visitorKey : randomUUID();
  const scopedKey = preview ? `preview:${input.previewBy}:${visitorKey}` : visitorKey;

  const earlier = await repository.openConversationFor(deployment.id, scopedKey);
  if (earlier) {
    // A conversation nobody has written in yet was last active when it started.
    const last = (await repository.lastActivityOf(earlier.id)) ?? earlier.startedAt;
    const idleMs = Date.now() - last.getTime();
    const state = readState((earlier.stateJson ?? {}) as Record<string, unknown>);
    const inScenario = Boolean(earlier.storylineVersionId && state.engine.stepName && state.engine.outcome === null);
    const keep = idleMs < deployment.sessionIdleMinutes * 60_000 || (inScenario && idleMs < deployment.progressRetentionMinutes * 60_000);
    if (!keep) await repository.endConversation(earlier.id, "Abandoned");
    else if (inScenario && idleMs >= deployment.sessionIdleMinutes * 60_000) await repository.markResumable(earlier.id, true);
  }

  try {
    const opened = await openConversation({
      deploymentCode: input.deploymentCode,
      visitorKey: scopedKey,
      origin: input.host,
      preview,
    });
    await repository.setConversationLanguage(opened.conversationId, input.lang);
    await repository.recordWidgetEvent({
      deploymentId: deployment.id,
      conversationId: opened.conversationId,
      name: "widget.opened",
      props: { page: input.page, lang: input.lang },
    });
    return sessionView({
      conversationId: opened.conversationId,
      deploymentCode: input.deploymentCode,
      visitorKey: scopedKey,
      lang: input.lang,
      page: input.page,
      preview,
    });
  } catch (problem) {
    refusalOf(problem);
  }
}

/** Turns stay off a conversation that has ended: a new one is started instead. */
async function live(claims: SessionClaims) {
  const conversation = await repository.readConversation(claims.conversationId);
  if (!conversation || conversation.visitorKey !== claims.visitorKey) {
    throw new WidgetRefused("SESSION_EXPIRED", "This conversation belongs to somebody else.", "هذه المحادثة تخص شخصاً آخر.", 403);
  }
  return conversation;
}

/** One turn, refused in the protocol's terms. */
async function turn(claims: SessionClaims, visitorTurn: VisitorTurn): Promise<void> {
  try {
    await takeTurn({ conversationId: claims.conversationId, visitorKey: claims.visitorKey, turn: visitorTurn, preview: claims.preview });
  } catch (problem) {
    refusalOf(problem);
  }
}

/** `POST /sessions/{id}/messages`: text the visitor typed. A repeated `clientMessageId` is taken once. */
export async function sendMessage(claims: SessionClaims, text: string, clientMessageId: string | null): Promise<SessionView> {
  const conversation = await live(claims);
  const trimmed = text.trim();
  if (trimmed === "") throw new WidgetRefused("VALIDATION_FAILED", "Type a message first.", "اكتب رسالة أولاً.", 400);
  if (trimmed.length > 4000) throw new WidgetRefused("VALIDATION_FAILED", "That message is too long.", "هذه الرسالة طويلة جداً.", 400);
  if (clientMessageId && (await repository.seenClientMessage(conversation.id, clientMessageId))) return sessionView(claims);
  if (clientMessageId) await repository.rememberClientMessage(conversation.id, clientMessageId);
  await turn(claims, { kind: "Reply", text: trimmed });
  return sessionView(claims);
}

/** The step a stale button belonged to, which no longer is the one the conversation is on. */
async function refuseStale(claims: SessionClaims, step: string | null | undefined): Promise<void> {
  if (step === undefined) return;
  const conversation = await live(claims);
  const state = readState(conversation.stateJson ?? {});
  if ((step ?? null) !== (state.engine.stepName ?? null)) {
    throw new WidgetRefused("STALE_ACTION", "That option is no longer available.", "هذا الخيار لم يعد متاحاً.", 409);
  }
}

/** `POST /sessions/{id}/actions`: a chip, a button or a field's value (specification 6.4). */
export async function sendAction(claims: SessionClaims, action: Action): Promise<SessionView> {
  const conversation = await live(claims);
  const deployment = await repository.readRunnableDeployment(conversation.deploymentCode);
  if (!deployment) throw new WidgetRefused("DEPLOYMENT_DISABLED", "This assistant is not available.", "هذا المساعد غير متاح.", 403);

  switch (action.type) {
    case "postback":
      await refuseStale(claims, action.step);
      await turn(claims, { kind: "Reply", text: action.payload.text });
      break;
    case "field_submit": {
      await refuseStale(claims, action.step);
      const state = readState(conversation.stateJson ?? {});
      // A form arrives as JSON of its values; anything else is one value of one field.
      if (state.engine.awaiting === "Form") {
        let values: Record<string, string> = {};
        try {
          values = JSON.parse(action.value) as Record<string, string>;
        } catch {
          throw new WidgetRefused("VALIDATION_FAILED", "That form could not be read.", "تعذّرت قراءة هذا النموذج.", 400);
        }
        await turn(claims, { kind: "Form", values });
      } else {
        await turn(claims, { kind: "Reply", text: action.value });
      }
      break;
    }
    case "start_scenario": {
      const quick = deployment.quickActions.find((one) => one.storyline === action.scenario);
      const state = readState(conversation.stateJson ?? {});
      // Signing in (UAE PASS) is not available in the widget, so a logged-in action is refused
      // whatever the visitor verified; an OTP-verified one needs the OTP step first.
      if (quick && (quick.minIdentity === "logged_in" || (quick.minIdentity === "otp_verified" && !state.engine.verified))) {
        throw new WidgetRefused("IDENTITY_REQUIRED", "This needs you to verify yourself first.", "يتطلب هذا التحقق من هويتك أولاً.", 403);
      }
      try {
        await startScenario({ conversationId: claims.conversationId, visitorKey: claims.visitorKey, scenario: action.scenario, label: quick ? (claims.lang === "ar" ? quick.labelAr || quick.labelEn : quick.labelEn) : action.scenario });
      } catch (problem) {
        refusalOf(problem);
      }
      await repository.recordWidgetEvent({
        deploymentId: deployment.id,
        conversationId: claims.conversationId,
        name: "quick_action.clicked",
        props: { action: quick?.id ?? action.scenario, entry: "chip" },
      });
      break;
    }
    case "edit_field":
      await refuseStale(claims, action.step);
      await turn(claims, { kind: "EditField", field: action.field });
      break;
    case "confirm":
      await refuseStale(claims, action.step);
      await turn(claims, { kind: "Confirm" });
      break;
    case "cancel":
      await turn(claims, { kind: "Cancel" });
      break;
    case "back":
      await refuseStale(claims, action.step);
      await turn(claims, { kind: "Back" });
      break;
    case "main_menu":
      await refuseStale(claims, action.step);
      await turn(claims, { kind: "MainMenu" });
      break;
    case "handoff":
      // With no queue the conversation would be handed to nobody while the visitor is told a
      // person will continue.
      if (deployment.handoffQueue === null) throw new WidgetRefused("BAD_REQUEST", "Talking to a person is not available here.", "التحدث مع موظف غير متاح هنا.", 400);
      await turn(claims, { kind: "TalkToPerson" });
      await repository.recordWidgetEvent({
        deploymentId: deployment.id,
        conversationId: claims.conversationId,
        name: "scenario.handoff",
        props: { reason: action.reason, step: readState(conversation.stateJson ?? {}).engine.stepName },
      });
      break;
    case "show_example": {
      const storyline = conversation.storylineVersionId ? await repository.readRunnableStoryline(conversation.storylineVersionId) : null;
      const example = storyline?.steps.find((step) => step.slot === action.field)?.config.field?.example;
      if (example) {
        await repository.appendConversationMessages(conversation.id, [
          { role: "System", kind: "Message", textEn: `For example: ${example}`, textAr: `مثال: ${example}`, payload: {} },
        ]);
      }
      break;
    }
    case "restart":
      return restart(claims);
    case "load_more":
    case "open_url":
      break;
  }
  return sessionView(claims);
}

/** "Start a new conversation": the current one ends, and a new session starts. */
export async function restart(claims: SessionClaims): Promise<SessionView> {
  const conversation = await live(claims);
  if (conversation.outcome === null) await repository.endConversation(conversation.id, "Abandoned");
  const deployment = await repository.readRunnableDeployment(conversation.deploymentCode);
  const opened = await openConversation({
    deploymentCode: conversation.deploymentCode,
    visitorKey: claims.visitorKey,
    origin: null,
    // The origin was checked when the first session started; this one is the same visitor.
    preview: true,
  }).catch(refusalOf);
  if (deployment) {
    await repository.recordWidgetEvent({ deploymentId: deployment.id, conversationId: opened.conversationId, name: "widget.restarted", props: {} });
  }
  return sessionView({ ...claims, conversationId: opened.conversationId });
}

/** `POST /sessions/{id}/otp/send`: a new code, within the resend limit (specification 11.2). */
export async function resendOtp(claims: SessionClaims): Promise<SessionView> {
  const conversation = await live(claims);
  const runtime = readState(conversation.stateJson ?? {});
  if (runtime.engine.awaiting !== "Otp") throw new WidgetRefused("STALE_ACTION", "No code is being asked for.", "لا يُطلب رمز الآن.", 409);
  const resends = (runtime.otp?.resends ?? 0) + 1;
  if (resends > 3) throw new WidgetRefused("OTP_LOCKED", "Too many codes were sent. Try again in 15 minutes.", "أُرسلت رموز كثيرة. حاول مجدداً بعد 15 دقيقة.", 429, 15 * 60);
  const issued = await issueOtp(conversation.id, runtime.engine);
  await repository.saveRuntime(conversation.id, { ...runtime, otp: { ...issued, resends } });
  return sessionView(claims);
}

/**
 * `POST /sessions/{id}/otp/verify`: the code goes to the engine, never to a model, and is
 * not written into the transcript (specification 11.2).
 */
export async function verifyOtp(claims: SessionClaims, code: string): Promise<SessionView> {
  const conversation = await live(claims);
  const before = readState(conversation.stateJson ?? {});
  if (before.engine.awaiting !== "Otp") throw new WidgetRefused("STALE_ACTION", "No code is being asked for.", "لا يُطلب رمز الآن.", 409);
  if (!/^\d{6}$/.test(code)) throw new WidgetRefused("OTP_INVALID", "Enter the 6-digit code.", "أدخل الرمز المكوّن من 6 أرقام.", 400);
  if (before.otp && Date.now() > before.otp.expiresAt) {
    throw new WidgetRefused("OTP_EXPIRED", "The code has expired. Ask for a new one.", "انتهت صلاحية الرمز. اطلب رمزاً جديداً.", 400);
  }
  await turn(claims, { kind: "Otp", code });
  const after = readState((await live(claims)).stateJson ?? {});
  const deployment = await repository.readRunnableDeployment(conversation.deploymentCode);
  if (after.engine.verified) {
    if (deployment) {
      await repository.recordWidgetEvent({ deploymentId: deployment.id, conversationId: conversation.id, name: "identity.step_up", props: { method: "OTP", result: "verified" } });
    }
    return sessionView(claims);
  }
  if (after.engine.awaiting === "Otp" && after.otp) {
    const left = 3 - after.otp.attempts;
    throw new WidgetRefused("OTP_INVALID", `The code is not correct. ${left} ${left === 1 ? "attempt" : "attempts"} left.`, `الرمز غير صحيح. المحاولات المتبقية: ${left}.`, 400);
  }
  if (deployment) {
    await repository.recordWidgetEvent({ deploymentId: deployment.id, conversationId: conversation.id, name: "identity.step_up", props: { method: "OTP", result: "locked" } });
  }
  throw new WidgetRefused("OTP_LOCKED", "Too many wrong codes. The step was stopped for your security.", "رموز خاطئة كثيرة. أُوقفت الخطوة حفاظاً على أمانك.", 403);
}

/**
 * `POST /sessions/{id}/files`: a file for the current file step, scanned and stored on the
 * conversation. The id it returns is the step's value.
 */
export async function uploadForStep(claims: SessionClaims, name: string, dataUrl: string): Promise<{ fileId: string; view: SessionView }> {
  const conversation = await live(claims);
  const runtime = readState(conversation.stateJson ?? {});
  const storyline = conversation.storylineVersionId ? await repository.readRunnableStoryline(conversation.storylineVersionId) : null;
  const step = storyline?.steps.find((one) => one.name === runtime.engine.stepName);
  const spec = step?.config.field;
  if (runtime.engine.awaiting !== "Reply" || spec?.type !== "file") {
    throw new WidgetRefused("STALE_ACTION", "No file is being asked for.", "لا يُطلب ملف الآن.", 409);
  }
  const decoded = bytesOfDataUrl(dataUrl);
  if (!decoded) throw new WidgetRefused("VALIDATION_FAILED", "That file could not be read.", "تعذّرت قراءة هذا الملف.", 400);
  const maxBytes = (spec.maxSizeMb ?? 10) * 1024 * 1024;
  if (decoded.bytes.byteLength > maxBytes) {
    throw new WidgetRefused("VALIDATION_FAILED", `This file is larger than ${spec.maxSizeMb ?? 10} MB. Upload a smaller file or a photo.`, `هذا الملف أكبر من ${spec.maxSizeMb ?? 10} ميغابايت. ارفع ملفاً أصغر أو صورة.`, 400);
  }
  if (spec.accept?.length && !spec.accept.some((type) => decoded.mimeType === type || name.toLowerCase().endsWith(type.toLowerCase()))) {
    throw new WidgetRefused("VALIDATION_FAILED", "That type of file is not accepted here.", "هذا النوع من الملفات غير مقبول هنا.", 400);
  }
  const refusal = uploadRefusal({ name, mimeType: decoded.mimeType, size: decoded.bytes.byteLength });
  // The upload rules say why in both languages already.
  const invalid: WidgetErrorCode = "VALIDATION_FAILED";
  if (refusal) throw new WidgetRefused(invalid, refusal.en, refusal.ar, 400);
  const quarantined = quarantineReason(decoded.mimeType, decoded.bytes);
  if (quarantined) throw new WidgetRefused(invalid, quarantined.en, quarantined.ar, 400);
  if (!objectStoreConfigured()) throw new WidgetRefused("TOOL_UNAVAILABLE", "The file store is not available.", "مخزن الملفات غير متاح.", 503);

  const contentRef = await putObject(buckets.attachments, `conversations/${conversation.id}/${randomUUID()}-${name}`, decoded.bytes, decoded.mimeType);
  const fileId = await repository.insertConversationAttachment({
    conversationId: conversation.id,
    fileName: name,
    contentRef,
    size: decoded.bytes.byteLength,
    mimeType: decoded.mimeType,
  });
  return { fileId, view: await sessionView(claims) };
}

/** `POST /sessions/{id}/resume`: continue the saved scenario, or start over. */
export async function resume(claims: SessionClaims, choice: "continue" | "start_over"): Promise<SessionView> {
  const conversation = await live(claims);
  if (choice === "start_over") return restart(claims);
  await repository.markResumable(conversation.id, false);
  return sessionView(claims);
}

/** `DELETE /sessions/{id}`: the visitor ends the conversation. */
export async function endSession(claims: SessionClaims): Promise<void> {
  const conversation = await live(claims);
  if (conversation.outcome !== null) return;
  // A scenario ends through the engine; a free conversation has no engine to end it.
  await turn(claims, { kind: "Abandon" });
  await repository.endConversation(conversation.id, "Abandoned");
}

/** A thumbs up or down on one assistant message, and the rating at the end (specification 15). */
export async function feedback(claims: SessionClaims, input: { messageId?: string; value?: "up" | "down"; rating?: number }): Promise<SessionView> {
  const conversation = await live(claims);
  if (input.rating !== undefined) {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new WidgetRefused("VALIDATION_FAILED", "A rating is 1 to 5.", "التقييم من 1 إلى 5.", 400);
    }
    await repository.rateConversation(conversation.id, input.rating);
  }
  if (input.messageId && input.value) {
    const seq = Number(input.messageId.replace(/^msg_/, ""));
    if (!Number.isInteger(seq) || !(await repository.rateMessage(conversation.id, seq, input.value))) {
      throw new WidgetRefused("NOT_FOUND", "There is no such message.", "لا توجد رسالة كهذه.", 404);
    }
  }
  await repository.recordWidgetEvent({
    deploymentId: conversation.deploymentId,
    conversationId: conversation.id,
    name: "feedback.submitted",
    props: { rating: input.rating ?? null, value: input.value ?? null },
  });
  return sessionView(claims);
}

/** The events the widget itself sees (opened, closed); the server records the rest. */
export const CLIENT_EVENTS = ["widget.opened", "widget.closed", "widget.minimized", "widget.language"] as const;

/**
 * Records one event the widget reports for its own conversation, keeping only the string
 * properties shorter than 64 characters.
 */
export async function clientEvent(claims: SessionClaims, name: (typeof CLIENT_EVENTS)[number], props: Record<string, unknown>): Promise<void> {
  const conversation = await live(claims);
  const safe = Object.fromEntries(Object.entries(props).filter(([, value]) => typeof value === "string" && value.length < 64));
  await repository.recordWidgetEvent({ deploymentId: conversation.deploymentId, conversationId: conversation.id, name, props: safe });
}

/** Changes the session's language for the UI and for the agent's replies (specification 13.2). */
export async function setLanguage(claims: SessionClaims, lang: Lang): Promise<SessionView> {
  await live(claims);
  await repository.setConversationLanguage(claims.conversationId, lang);
  return sessionView({ ...claims, lang });
}

/** The validation a field step applies, for a widget asking before it sends (specification 10.2). */
export { checkField };

/** Logs a widget call's failure unless it is a `WidgetRefused`, which is an expected answer. */
export function logRefusal(problem: unknown): void {
  if (!(problem instanceof WidgetRefused)) logger().error({ problem: String(problem) }, "a widget call failed");
}
