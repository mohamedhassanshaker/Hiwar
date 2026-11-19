import { LIVE_CHANNEL_TYPES } from "@/db/schema/enums";
import { isFeatureEnabled } from "@/features/governance/service";
import { moderatedRoom } from "@/features/rooms/service";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/session";
import { runChannelChecks } from "./channel-test";
import * as repository from "./repository";
import type { ChannelCheck, ConversationFilter } from "./types";
import type { ConfigureChannelInput, MirrorRoomInput, SetChannelEnabledInput, TestChannelInput } from "./schema";

export {
  StorylineRejected,
  createStoryline,
  requestTypeFields,
  saveStorylineStep,
  addStorylineStep,
  deleteStorylineStep,
  setStorylineMode,
  publishProblemsOf,
  publishStoryline,
  type SimulatedLine,
  simulateStoryline,
} from "./storyline-service";
export { ConversationRejected } from "./conversations-service";
export {
  loadDeployments,
  DeploymentRejected,
  createDeployment,
  saveDeployment,
  deploymentConversationCount,
  deleteDeployment,
} from "./deployment-service";

/** S-61 the channels, S-62 to S-65 the deployments, storylines and the widget. */

/** D342: one page of visitor conversations, newest first, and the deployments the filter offers. Requires `conversations:read` (D343). */
export async function loadConversations(filter: ConversationFilter, page: { limit: number; offset: number }) {
  await requirePermission("conversations:read");
  if (!(await isFeatureEnabled(FEATURE_FLAGS.embeddedDeployments))) return { enabled: false as const, rows: [], total: 0, deployments: [] };
  const [listed, deployments] = await Promise.all([repository.listConversations(filter, page), repository.listDeployments()]);
  return {
    enabled: true as const,
    ...listed,
    deployments: deployments.map((deployment) => ({ code: deployment.id, nameEn: deployment.n, nameAr: deployment.nAr })),
  };
}

/**
 * D344: the open conversations to watch beside one, the agent's and the person's own, never one
 * somebody else has taken over. Requires `conversations:read`.
 */
export async function loadActiveConversations() {
  const session = await requirePermission("conversations:read");
  return repository.listActiveConversations(session.personId, 50);
}

/** D344: whether the person may follow every conversation's activity. Requires `conversations:read`. */
export async function followConversations(): Promise<void> {
  await requirePermission("conversations:read");
}

/** D342: one visitor conversation with its whole transcript, or null. Requires `conversations:read` (D343). */
export async function loadConversation(id: string) {
  await requirePermission("conversations:read");
  const summary = await repository.readConversationSummary(id);
  if (!summary) return null;
  return { summary, lines: await repository.readTranscript(id) };
}

/** S-61 in one read: the list, each channel's configuration and what it may be bound to. */
export async function loadChannelBoard() {
  await requirePermission("channels:read");
  // The live channels are platform fixtures, not records someone adds: the board makes
  // sure each one has its disabled row before it reads, so Web widget and WhatsApp are
  // always there to configure rather than missing until a seed happens to create them.
  await repository.ensureLiveChannels();
  const [channels, targets] = await Promise.all([repository.listChannels(), repository.bindingTargets()]);
  const configs = await Promise.all(channels.map((channel) => repository.readChannelConfig(channel.type)));
  return {
    channels,
    targets,
    configs: Object.fromEntries(configs.filter((config) => config !== null).map((config) => [config.type, config])),
  };
}

/** This platform's own inbound webhook for a channel, which the test calls. */
export function inboundWebhookUrl(type: string): string {
  return `${env().APP_URL.replace(/\/$/, "")}/api/channels/${type}/inbound`;
}

/**
 * `UC-61.1-03` and `UC-61.1-05`: sends a real message and reports each check. The result is
 * stored, so an enabled channel whose checks failed shows as Degraded afterwards.
 */
export async function testChannel(input: TestChannelInput): Promise<ChannelCheck[]> {
  const session = await requirePermission("channels:write");
  const credentials = await repository.channelCredentials(input.type);
  if (!credentials) throw new Error(`No ${input.type} channel.`);

  const checks = await runChannelChecks({
    channelType: input.type,
    secret: credentials.secret,
    endpointUrl: credentials.endpointUrl,
    inboundUrl: inboundWebhookUrl(input.type),
    sendTo: input.sendTo,
    message: input.message,
  });

  await repository.recordChannelTest(input.type, checks, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "channels:test",
    objectType: "Channel",
    objectLabel: input.type,
    detail: { checks: checks.map((check) => ({ name: check.name, ok: check.ok })) },
  });
  return checks;
}


/**
 * Switches a channel on or off against the version the screen read, and audits it. Requires
 * `channels:write`; refuses a channel type the platform has not built.
 */
export async function setChannelEnabled(input: SetChannelEnabledInput): Promise<void> {
  const session = await requirePermission("channels:write");
  // `UC-61.1-10`: a channel the platform has not built cannot be switched on, whoever asks.
  if (!(LIVE_CHANNEL_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`${input.type} is not available yet.`);
  }
  await repository.setChannelEnabled(input.type, input.enabled, input.version, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "channels:write",
    objectType: "Channel",
    objectLabel: input.type,
    detail: { enabled: input.enabled },
  });
}

/**
 * Saves a channel's settings and binding, and audits them with whether the secret changed, never
 * the secret itself. Requires `channels:write`.
 */
export async function configureChannel(input: ConfigureChannelInput): Promise<void> {
  const session = await requirePermission("channels:write");
  await repository.configureChannel(input, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "channels:configure",
    objectType: "Channel",
    objectLabel: input.type,
    detail: {
      rateLimitPerMinute: input.rateLimitPerMinute,
      bindingType: input.bindingType,
      businessHours: input.businessHours,
      secretChanged: input.secret !== undefined,
    },
  });
}

/* ------------------------------------------- S-62 and S-63: the embedded deployments */

/** `UC-63.1-07`: conversations and rating over the last thirty days. */

/* ------------------------------------------------------- S-64: the storyline editor */

/* ----------------------------------------------- S-65: the widget, previewed in console */

/**
 * `UC-23.1-13`: links a room to a conversation on a channel.
 *
 * The channel has to be bound to the room mirror first, because that binding is what makes
 * an inbound message look for a room at all; without it the link would be one-way. Needs
 * `rooms:moderate` in the room's project.
 */
export async function mirrorRoom(input: MirrorRoomInput): Promise<void> {
  const { session } = await moderatedRoom(input.roomKey);
  if (!(await isFeatureEnabled(FEATURE_FLAGS.teamsMirror))) {
    throw new Error("Mirroring rooms to a channel is turned off in Settings.");
  }
  const channel = await repository.readChannelForInbound(input.channelType);
  if (!channel) throw new Error(`No ${input.channelType} channel.`);
  if (channel.bindingType !== "RoomMirror") {
    throw new Error(`The ${input.channelType} channel is not bound to discussion rooms.`);
  }

  await repository.setRoomMirror(input.roomKey, input.channelType, input.externalRef, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:moderate",
    objectType: "DiscussionRoom",
    objectLabel: input.roomKey,
    detail: { mirroredTo: input.channelType, conversation: input.externalRef },
  });
}
