import { createHmac, timingSafeEqual } from "node:crypto";

import { workingCalendarFor } from "@/features/schedules/service";
import { createFromConversation } from "@/features/requests/service";
import { postAsPrincipal } from "@/features/rooms/service";
import { logger } from "@/lib/logger";
import { egressFetch } from "@/lib/egress";
import { notifyDashboard } from "@/lib/live";
import { openConversation, takeTurn } from "./conversation";
import { INBOUND_NOTICE, inboundDecision } from "./inbound";
import * as repository from "./repository";
import { readState } from "./conversation-view";
import { degrade, messagesOf, type Lang } from "./protocol";

/**
 * The channel gateway (S-61).
 *
 * One inbound message, one decision, one record. What happens to a message that is handled
 * depends only on what the channel is bound to: an embedded deployment runs its storyline,
 * a room mirror puts the message in the room, and request intake raises a request. Nothing
 * here decides whether to handle it — `inboundDecision` does, and this carries it out.
 */

/** Which deployment surface a channel is, which is how a request type names its intake. */
const SURFACE: Record<string, string> = { WebWidget: "Widget", WhatsApp: "WhatsApp", MicrosoftTeams: "Teams" };

export type InboundMessage = {
  channelType: string;
  /** The provider's identifier for the sender: a phone number, or a Teams user. */
  senderKey: string;
  senderName: string;
  text: string;
  /** The provider's conversation identifier, which a mirrored room is matched on. */
  externalRef?: string | null;
};

export type InboundOutcome = {
  action: "Process" | "Offline" | "Throttled" | "Dropped";
  detail: string;
  /** What to send back to the sender, if anything. */
  replies: { en: string; ar: string }[];
};

/** Verifies that a webhook body really came from the provider. */
export function signatureMatches(secret: string, body: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const given = signature.replace(/^sha256=/i, "");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/**
 * Handles one inbound message.
 *
 * @returns what was done with it and what the sender is told. A refused message is recorded
 *   with its reason, which is what makes `UC-61.1-08` more than a silent drop.
 */
export async function handleInbound(message: InboundMessage, now = new Date()): Promise<InboundOutcome> {
  const channel = await repository.readChannelForInbound(message.channelType);
  if (!channel) return { action: "Dropped", detail: `There is no ${message.channelType} channel.`, replies: [] };

  const personId = await repository.personByEmail(message.senderKey);
  const known = personId !== null;
  const calendar = await workingCalendarFor(now.toISOString().slice(0, 10));
  const hours = await repository.workingHours();

  const decision = inboundDecision({
    channelType: channel.type,
    isEnabled: channel.isEnabled,
    businessHours: channel.businessHours,
    unknownSenders: channel.unknownSenders,
    senderKnown: known,
    rateLimitPerMinute: channel.rateLimitPerMinute,
    messagesInLastMinute: await repository.countInboundSince(channel.id, message.senderKey, new Date(now.getTime() - 60_000)),
    weekday: ((now.getUTCDay() + 6) % 7) + 1,
    minuteOfDay: now.getUTCHours() * 60 + now.getUTCMinutes(),
    workingDays: calendar.workingDays,
    isHoliday: calendar.isHoliday,
    workingHours: hours,
  });

  if (decision.action === "Dropped" || decision.action === "Throttled") {
    await repository.recordChannelMessage({
      channelId: channel.id,
      direction: "Inbound",
      senderKey: message.senderKey,
      bodyText: message.text,
      action: decision.action,
      detail: decision.detail,
    });
    const notice = decision.action === "Throttled" ? INBOUND_NOTICE.Throttled : null;
    return { action: decision.action, detail: decision.detail, replies: notice ? [{ en: notice[0], ar: notice[1] }] : [] };
  }

  const replies: { en: string; ar: string }[] = [];
  if (decision.action === "Offline") {
    replies.push({
      en: channel.offlineMessageEn ?? INBOUND_NOTICE.Offline[0],
      ar: channel.offlineMessageAr ?? INBOUND_NOTICE.Offline[1],
    });
  }

  const handled = await route(channel, message, personId, decision.action === "Offline");
  await repository.recordChannelMessage({
    channelId: channel.id,
    direction: "Inbound",
    senderKey: message.senderKey,
    bodyText: message.text,
    action: decision.action,
    detail: handled.detail,
    conversationId: handled.conversationId,
    roomId: handled.roomId,
    requestId: handled.requestId,
  });

  return { action: decision.action, detail: handled.detail, replies: [...replies, ...handled.replies] };
}

type Handled = {
  detail: string;
  replies: { en: string; ar: string }[];
  conversationId?: string | null;
  roomId?: string | null;
  requestId?: string | null;
};

/** What the channel's binding does with a message that is being handled. */
async function route(
  channel: NonNullable<Awaited<ReturnType<typeof repository.readChannelForInbound>>>,
  message: InboundMessage,
  personId: string | null,
  offline: boolean,
): Promise<Handled> {
  switch (channel.bindingType) {
    case "EmbeddedDeployment":
      return channel.bindingId ? deploymentBinding(channel, message, offline) : { detail: "The channel is bound to no deployment.", replies: [] };
    case "RoomMirror":
      return roomBinding(channel, message, personId);
    case "RequestIntake":
      return intakeBinding(channel, message);
    default:
      return { detail: "The channel is bound to nothing.", replies: [] };
  }
}

/** The storyline runs for the sender, exactly as it does for a visitor on the website. */
async function deploymentBinding(
  channel: { id: string; bindingId: string | null; type: string },
  message: InboundMessage,
  offline: boolean,
): Promise<Handled> {
  const code = channel.bindingId ? await repository.deploymentByChannelBinding(channel.bindingId) : null;
  if (!code) return { detail: "The channel is bound to a deployment that no longer exists.", replies: [] };

  const contactId = await repository.externalContactFor(channel.type, message.senderKey, message.senderName);
  const opened = await openConversation({
    deploymentCode: code,
    visitorKey: message.senderKey,
    origin: null,
    channelId: channel.id,
    externalContactId: contactId,
    // A channel sender is not a website visitor, so there is no origin to check.
    preview: true,
  });

  // Out of hours the message is taken in, and the script runs when the day starts rather
  // than answering as though somebody were there.
  if (offline) return { detail: "Taken in out of hours.", replies: [], conversationId: opened.conversationId };

  const view = await takeTurn({
    conversationId: opened.conversationId,
    visitorKey: message.senderKey,
    turn: { kind: "Reply", text: message.text },
    preview: true,
  });
  return {
    detail: `The ${code} storyline answered.`,
    replies: await channelReplies(view.conversationId),
    conversationId: view.conversationId,
  };
}

/**
 * What a channel that draws no controls is sent after a turn: the assistant's newest
 * messages as text, chips and lists numbered (widget specification 13.4).
 */
async function channelReplies(conversationId: string): Promise<{ en: string; ar: string }[]> {
  const conversation = await repository.readConversation(conversationId);
  if (!conversation) return [];
  const [lines, deployment, storyline] = await Promise.all([
    repository.readTranscript(conversationId),
    repository.readRunnableDeployment(conversation.deploymentCode),
    conversation.storylineVersionId ? repository.readRunnableStoryline(conversation.storylineVersionId) : Promise.resolve(null),
  ]);
  const runtime = readState(conversation.stateJson ?? {});
  const fresh = lines.slice(lines.map((line) => line.role).lastIndexOf("Visitor") + 1);
  const said = (lang: Lang) =>
    messagesOf({
      lines: fresh,
      state: runtime.engine,
      storyline,
      slots: runtime.engine.slots,
      quickActions: deployment?.quickActions ?? [],
      page: null,
      lang,
      pending: false,
      handoff: null,
      otpTarget: null,
      ended: conversation.outcome !== null,
      handoffAvailable: Boolean(deployment?.handoffQueue),
      agentPaused: conversation.agentPausedAt !== null,
    })
      .filter((message) => message.role !== "user")
      .map((message) => degrade(message.blocks, lang))
      .filter(Boolean);
  const english = said("en");
  const arabic = said("ar");
  return english.slice(-3).map((en, index) => ({ en, ar: arabic.slice(-3)[index] ?? en }));
}

/** `UC-23.1-13`: the message appears in the room it is mirrored to. */
async function roomBinding(
  channel: { id: string; type: string },
  message: InboundMessage,
  personId: string | null,
): Promise<Handled> {
  if (!message.externalRef) return { detail: "The message named no conversation to mirror.", replies: [] };
  const room = await repository.mirroredRoom(channel.id, message.externalRef);
  if (!room) return { detail: "No room is mirrored to this conversation.", replies: [] };

  const contactId = personId ?? (await repository.externalContactFor(channel.type, message.senderKey, message.senderName));
  await postAsPrincipal({
    roomKey: room.key,
    principalType: personId ? "Person" : "ExternalContact",
    principalId: contactId,
    text: message.text,
  });
  await notifyDashboard(`room ${room.key} mirrored a message from ${channel.type}`);
  return { detail: `Mirrored into ${room.key}.`, replies: [], roomId: room.id };
}

/** The message becomes a request of the type that takes this channel's intake. */
async function intakeBinding(channel: { id: string; type: string }, message: InboundMessage): Promise<Handled> {
  const surface = SURFACE[channel.type] ?? channel.type;
  const types = await repository.requestTypesForIntake(surface);
  if (types.length !== 1) {
    return {
      detail:
        types.length === 0
          ? `No published request type takes intake from ${surface}.`
          : `${types.length} request types take intake from ${surface}, so the message was not routed.`,
      replies: [],
    };
  }

  const contactId = await repository.externalContactFor(channel.type, message.senderKey, message.senderName);
  const title = message.text.slice(0, 120);
  try {
    const key = await createFromConversation({
      projectKey: types[0].projectKey,
      requestTypeCode: types[0].code,
      titleEn: title,
      titleAr: title,
      descriptionEn: message.text,
      attributes: {},
      externalContactId: contactId,
      channel: surface,
    });
    await notifyDashboard(`request ${key} raised from ${channel.type}`);
    return { detail: `Raised ${key}.`, replies: [{ en: `Your request is ${key}.`, ar: `رقم طلبك ${key}.` }] };
  } catch (problem) {
    logger().error({ problem, channel: channel.type }, "an inbound message could not be turned into a request");
    return { detail: "The request could not be raised.", replies: [] };
  }
}

/**
 * `UC-23.1-13`: a reply posted in a mirrored room goes back out to the channel.
 *
 * Never throws: a room keeps working when the mirror does not, and the failure is logged
 * rather than shown to the person who posted.
 */
export async function mirrorOutbound(roomId: string, text: string, author: string): Promise<void> {
  try {
    // A widget conversation handed over into this room hears the person's reply (widget
    // specification 12).
    const conversationId = await repository.conversationInRoom(roomId);
    if (conversationId) {
      await repository.appendConversationMessages(conversationId, [
        { role: "HumanAgent", kind: "Message", textEn: text, textAr: text, payload: { author } },
      ]);
    }
    const mirror = await repository.roomMirror(roomId);
    if (!mirror?.endpointUrl) return;
    const answer = await egressFetch(mirror.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(mirror.secret ? { authorization: `Bearer ${mirror.secret}` } : {}) },
      body: JSON.stringify({ to: mirror.externalRef, text: `${author}: ${text}` }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!answer.ok) logger().warn({ roomId, status: answer.status }, "the room mirror refused a reply");
  } catch (problem) {
    logger().warn({ problem, roomId }, "a room reply could not be mirrored");
  }
}

/** Whether a channel takes webhooks at all, and the secret its signature is checked with. */
export async function channelWebhook(channelType: string): Promise<{ isEnabled: boolean; inboundSecret: string | null } | null> {
  const channel = await repository.readChannelForInbound(channelType);
  return channel ? { isEnabled: channel.isEnabled, inboundSecret: channel.inboundSecret } : null;
}
