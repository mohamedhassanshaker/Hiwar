import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { LIVE_CHANNEL_TYPES } from "@/db/schema/enums";
import { outer } from "@/db/outer";
import { assertWritten } from "@/lib/concurrency";
import { decrypt, encrypt } from "@/lib/crypto";
import { likeLiteral } from "@/db/search";
import { channels, publish } from "@/lib/valkey";
import type { Step as EngineStep, Storyline as EngineStoryline } from "./storyline-types";
import type {
  Channel,
  ChannelCheck,
  ChannelConfig,
  ConversationFilter,
  ConversationRow,
  ConversationStatus,
  ConversationSummary,
  ActiveConversation,
  Deployment,
  DeploymentStats,
  QuickAction as DeploymentQuickAction,
  ScenarioStats,
  TranscriptLine,
} from "./types";

export type { ActiveConversation, ConversationFilter, ConversationRow, ConversationStatus, ConversationSummary, TranscriptLine } from "./types";

/** The only module in `engage` that touches Drizzle. */

/**
 * Every channel the platform has built exists as a row, whether or not anyone has touched
 * it: there is no "add a channel" step, so a missing row would be a channel nobody can
 * reach. Disabled and unbound until someone configures it. Idempotent.
 */
export async function ensureLiveChannels(): Promise<void> {
  await db()
    .insert(s.channel)
    .values(LIVE_CHANNEL_TYPES.map((type) => ({ type, isEnabled: false, status: "Disabled" })))
    .onConflictDoNothing({ target: s.channel.type });
}

/**
 * S-61's list: every channel row by type, with its switch, its status and a bilingual label for
 * what it is bound to. A binding that is neither a deployment nor the room mirror reads as
 * Request intake.
 */
export async function listChannels(): Promise<Channel[]> {
  const rows = await dbRo()
    .select({
      type: s.channel.type,
      on: s.channel.isEnabled,
      st: s.channel.status,
      bindingType: s.channel.bindingType,
      deploymentEn: sql<string | null>`(select d.name_en from ai.embedded_deployment d where d.id = ${outer(s.channel.bindingId)})`,
      deploymentAr: sql<string | null>`(select d.name_ar from ai.embedded_deployment d where d.id = ${outer(s.channel.bindingId)})`,
    })
    .from(s.channel)
    .orderBy(asc(s.channel.type));

  return rows.map((row) => ({
    type: row.type,
    on: row.on,
    st: row.st,
    boundToEn:
      row.bindingType === "EmbeddedDeployment"
        ? `Embedded deployment: ${row.deploymentEn ?? ""}`
        : row.bindingType === "RoomMirror"
          ? "Discussion rooms (mirror)"
          : "Request intake",
    boundToAr:
      row.bindingType === "EmbeddedDeployment"
        ? `نشر مضمّن: ${row.deploymentAr ?? ""}`
        : row.bindingType === "RoomMirror"
          ? "اجتماعات العمل (مرآة)"
          : "استقبال الطلبات",
  }));
}

const conversationCount = sql<number>`(
  select count(*) from ai.deployment_conversation c where c.deployment_id = ${s.embeddedDeployment.id}
)::int`;

const averageRating = sql<number>`(
  select coalesce(round(avg(c.rating)::numeric, 1), 0) from ai.deployment_conversation c
  where c.deployment_id = ${s.embeddedDeployment.id} and c.rating is not null
)::float8`;

/**
 * S-62's list: every deployment by English name, identified by its code, with its default agent,
 * settings, surfaces, storyline codes, the active storyline as `code vN · mode`, and its
 * conversation count and average rating over all time.
 */
export async function listDeployments(): Promise<Deployment[]> {
  const rows = await dbRo()
    .select({
      id: s.embeddedDeployment.id,
      code: s.embeddedDeployment.code,
      n: s.embeddedDeployment.nameEn,
      nAr: s.embeddedDeployment.nameAr,
      a: s.agent.code,
      st: s.embeddedDeployment.status,
      allowedOrigins: s.embeddedDeployment.allowedOrigins,
      visitorIdentity: s.embeddedDeployment.visitorIdentity,
      visitorJwtFallback: s.embeddedDeployment.visitorJwtFallback,
      handoffQueue: s.embeddedDeployment.handoffQueue,
      rateLimitPerVisitor: s.embeddedDeployment.rateLimitPerVisitor,
      widgetTitleEn: s.embeddedDeployment.widgetTitleEn,
      widgetTitleAr: s.embeddedDeployment.widgetTitleAr,
      accentColour: s.embeddedDeployment.accentColour,
      welcomeEn: s.embeddedDeployment.welcomeMessageEn,
      welcomeAr: s.embeddedDeployment.welcomeMessageAr,
      runAs: s.embeddedDeployment.runAsPersonId,
      disclaimerEn: s.embeddedDeployment.disclaimerEn,
      disclaimerAr: s.embeddedDeployment.disclaimerAr,
      disclaimerDismissible: s.embeddedDeployment.disclaimerDismissible,
      quickActions: s.embeddedDeployment.quickActionsJson,
      voiceInput: s.embeddedDeployment.voiceInput,
      readAloud: s.embeddedDeployment.readAloud,
      sessionIdleMinutes: s.embeddedDeployment.sessionIdleMinutes,
      progressRetentionMinutes: s.embeddedDeployment.progressRetentionMinutes,
      storylines: sql<string[]>`coalesce((
        select array_agg(sl.code order by sl.code) from ai.storyline sl where sl.deployment_id = ${s.embeddedDeployment.id}
      ), '{}')`,
      storyline: sql<string | null>`(
        select sl.code || ' v' || sv.version_number || ' · ' || lower(sv.mode)
        from ai.storyline_version sv join ai.storyline sl on sl.id = sv.storyline_id
        where sv.id = ${s.embeddedDeployment.activeStorylineVersionId}
      )`,
      conv: conversationCount,
      rate: averageRating,
      version: s.embeddedDeployment.version,
    })
    .from(s.embeddedDeployment)
    .leftJoin(s.agent, eq(s.agent.id, s.embeddedDeployment.defaultAgentId))
    .orderBy(asc(s.embeddedDeployment.nameEn));

  const surfaces = rows.length
    ? await dbRo()
        .select({ deploymentId: s.deploymentSurface.deploymentId, surface: s.deploymentSurface.surface })
        .from(s.deploymentSurface)
        .where(inArray(s.deploymentSurface.deploymentId, rows.map((row) => row.id)))
    : [];

  return rows.map((row) => ({
    id: row.code,
    n: row.n,
    nAr: row.nAr,
    a: row.a ?? "",
    surf: surfaces.filter((surface) => surface.deploymentId === row.id).map((surface) => surface.surface).join(" · "),
    sl: row.storyline ?? "—",
    rate: row.rate,
    conv: row.conv,
    st: row.st,
    allowedOrigins: row.allowedOrigins ?? [],
    visitorIdentity: row.visitorIdentity,
    visitorJwtFallback: row.visitorJwtFallback,
    handoffQueue: row.handoffQueue,
    runAs: row.runAs,
    rateLimitPerVisitor: row.rateLimitPerVisitor,
    widgetTitleEn: row.widgetTitleEn,
    widgetTitleAr: row.widgetTitleAr,
    accentColour: row.accentColour,
    welcomeEn: row.welcomeEn,
    welcomeAr: row.welcomeAr,
    disclaimerEn: row.disclaimerEn,
    disclaimerAr: row.disclaimerAr,
    disclaimerDismissible: row.disclaimerDismissible,
    quickActions: (row.quickActions ?? []) as unknown as DeploymentQuickAction[],
    voiceInput: row.voiceInput,
    readAloud: row.readAloud,
    sessionIdleMinutes: row.sessionIdleMinutes,
    progressRetentionMinutes: row.progressRetentionMinutes,
    storylines: row.storylines ?? [],
    version: row.version,
  }));
}


/** Every tool and skill a storyline step may call, for the step editor's pickers. */
export async function listStorylineOptions(): Promise<{ tools: string[]; skills: string[] }> {
  const tools = await dbRo()
    .select({ ref: sql<string>`${s.connector.code} || '/' || ${s.connectorTool.name}` })
    .from(s.connectorTool)
    .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
    .orderBy(asc(s.connector.code), asc(s.connectorTool.name));
  const skills = await dbRo().select({ name: s.skill.skillName }).from(s.skill).orderBy(asc(s.skill.skillName));
  return { tools: tools.map((tool) => tool.ref), skills: skills.map((skill) => skill.name) };
}

/** Requirement 52: a channel change is hot-reloaded, so it is a plain row update. */
export async function setChannelEnabled(type: string, enabled: boolean, version: number, personId: string): Promise<void> {
  const rows = await db()
    .update(s.channel)
    .set({ isEnabled: enabled, status: enabled ? "Enabled" : "Disabled", updatedAt: new Date(), updatedBy: personId })
    .where(and(eq(s.channel.type, type), eq(s.channel.version, version)))
    .returning({ id: s.channel.id });
  assertWritten(rows, "Channel");
}

/**
 * Writes a channel's settings and binding. The binding id is the named deployment's only for an
 * `EmbeddedDeployment` binding, and null otherwise. A secret is encrypted and replaced only when
 * one is given, so an omitted secret keeps the stored one. Not version-checked.
 */
export async function configureChannel(
  input: {
    type: string;
    rateLimitPerMinute: number;
    unknownSenders: string;
    businessHours: string;
    bindingType: string | null;
    bindingDeploymentCode: string | null;
    offlineMessageEn: string | null;
    offlineMessageAr: string | null;
    endpointUrl: string | null;
    secret?: string;
    inboundSecret?: string;
  },
  personId: string,
): Promise<void> {
  const [deployment] = input.bindingDeploymentCode
    ? await dbRo()
        .select({ id: s.embeddedDeployment.id })
        .from(s.embeddedDeployment)
        .where(eq(s.embeddedDeployment.code, input.bindingDeploymentCode))
        .limit(1)
    : [undefined];

  await db()
    .update(s.channel)
    .set({
      rateLimitPerMinute: input.rateLimitPerMinute,
      unknownSenders: input.unknownSenders,
      businessHours: input.businessHours,
      bindingType: input.bindingType,
      bindingId: input.bindingType === "EmbeddedDeployment" ? (deployment?.id ?? null) : null,
      offlineMessageEn: input.offlineMessageEn,
      offlineMessageAr: input.offlineMessageAr,
      endpointUrl: input.endpointUrl,
      ...(input.secret ? { secretRef: encrypt(input.secret) } : {}),
      ...(input.inboundSecret ? { inboundSecretRef: encrypt(input.inboundSecret) } : {}),
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(eq(s.channel.type, input.type));
}

/** One channel's whole configuration, with the credentials reported only as present or not. */
export async function readChannelConfig(type: string): Promise<ChannelConfig | null> {
  const [row] = await dbRo()
    .select({
      type: s.channel.type,
      isEnabled: s.channel.isEnabled,
      status: s.channel.status,
      bindingType: s.channel.bindingType,
      bindingDeploymentCode: sql<string | null>`(select d.code from ai.embedded_deployment d where d.id = ${outer(s.channel.bindingId)})`,
      unknownSenders: s.channel.unknownSenders,
      rateLimitPerMinute: s.channel.rateLimitPerMinute,
      businessHours: s.channel.businessHours,
      offlineMessageEn: s.channel.offlineMessageEn,
      offlineMessageAr: s.channel.offlineMessageAr,
      endpointUrl: s.channel.endpointUrl,
      hasSecret: sql<boolean>`${s.channel.secretRef} is not null`,
      hasInboundSecret: sql<boolean>`${s.channel.inboundSecretRef} is not null`,
      lastTestAt: s.channel.lastTestAt,
      lastTestResultJson: s.channel.lastTestResultJson,
      version: s.channel.version,
    })
    .from(s.channel)
    .where(eq(s.channel.type, type))
    .limit(1);
  if (!row) return null;

  return {
    ...row,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestChecks: ((row.lastTestResultJson ?? {}) as { checks?: ChannelCheck[] }).checks ?? [],
  };
}

/** The deployments a channel may be bound to. */
export async function bindingTargets(): Promise<{ code: string; nameEn: string; nameAr: string }[]> {
  return dbRo()
    .select({ code: s.embeddedDeployment.code, nameEn: s.embeddedDeployment.nameEn, nameAr: s.embeddedDeployment.nameAr })
    .from(s.embeddedDeployment)
    .orderBy(asc(s.embeddedDeployment.nameEn));
}

/**
 * The credentials, decrypted for one call. Never returned to a browser: the only callers
 * are the channel test and the gateway, both on the server.
 */
export async function channelCredentials(
  type: string,
): Promise<{ id: string; secret: string | null; inboundSecret: string | null; endpointUrl: string | null } | null> {
  const [row] = await dbRo()
    .select({
      id: s.channel.id,
      secretRef: s.channel.secretRef,
      inboundSecretRef: s.channel.inboundSecretRef,
      endpointUrl: s.channel.endpointUrl,
    })
    .from(s.channel)
    .where(eq(s.channel.type, type))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    secret: row.secretRef ? decrypt(row.secretRef) : null,
    inboundSecret: row.inboundSecretRef ? decrypt(row.inboundSecretRef) : null,
    endpointUrl: row.endpointUrl,
  };
}

/**
 * The test result, and the status it implies: an enabled channel whose checks did not all
 * pass is Degraded rather than Enabled, which is what the dashboard and System read
 * (`UC-61.1-06`).
 */
export async function recordChannelTest(type: string, checks: ChannelCheck[], personId: string): Promise<void> {
  const [current] = await dbRo().select({ isEnabled: s.channel.isEnabled }).from(s.channel).where(eq(s.channel.type, type)).limit(1);
  const allPassed = checks.every((check) => check.ok);
  await db()
    .update(s.channel)
    .set({
      lastTestAt: new Date(),
      lastTestResultJson: { checks },
      status: current?.isEnabled ? (allPassed ? "Enabled" : "Degraded") : "Disabled",
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(eq(s.channel.type, type));
}

/** How many messages this sender has sent on this channel inside the window. */
export async function countInboundSince(channelId: string, senderKey: string, since: Date): Promise<number> {
  const [row] = await dbRo()
    .select({ total: sql<number>`count(*)::int` })
    .from(s.channelMessage)
    .where(
      and(
        eq(s.channelMessage.channelId, channelId),
        eq(s.channelMessage.senderKey, senderKey),
        eq(s.channelMessage.direction, "Inbound"),
        gte(s.channelMessage.createdAt, since),
      ),
    );
  return row?.total ?? 0;
}

/** Every message a channel carried, kept whatever the gateway decided about it. */
export async function recordChannelMessage(row: {
  channelId: string;
  direction: string;
  senderKey: string;
  bodyText: string | null;
  action: string;
  detail: string | null;
  conversationId?: string | null;
  roomId?: string | null;
  requestId?: string | null;
}): Promise<void> {
  await db().insert(s.channelMessage).values({
    channelId: row.channelId,
    direction: row.direction,
    senderKey: row.senderKey,
    bodyText: row.bodyText,
    action: row.action,
    detail: row.detail,
    conversationId: row.conversationId ?? null,
    roomId: row.roomId ?? null,
    requestId: row.requestId ?? null,
  });
}

/** The channel a message arrived on, with everything the inbound decision needs. */
export async function readChannelForInbound(type: string) {
  const [row] = await dbRo()
    .select({
      id: s.channel.id,
      type: s.channel.type,
      isEnabled: s.channel.isEnabled,
      businessHours: s.channel.businessHours,
      unknownSenders: s.channel.unknownSenders,
      rateLimitPerMinute: s.channel.rateLimitPerMinute,
      bindingType: s.channel.bindingType,
      bindingId: s.channel.bindingId,
      offlineMessageEn: s.channel.offlineMessageEn,
      offlineMessageAr: s.channel.offlineMessageAr,
      inboundSecretRef: s.channel.inboundSecretRef,
    })
    .from(s.channel)
    .where(eq(s.channel.type, type))
    .limit(1);
  if (!row) return null;
  return { ...row, inboundSecret: row.inboundSecretRef ? decrypt(row.inboundSecretRef) : null };
}

/* ------------------------------------------------ S-63 to S-65: the deployment runtime */

/** One deployment, as the widget and the channel gateway need it. */
export type RunnableDeployment = {
  id: string;
  code: string;
  status: string;
  allowedOrigins: string[];
  visitorIdentity: string;
  visitorJwtFallback: string;
  handoffQueue: string | null;
  rateLimitPerVisitor: number;
  widgetTitleEn: string | null;
  widgetTitleAr: string | null;
  accentColour: string | null;
  welcomeEn: string | null;
  welcomeAr: string | null;
  defaultAgentCode: string | null;
  /** Error or Paused means the visitor is offered the handoff queue (`UC-63.1-09`). */
  defaultAgentStatus: string | null;
  activeStorylineVersionId: string | null;
  /** The person the agent acts as for a visitor (D221). */
  runAsPersonId: string | null;
  /** The widget's own settings (D231). */
  disclaimerEn: string | null;
  disclaimerAr: string | null;
  disclaimerDismissible: boolean;
  quickActions: QuickAction[];
  voiceInput: boolean;
  readAloud: boolean;
  sessionIdleMinutes: number;
  progressRetentionMinutes: number;
};

/** One chip under the widget's greeting, starting one storyline (specification section 8). */
export type QuickAction = {
  id: string;
  labelEn: string;
  labelAr: string;
  /** The storyline the chip starts, by code. */
  storyline: string;
  /** Pages the chip is offered on, from the embed's `data-context` page; `*` is every page. */
  pages: string[];
  /** The identity a visitor needs to start it: most start anonymous and step up inside. */
  minIdentity: "anonymous" | "otp_verified" | "logged_in";
};

/** The person a deployment's agent acts as for a visitor, or null (D221). */
export async function runAsOf(code: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ runAs: s.embeddedDeployment.runAsPersonId })
    .from(s.embeddedDeployment)
    .where(eq(s.embeddedDeployment.code, code))
    .limit(1);
  return row?.runAs ?? null;
}

/** Whether a run answering this conversation is still going (D221). */
export async function agentAnswering(conversationId: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ id: s.run.id })
    .from(s.run)
    .where(
      and(
        eq(s.run.contextType, "Deployment"),
        eq(s.run.contextId, conversationId),
        inArray(s.run.status, ["Queued", "Running", "Waiting"]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Whether the person exists and is Active, which a deployment's run-as person must be (D221). */
export async function personIsActive(personId: string): Promise<boolean> {
  const [row] = await dbRo().select({ status: s.person.status }).from(s.person).where(eq(s.person.id, personId)).limit(1);
  return row?.status === "Active";
}

/** One deployment by code, with its default agent's code and status; null when there is none. */
export async function readRunnableDeployment(code: string): Promise<RunnableDeployment | null> {
  const [row] = await dbRo()
    .select({
      id: s.embeddedDeployment.id,
      code: s.embeddedDeployment.code,
      status: s.embeddedDeployment.status,
      allowedOrigins: s.embeddedDeployment.allowedOrigins,
      visitorIdentity: s.embeddedDeployment.visitorIdentity,
      visitorJwtFallback: s.embeddedDeployment.visitorJwtFallback,
      handoffQueue: s.embeddedDeployment.handoffQueue,
      rateLimitPerVisitor: s.embeddedDeployment.rateLimitPerVisitor,
      widgetTitleEn: s.embeddedDeployment.widgetTitleEn,
      widgetTitleAr: s.embeddedDeployment.widgetTitleAr,
      accentColour: s.embeddedDeployment.accentColour,
      welcomeEn: s.embeddedDeployment.welcomeMessageEn,
      welcomeAr: s.embeddedDeployment.welcomeMessageAr,
      defaultAgentCode: s.agent.code,
      defaultAgentStatus: s.agent.status,
      activeStorylineVersionId: s.embeddedDeployment.activeStorylineVersionId,
      runAsPersonId: s.embeddedDeployment.runAsPersonId,
      disclaimerEn: s.embeddedDeployment.disclaimerEn,
      disclaimerAr: s.embeddedDeployment.disclaimerAr,
      disclaimerDismissible: s.embeddedDeployment.disclaimerDismissible,
      quickActionsJson: s.embeddedDeployment.quickActionsJson,
      voiceInput: s.embeddedDeployment.voiceInput,
      readAloud: s.embeddedDeployment.readAloud,
      sessionIdleMinutes: s.embeddedDeployment.sessionIdleMinutes,
      progressRetentionMinutes: s.embeddedDeployment.progressRetentionMinutes,
    })
    .from(s.embeddedDeployment)
    .leftJoin(s.agent, eq(s.agent.id, s.embeddedDeployment.defaultAgentId))
    .where(eq(s.embeddedDeployment.code, code))
    .limit(1);
  if (!row) return null;
  const { quickActionsJson, ...rest } = row;
  return { ...rest, allowedOrigins: row.allowedOrigins ?? [], quickActions: (quickActionsJson ?? []) as QuickAction[] };
}

/** The code of the deployment a channel's binding id names; null when it no longer exists. */
export async function deploymentByChannelBinding(bindingId: string): Promise<string | null> {
  const [row] = await dbRo().select({ code: s.embeddedDeployment.code }).from(s.embeddedDeployment).where(eq(s.embeddedDeployment.id, bindingId)).limit(1);
  return row?.code ?? null;
}

/** A storyline version in the shape the engine runs, with the step chain resolved to names. */
export async function readRunnableStoryline(versionId: string): Promise<EngineStoryline | null> {
  const [version] = await dbRo()
    .select({
      id: s.storylineVersion.id,
      code: s.storyline.code,
      versionNumber: s.storylineVersion.versionNumber,
      mode: s.storylineVersion.mode,
    })
    .from(s.storylineVersion)
    .innerJoin(s.storyline, eq(s.storyline.id, s.storylineVersion.storylineId))
    .where(eq(s.storylineVersion.id, versionId))
    .limit(1);
  if (!version) return null;

  const rows = await dbRo()
    .select({
      id: s.storylineStep.id,
      name: s.storylineStep.name,
      stepType: s.storylineStep.stepType,
      messageEn: s.storylineStep.messageEn,
      messageAr: s.storylineStep.messageAr,
      sendVerbatim: s.storylineStep.sendVerbatim,
      slot: s.storylineStep.slot,
      maxAttempts: s.storylineStep.maxAttempts,
      verifyMethod: s.storylineStep.verifyMethod,
      handoffQueue: s.storylineStep.handoffQueue,
      toolRefs: s.storylineStep.toolRefs,
      skillRefs: s.storylineStep.skillRefs,
      agentCode: s.agent.code,
      nextStepId: s.storylineStep.nextStepId,
      onError: s.storylineStep.onError,
      config: s.storylineStep.configJson,
      sortOrder: s.storylineStep.sortOrder,
    })
    .from(s.storylineStep)
    .leftJoin(s.agent, eq(s.agent.id, s.storylineStep.agentOverrideId))
    .where(eq(s.storylineStep.storylineVersionId, versionId))
    .orderBy(asc(s.storylineStep.sortOrder));

  const nameById = new Map(rows.map((row) => [row.id, row.name]));
  return {
    code: version.code,
    versionNumber: version.versionNumber,
    mode: version.mode as EngineStoryline["mode"],
    steps: rows.map((row) => ({
      name: row.name,
      type: row.stepType as EngineStep["type"],
      messageEn: row.messageEn,
      messageAr: row.messageAr,
      sendVerbatim: row.sendVerbatim,
      slot: row.slot,
      maxAttempts: row.maxAttempts,
      verifyMethod: row.verifyMethod,
      handoffQueue: row.handoffQueue,
      toolRefs: row.toolRefs ?? [],
      skillRefs: row.skillRefs ?? [],
      agentCode: row.agentCode,
      nextStepName: (row.nextStepId ? nameById.get(row.nextStepId) : null) ?? null,
      onError: row.onError as EngineStep["onError"],
      config: (row.config ?? {}) as EngineStep["config"],
    })),
  };
}

/** The conversation this visitor already has open on this deployment, if any. */
export async function openConversationFor(deploymentId: string, visitorKey: string) {
  const [row] = await dbRo()
    .select({
      id: s.deploymentConversation.id,
      startedAt: s.deploymentConversation.startedAt,
      storylineVersionId: s.deploymentConversation.storylineVersionId,
      stateJson: s.deploymentConversation.stateJson,
      slotsJson: s.deploymentConversation.slotsJson,
      outcome: s.deploymentConversation.outcome,
      rating: s.deploymentConversation.rating,
    })
    .from(s.deploymentConversation)
    .where(
      and(
        eq(s.deploymentConversation.deploymentId, deploymentId),
        eq(s.deploymentConversation.visitorKey, visitorKey),
        isNull(s.deploymentConversation.endedAt),
      ),
    )
    .orderBy(desc(s.deploymentConversation.startedAt))
    .limit(1);
  return row ?? null;
}

/** One conversation with its deployment's code, open or ended; null when there is none. */
export async function readConversation(id: string) {
  const [row] = await dbRo()
    .select({
      id: s.deploymentConversation.id,
      deploymentId: s.deploymentConversation.deploymentId,
      deploymentCode: s.embeddedDeployment.code,
      storylineVersionId: s.deploymentConversation.storylineVersionId,
      visitorKey: s.deploymentConversation.visitorKey,
      channelId: s.deploymentConversation.channelId,
      externalContactId: s.deploymentConversation.externalContactId,
      stateJson: s.deploymentConversation.stateJson,
      outcome: s.deploymentConversation.outcome,
      rating: s.deploymentConversation.rating,
      roomId: s.deploymentConversation.roomId,
      agentPausedAt: s.deploymentConversation.agentPausedAt,
    })
    .from(s.deploymentConversation)
    .innerJoin(s.embeddedDeployment, eq(s.embeddedDeployment.id, s.deploymentConversation.deploymentId))
    .where(eq(s.deploymentConversation.id, id))
    .limit(1);
  return row ?? null;
}

/** Opens a conversation with empty state and slots, and returns its id. */
export async function createConversation(input: {
  deploymentId: string;
  storylineVersionId: string | null;
  visitorKey: string;
  channelId: string | null;
  externalContactId: string | null;
}): Promise<string> {
  const [created] = await db()
    .insert(s.deploymentConversation)
    .values({
      deploymentId: input.deploymentId,
      storylineVersionId: input.storylineVersionId,
      visitorKey: input.visitorKey,
      channelId: input.channelId,
      externalContactId: input.externalContactId,
      stateJson: {},
      slotsJson: {},
    })
    .returning({ id: s.deploymentConversation.id });
  return created.id;
}

/**
 * The engine's state, plus the readable projection the console reads: the slots and the
 * step the conversation is on.
 */
export async function saveConversationState(input: {
  id: string;
  state: Record<string, unknown>;
  slots: Record<string, string>;
  storylineVersionId: string | null;
  stepName: string | null;
  outcome: string | null;
  ended: boolean;
}): Promise<void> {
  const [step] = input.stepName && input.storylineVersionId
    ? await dbRo()
        .select({ id: s.storylineStep.id })
        .from(s.storylineStep)
        .where(and(eq(s.storylineStep.storylineVersionId, input.storylineVersionId), eq(s.storylineStep.name, input.stepName)))
        .limit(1)
    : [undefined];

  await db()
    .update(s.deploymentConversation)
    .set({
      stateJson: input.state,
      slotsJson: input.slots,
      storylineVersionId: input.storylineVersionId,
      currentStepId: step?.id ?? null,
      outcome: input.outcome,
      endedAt: input.ended ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(s.deploymentConversation.id, input.id));
}

/** The conversation a run answers, when it answers a widget visitor (D221). */
export async function conversationOfRun(runId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ contextType: s.run.contextType, contextId: s.run.contextId })
    .from(s.run)
    .where(eq(s.run.id, runId))
    .limit(1);
  return row?.contextType === "Deployment" ? row.contextId : null;
}

/** The widget conversation handed over into a room, if one was (widget specification 12). */
export async function conversationInRoom(roomId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ id: s.deploymentConversation.id })
    .from(s.deploymentConversation)
    .where(eq(s.deploymentConversation.roomId, roomId))
    .orderBy(desc(s.deploymentConversation.startedAt))
    .limit(1);
  return row?.id ?? null;
}

/** How a connector is reached (`OpenApi`, `StreamableHttp`, `Stdio`), or null when there is none. */
export async function connectorTransport(code: string): Promise<string | null> {
  const [row] = await dbRo().select({ transport: s.connector.transport }).from(s.connector).where(eq(s.connector.code, code)).limit(1);
  return row?.transport ?? null;
}

/** Replaces the runtime's state without moving the conversation, as an OTP resend does. */
export async function saveRuntime(conversationId: string, state: object): Promise<void> {
  await db()
    .update(s.deploymentConversation)
    .set({ stateJson: state as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(s.deploymentConversation.id, conversationId));
}

/** The language the visitor reads, which the deployment's agent answers in (D231). */
export async function setConversationLanguage(conversationId: string, lang: "en" | "ar"): Promise<void> {
  await db()
    .update(s.deploymentConversation)
    .set({ stateJson: sql`${s.deploymentConversation.stateJson} || jsonb_build_object('lang', ${lang}::text)` })
    .where(eq(s.deploymentConversation.id, conversationId));
}

/** Whether a half-finished scenario is offered to the visitor to continue or start over. */
export async function markResumable(conversationId: string, resumable: boolean): Promise<void> {
  await db()
    .update(s.deploymentConversation)
    .set({ stateJson: sql`${s.deploymentConversation.stateJson} || jsonb_build_object('resumable', ${resumable}::boolean)`, updatedAt: new Date() })
    .where(eq(s.deploymentConversation.id, conversationId));
}

/** How many client message ids a conversation remembers, so a retried send is taken once. */
const REMEMBERED_MESSAGES = 20;

/** Whether the conversation already took a message with this client message id. */
export async function seenClientMessage(conversationId: string, clientMessageId: string): Promise<boolean> {
  const { rows } = await dbRo().execute<{ seen: boolean }>(sql`
    select coalesce(${s.deploymentConversation.stateJson} -> 'clientMessages', '[]'::jsonb) ? ${clientMessageId} as seen
    from ${s.deploymentConversation} where ${s.deploymentConversation.id} = ${conversationId}
  `);
  return rows[0]?.seen ?? false;
}

/**
 * Adds a client message id to the conversation's `clientMessages` in its state, keeping the
 * latest `REMEMBERED_MESSAGES`.
 */
export async function rememberClientMessage(conversationId: string, clientMessageId: string): Promise<void> {
  // Appends the id, numbers the array's elements in order, and keeps the highest-numbered ones.
  await db().execute(sql`
    update ai.deployment_conversation
       set state_json = state_json || jsonb_build_object('clientMessages', (
             select coalesce(jsonb_agg(id), '[]'::jsonb) from (
               select id from jsonb_array_elements_text(
                 coalesce(state_json -> 'clientMessages', '[]'::jsonb) || to_jsonb(${clientMessageId}::text)
               ) with ordinality as kept(id, n)
               order by n desc limit ${REMEMBERED_MESSAGES}
             ) recent)),
           updated_at = now()
     where id = ${conversationId}
  `);
}

/** Whether a deployment is published on one surface (Widget, WhatsApp, Teams). */
export async function surfaceEnabled(deploymentId: string, surface: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ surface: s.deploymentSurface.surface })
    .from(s.deploymentSurface)
    .where(and(eq(s.deploymentSurface.deploymentId, deploymentId), eq(s.deploymentSurface.surface, surface)))
    .limit(1);
  return row !== undefined;
}

/**
 * Where a handed-over conversation stands: queued until a person writes in its room,
 * connected once one has; null when it was never handed over.
 */
export async function handoffStateOf(conversationId: string): Promise<"queued" | "connected" | null> {
  const { rows } = await dbRo().execute<{ room: string | null; answered: boolean }>(sql`
    select c.room_id as room,
           exists (select 1 from work.room_message m where m.room_id = c.room_id and m.sender_type = 'Person') as answered
    from ai.deployment_conversation c where c.id = ${conversationId}
  `);
  const row = rows[0];
  if (!row?.room) return null;
  return row.answered ? "connected" : "queued";
}

/** A visitor's upload for a file step, kept on the conversation. Returns its id. */
export async function insertConversationAttachment(input: {
  conversationId: string;
  fileName: string;
  contentRef: string;
  size: number;
  mimeType: string;
}): Promise<string> {
  const [row] = await db()
    .insert(s.attachment)
    .values({
      ownerType: "Conversation",
      ownerId: input.conversationId,
      fileName: input.fileName,
      contentRef: input.contentRef,
      size: input.size,
      mimeType: input.mimeType,
    })
    .returning({ id: s.attachment.id });
  return row.id;
}

/** Appends lines to the transcript in order, numbered after its last line, in one transaction. */
export async function appendConversationMessages(conversationId: string, lines: TranscriptLine[]): Promise<void> {
  if (lines.length === 0) return;
  await db().transaction(async (tx) => {
    const [last] = await tx
      .select({ sortOrder: s.conversationMessage.sortOrder })
      .from(s.conversationMessage)
      .where(eq(s.conversationMessage.conversationId, conversationId))
      .orderBy(desc(s.conversationMessage.sortOrder))
      .limit(1);
    let next = (last?.sortOrder ?? -1) + 1;
    await tx.insert(s.conversationMessage).values(
      lines.map((line) => ({
        conversationId,
        sortOrder: next++,
        role: line.role,
        kind: line.kind,
        textEn: line.textEn,
        textAr: line.textAr,
        payloadJson: line.payload,
      })),
    );
  });
  // The Conversations screen follows a conversation live (D342), and the open-conversations panel
  // and desktop alerts follow all of them (D344). Who holds the conversation decides who is told.
  await publish(channels.conversation(conversationId), { kind: "message" });
  const fromVisitor = lines.filter((line) => line.role === "Visitor").length;
  const [held] = await dbRo()
    .select({
      pausedBy: s.deploymentConversation.agentPausedBy,
      deployment: s.embeddedDeployment.nameEn,
      visitorLines: sql<number>`(select count(*)::int from ai.conversation_message m where m.conversation_id = ${conversationId} and m.role = 'Visitor')`,
    })
    .from(s.deploymentConversation)
    .innerJoin(s.embeddedDeployment, eq(s.embeddedDeployment.id, s.deploymentConversation.deploymentId))
    .where(eq(s.deploymentConversation.id, conversationId))
    .limit(1);
  // A widget opens its conversation before the visitor does anything; the conversation starts,
  // for whoever is watching, with the visitor's first line.
  const started = fromVisitor > 0 && held?.visitorLines === fromVisitor;
  await publish(
    channels.conversations(),
    started
      ? { kind: "started", conversationId, deployment: held?.deployment ?? null }
      : { kind: "message", conversationId, fromVisitor: fromVisitor > 0, pausedBy: held?.pausedBy ?? null, deployment: held?.deployment ?? null },
  );
}

/** A conversation's whole transcript in order, each line with its place and when it was written. */
export async function readTranscript(conversationId: string): Promise<TranscriptLine[]> {
  const rows = await dbRo()
    .select({
      role: s.conversationMessage.role,
      kind: s.conversationMessage.kind,
      textEn: s.conversationMessage.textEn,
      textAr: s.conversationMessage.textAr,
      payloadJson: s.conversationMessage.payloadJson,
      seq: s.conversationMessage.sortOrder,
      createdAt: s.conversationMessage.createdAt,
    })
    .from(s.conversationMessage)
    .where(eq(s.conversationMessage.conversationId, conversationId))
    .orderBy(asc(s.conversationMessage.sortOrder));
  return rows.map(({ payloadJson, createdAt, ...row }) => ({
    ...row,
    payload: (payloadJson ?? {}) as Record<string, unknown>,
    at: createdAt.toISOString(),
  }));
}

/**
 * What changes when a widget conversation moves on: its last line, its state and whether the
 * agent is answering. The widget's stream compares this and reads the rest only on a change.
 */
export async function conversationMark(conversationId: string): Promise<string> {
  const { rows } = await dbRo().execute<{ mark: string }>(sql`
    select concat_ws(':',
      (select max(m.sort_order) from ai.conversation_message m where m.conversation_id = c.id),
      extract(epoch from c.updated_at),
      (select count(*) from ai.run r where r.context_type = 'Deployment' and r.context_id = c.id
         and r.status in ('Queued', 'Running', 'Waiting'))
    ) as mark
    from ai.deployment_conversation c where c.id = ${conversationId}
  `);
  return rows[0]?.mark ?? "";
}

/** The agent run answering this conversation now, if one is. */
export async function activeRunOf(conversationId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ id: s.run.id })
    .from(s.run)
    .where(
      and(
        eq(s.run.contextType, "Deployment"),
        eq(s.run.contextId, conversationId),
        inArray(s.run.status, ["Queued", "Running", "Waiting"]),
      ),
    )
    .orderBy(desc(s.run.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** When the visitor or the conversation last did anything, for the idle timeout. */
export async function lastActivityOf(conversationId: string): Promise<Date | null> {
  const [row] = await dbRo()
    .select({ at: sql<Date | null>`max(${s.conversationMessage.createdAt})` })
    .from(s.conversationMessage)
    .where(eq(s.conversationMessage.conversationId, conversationId));
  return row?.at ? new Date(row.at) : null;
}

/** The published version of one of a deployment's storylines, by its code. */
export async function publishedStorylineOf(deploymentId: string, storylineCode: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ id: s.storylineVersion.id })
    .from(s.storylineVersion)
    .innerJoin(s.storyline, eq(s.storyline.id, s.storylineVersion.storylineId))
    .where(
      and(
        eq(s.storyline.deploymentId, deploymentId),
        eq(s.storyline.code, storylineCode),
        eq(s.storylineVersion.status, "Published"),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Ends a conversation now, with an outcome, whatever step it was at. */
export async function endConversation(conversationId: string, outcome: string): Promise<boolean> {
  const rows = await db()
    .update(s.deploymentConversation)
    .set({ outcome, endedAt: new Date(), updatedAt: new Date(), agentPausedBy: null, agentPausedAt: null })
    .where(and(eq(s.deploymentConversation.id, conversationId), isNull(s.deploymentConversation.endedAt)))
    .returning({ id: s.deploymentConversation.id });
  if (rows.length) {
    await publish(channels.conversation(conversationId), { kind: "state" });
    await publish(channels.conversations(), { kind: "state", conversationId });
  }
  return rows.length > 0;
}

/**
 * The conversations a person should be watching (D344): every one still open that nobody else has
 * taken over, most recently active first. One the agent is answering counts once its visitor has
 * written and while they have been active within the deployment's idle timeout; one this person
 * holds counts until it ends.
 */
export async function listActiveConversations(personId: string, limit: number): Promise<ActiveConversation[]> {
  const { rows } = await dbRo().execute<{
    id: string;
    name_en: string;
    name_ar: string;
    last_at: Date | null;
    last_text: string | null;
    mine: boolean;
  }>(sql`
    select c.id, d.name_en, d.name_ar, activity.last_at, activity.last_text, c.agent_paused_by is not null as mine
    from ai.deployment_conversation c
    join ai.embedded_deployment d on d.id = c.deployment_id
    cross join lateral (
      select max(m.created_at) as last_at,
             (select v.text_en from ai.conversation_message v where v.conversation_id = c.id and v.role = 'Visitor'
                and v.text_en is not null order by v.sort_order desc limit 1) as last_text
      from ai.conversation_message m where m.conversation_id = c.id
    ) activity
    where c.outcome is null
      and (c.agent_paused_by = ${personId}
        or (c.agent_paused_by is null and activity.last_text is not null
            and coalesce(activity.last_at, c.started_at) >= now() - make_interval(mins => d.session_idle_minutes)))
    order by coalesce(activity.last_at, c.started_at) desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    id: row.id,
    deploymentNameEn: row.name_en,
    deploymentNameAr: row.name_ar,
    lastAt: row.last_at ? new Date(row.last_at).toISOString() : null,
    lastText: row.last_text,
    mine: row.mine,
  }));
}

const STATUS_SQL = sql`case when c.outcome is null and c.agent_paused_at is not null then 'AgentPaused'
  when c.outcome is null then 'Live' when c.outcome = 'HandedOff' then 'HandedOff' else 'Ended' end`;

function conversationWhere(filter: ConversationFilter) {
  const parts = [sql`true`];
  if (filter.deploymentCode) parts.push(sql`d.code = ${filter.deploymentCode}`);
  if (filter.sinceDays) parts.push(sql`c.started_at >= now() - make_interval(days => ${filter.sinceDays}::int)`);
  if (filter.from) parts.push(sql`c.started_at >= ${filter.from.toISOString()}`);
  if (filter.to) parts.push(sql`c.started_at < ${filter.to.toISOString()}`);
  if (filter.status) parts.push(sql`${STATUS_SQL} = ${filter.status}`);
  if (filter.text) {
    const pattern = `%${likeLiteral(filter.text)}%`;
    parts.push(sql`(c.visitor_key ilike ${pattern} or exists (select 1 from ai.conversation_message m
      where m.conversation_id = c.id and (m.text_en ilike ${pattern} or m.text_ar ilike ${pattern})))`);
  }
  return sql.join(parts, sql` and `);
}

type SummaryRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  started_at: Date;
  last_at: Date | null;
  status: ConversationStatus;
  outcome: string | null;
  rating: number | null;
  channel_type: string | null;
  request_key: string | null;
  paused_by: string | null;
};

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

function summaryOf(row: SummaryRow) {
  return {
    id: row.id,
    deploymentCode: row.code,
    deploymentNameEn: row.name_en,
    deploymentNameAr: row.name_ar,
    startedAt: new Date(row.started_at).toISOString(),
    lastAt: iso(row.last_at),
    status: row.status,
    outcome: row.outcome,
    rating: row.rating,
    channelType: row.channel_type,
    requestKey: row.request_key,
    pausedBy: row.paused_by,
  };
}

/** One page of conversations, newest first, with how many match in all. */
export async function listConversations(
  filter: ConversationFilter,
  page: { limit: number; offset: number },
): Promise<{ rows: ConversationRow[]; total: number }> {
  const where = conversationWhere(filter);
  const [{ rows }, counted] = await Promise.all([
    dbRo().execute<SummaryRow & { messages: number; first_text: string | null }>(sql`
      select c.id, d.code, d.name_en, d.name_ar, c.started_at, c.outcome, c.rating, ${STATUS_SQL} as status,
             ch.type as channel_type, r.key as request_key, p.name_en as paused_by,
             (select count(*)::int from ai.conversation_message m where m.conversation_id = c.id
                and m.role in ('Visitor', 'Agent', 'HumanAgent')) as messages,
             (select max(m.created_at) from ai.conversation_message m where m.conversation_id = c.id) as last_at,
             (select m.text_en from ai.conversation_message m where m.conversation_id = c.id and m.role = 'Visitor'
                and m.text_en is not null order by m.sort_order limit 1) as first_text
      from ai.deployment_conversation c
      join ai.embedded_deployment d on d.id = c.deployment_id
      left join ai.channel ch on ch.id = c.channel_id
      left join work.request r on r.id = c.request_id
      left join core.person p on p.id = c.agent_paused_by
      where ${where}
      order by c.started_at desc, c.id desc
      limit ${page.limit} offset ${page.offset}
    `),
    dbRo().execute<{ total: number }>(sql`
      select count(*)::int as total
      from ai.deployment_conversation c join ai.embedded_deployment d on d.id = c.deployment_id
      where ${where}
    `),
  ]);
  return {
    total: counted.rows[0]?.total ?? 0,
    rows: rows.map((row) => ({ ...summaryOf(row), messages: row.messages, firstText: row.first_text })),
  };
}

/** One conversation as the Conversations screen opens it, or null. */
export async function readConversationSummary(id: string): Promise<ConversationSummary | null> {
  const { rows } = await dbRo().execute<SummaryRow & { ended_at: Date | null; room_key: string | null; paused_at: Date | null }>(sql`
    select c.id, d.code, d.name_en, d.name_ar, c.started_at, c.ended_at, c.outcome, c.rating, ${STATUS_SQL} as status,
           ch.type as channel_type, r.key as request_key, room.key as room_key, p.name_en as paused_by,
           c.agent_paused_at as paused_at,
           (select max(m.created_at) from ai.conversation_message m where m.conversation_id = c.id) as last_at
    from ai.deployment_conversation c
    join ai.embedded_deployment d on d.id = c.deployment_id
    left join ai.channel ch on ch.id = c.channel_id
    left join work.request r on r.id = c.request_id
    left join work.discussion_room room on room.id = c.room_id
    left join core.person p on p.id = c.agent_paused_by
    where c.id = ${id}
  `);
  const row = rows[0];
  if (!row) return null;
  return { ...summaryOf(row), endedAt: iso(row.ended_at), pausedAt: iso(row.paused_at), roomKey: row.room_key };
}

/**
 * Takes an open conversation over from its agent (`personId`), or hands it back (`null`).
 * False when the conversation has ended or is already in that state, so two people cannot
 * both take it over.
 */
export async function setAgentPaused(conversationId: string, personId: string | null): Promise<boolean> {
  const rows = await db()
    .update(s.deploymentConversation)
    .set({ agentPausedBy: personId, agentPausedAt: personId ? new Date() : null, updatedAt: new Date() })
    .where(
      and(
        eq(s.deploymentConversation.id, conversationId),
        isNull(s.deploymentConversation.outcome),
        personId ? isNull(s.deploymentConversation.agentPausedAt) : sql`${s.deploymentConversation.agentPausedAt} is not null`,
      ),
    )
    .returning({ id: s.deploymentConversation.id });
  if (rows.length) {
    await publish(channels.conversation(conversationId), { kind: "state" });
    await publish(channels.conversations(), { kind: "state", conversationId });
  }
  return rows.length > 0;
}

/** One widget event (specification section 15). Never carries a value the visitor typed. */
export async function recordWidgetEvent(input: {
  deploymentId: string;
  conversationId: string | null;
  name: string;
  props: Record<string, unknown>;
}): Promise<void> {
  await db().insert(s.widgetEvent).values({
    deploymentId: input.deploymentId,
    conversationId: input.conversationId,
    name: input.name,
    propsJson: input.props,
  });
}

/** One conversation's feedback on one agent message, kept on the message itself. */
export async function rateMessage(conversationId: string, seq: number, value: "up" | "down"): Promise<boolean> {
  const rows = await db()
    .update(s.conversationMessage)
    .set({ payloadJson: sql`${s.conversationMessage.payloadJson} || jsonb_build_object('feedback', ${value}::text)` })
    .where(and(eq(s.conversationMessage.conversationId, conversationId), eq(s.conversationMessage.sortOrder, seq)))
    .returning({ id: s.conversationMessage.id });
  return rows.length > 0;
}

/** Stores the visitor's rating of the whole conversation, replacing any earlier one. */
export async function rateConversation(id: string, rating: number): Promise<void> {
  await db().update(s.deploymentConversation).set({ rating, updatedAt: new Date() }).where(eq(s.deploymentConversation.id, id));
}

/** Links the request a conversation raised, by key; does nothing when no request has that key. */
export async function linkConversationRequest(id: string, requestKey: string): Promise<void> {
  const [request] = await dbRo().select({ id: s.request.id }).from(s.request).where(eq(s.request.key, requestKey)).limit(1);
  if (!request) return;
  await db().update(s.deploymentConversation).set({ requestId: request.id, updatedAt: new Date() }).where(eq(s.deploymentConversation.id, id));
}

/** `UC-65.1-12`: how many turns this visitor has taken on this deployment in the window. */
export async function countVisitorTurnsSince(deploymentId: string, visitorKey: string, since: Date): Promise<number> {
  const [row] = await dbRo()
    .select({ total: sql<number>`count(*)::int` })
    .from(s.conversationMessage)
    .innerJoin(s.deploymentConversation, eq(s.deploymentConversation.id, s.conversationMessage.conversationId))
    .where(
      and(
        eq(s.deploymentConversation.deploymentId, deploymentId),
        eq(s.deploymentConversation.visitorKey, visitorKey),
        eq(s.conversationMessage.role, "Visitor"),
        gte(s.conversationMessage.createdAt, since),
      ),
    );
  return row?.total ?? 0;
}

/** The sender, as an external contact: created the first time one writes (`UC-61.1-02`). */
// An external contact is not `engage`'s own: a request type's intake widget reaches the
// same identity, so the read-or-create lives in `db/queries` and is re-exported here for
// the callers that already name it through this repository.
export { externalContactFor } from "@/db/queries/external-contacts";

/** The id of the person with this e-mail address, which makes a channel sender known; or null. */
export async function personByEmail(email: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.person.id }).from(s.person).where(eq(s.person.email, email)).limit(1);
  return row?.id ?? null;
}

/** `UC-63.1-07`: conversations and rating over a window, for the deployment detail. */
export async function deploymentStats(code: string, since: Date): Promise<DeploymentStats> {
  const [row] = await dbRo()
    .select({
      conversations: sql<number>`count(*)::int`,
      rating: sql<number | null>`round(avg(${s.deploymentConversation.rating})::numeric, 1)::float8`,
    })
    .from(s.deploymentConversation)
    .innerJoin(s.embeddedDeployment, eq(s.embeddedDeployment.id, s.deploymentConversation.deploymentId))
    .where(and(eq(s.embeddedDeployment.code, code), gte(s.deploymentConversation.startedAt, since)));

  const { rows: scenarios } = await dbRo().execute<ScenarioStats>(sql`
    select e.props_json ->> 'scenario' as scenario,
           count(*) filter (where e.name = 'scenario.started')::int as started,
           count(*) filter (where e.name = 'scenario.ended' and e.props_json ->> 'end' in ('Completed', 'RequestCreated'))::int as completed,
           count(*) filter (where e.name = 'scenario.ended' and e.props_json ->> 'end' = 'HandedOff')::int as "handedOff",
           count(*) filter (where e.name = 'scenario.ended' and e.props_json ->> 'end' in ('Cancelled', 'Abandoned'))::int as stopped
    from ai.widget_event e join ai.embedded_deployment d on d.id = e.deployment_id
    where d.code = ${code} and e.at >= ${since} and e.name in ('scenario.started', 'scenario.ended')
    group by 1 order by 2 desc
  `);
  const { rows: dropOff } = await dbRo().execute<{ scenario: string; step: string; count: number }>(sql`
    select e.props_json ->> 'scenario' as scenario, coalesce(e.props_json ->> 'step', '—') as step, count(*)::int as count
    from ai.widget_event e join ai.embedded_deployment d on d.id = e.deployment_id
    where d.code = ${code} and e.at >= ${since} and e.name = 'scenario.ended'
      and e.props_json ->> 'end' in ('Cancelled', 'Abandoned')
    group by 1, 2 order by 3 desc limit 5
  `);
  const { rows: otp } = await dbRo().execute<{ verified: number; locked: number }>(sql`
    select count(*) filter (where e.props_json ->> 'result' = 'verified')::int as verified,
           count(*) filter (where e.props_json ->> 'result' = 'locked')::int as locked
    from ai.widget_event e join ai.embedded_deployment d on d.id = e.deployment_id
    where d.code = ${code} and e.at >= ${since} and e.name = 'identity.step_up'
  `);
  return {
    conversations: row?.conversations ?? 0,
    rating: row?.rating ?? null,
    scenarios: scenarios.filter((one) => one.scenario),
    dropOff,
    otp: otp[0] ?? { verified: 0, locked: 0 },
  };
}

/** `UC-63.1-*`: every conversation a deployment has ever held, for the delete warning. */
export async function deploymentConversationCount(code: string): Promise<number> {
  const [row] = await dbRo()
    .select({ n: sql<number>`count(*)::int` })
    .from(s.deploymentConversation)
    .innerJoin(s.embeddedDeployment, eq(s.embeddedDeployment.id, s.deploymentConversation.deploymentId))
    .where(eq(s.embeddedDeployment.code, code));
  return row?.n ?? 0;
}

/**
 * Whether a channel still binds to this deployment — not a foreign key, since a channel's
 * binding is polymorphic by `bindingType`, so nothing in the database refuses the delete on
 * its own. Deleting anyway would leave the channel routing to a deployment that is gone.
 */
export async function deploymentBoundChannels(code: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ type: s.channel.type })
    .from(s.channel)
    .innerJoin(s.embeddedDeployment, eq(s.embeddedDeployment.id, s.channel.bindingId))
    .where(and(eq(s.channel.bindingType, "EmbeddedDeployment"), eq(s.embeddedDeployment.code, code)));
  return rows.map((row) => row.type);
}

/** The deployment, its surfaces, storylines and conversations — every one cascades with it. */
export async function deleteDeployment(code: string): Promise<void> {
  await db().delete(s.embeddedDeployment).where(eq(s.embeddedDeployment.code, code));
}

/** The room a channel conversation is mirrored into (`UC-23.1-13`). */
export async function mirroredRoom(channelId: string, externalRef: string): Promise<{ id: string; key: string } | null> {
  const [row] = await dbRo()
    .select({ id: s.discussionRoom.id, key: s.discussionRoom.key })
    .from(s.discussionRoom)
    .where(and(eq(s.discussionRoom.mirrorChannelId, channelId), eq(s.discussionRoom.mirrorExternalRef, externalRef)))
    .limit(1);
  return row ?? null;
}

/** The channel and reference a room mirrors to, read when a reply has to go back out. */
export async function roomMirror(roomId: string): Promise<{ channelType: string; endpointUrl: string | null; secret: string | null; externalRef: string } | null> {
  const [row] = await dbRo()
    .select({
      channelType: s.channel.type,
      endpointUrl: s.channel.endpointUrl,
      secretRef: s.channel.secretRef,
      isEnabled: s.channel.isEnabled,
      externalRef: s.discussionRoom.mirrorExternalRef,
    })
    .from(s.discussionRoom)
    .innerJoin(s.channel, eq(s.channel.id, s.discussionRoom.mirrorChannelId))
    .where(eq(s.discussionRoom.id, roomId))
    .limit(1);
  if (!row || !row.isEnabled || !row.externalRef) return null;
  return {
    channelType: row.channelType,
    endpointUrl: row.endpointUrl,
    secret: row.secretRef ? decrypt(row.secretRef) : null,
    externalRef: row.externalRef,
  };
}

/** Mirrors a room to a channel conversation, which is what makes the two-way link exist. */
export async function setRoomMirror(roomKey: string, channelType: string, externalRef: string, personId: string): Promise<void> {
  const [channel] = await dbRo().select({ id: s.channel.id }).from(s.channel).where(eq(s.channel.type, channelType)).limit(1);
  if (!channel) throw new Error(`No ${channelType} channel.`);
  await db()
    .update(s.discussionRoom)
    .set({ mirrorChannelId: channel.id, mirrorExternalRef: externalRef, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.discussionRoom.key, roomKey));
}

/** The channel a conversation arrived on, for one outbound call. */
export async function channelCredentialsById(channelId: string): Promise<{ endpointUrl: string | null; secret: string | null } | null> {
  const [row] = await dbRo()
    .select({ endpointUrl: s.channel.endpointUrl, secretRef: s.channel.secretRef, isEnabled: s.channel.isEnabled })
    .from(s.channel)
    .where(eq(s.channel.id, channelId))
    .limit(1);
  if (!row || !row.isEnabled) return null;
  return { endpointUrl: row.endpointUrl, secret: row.secretRef ? decrypt(row.secretRef) : null };
}

/** The project a request type's open requests sit in, which is where a new one goes. */
export async function projectForRequestType(code: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ key: s.project.key })
    .from(s.request)
    .innerJoin(s.project, eq(s.project.id, s.request.projectId))
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
    .innerJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .where(eq(s.requestType.code, code))
    .orderBy(desc(s.request.createdAt))
    .limit(1);
  if (row) return row.key;
  // Nothing of this type has been raised yet, so the first project that may raise it does.
  const [fallback] = await dbRo().select({ key: s.project.key }).from(s.project).orderBy(asc(s.project.key)).limit(1);
  return fallback?.key ?? null;
}

/** The owner of the project with this key, who a handoff room is created as; null when none. */
export async function projectOwner(projectKey: string): Promise<string | null> {
  const [row] = await dbRo().select({ owner: s.project.ownerPersonId }).from(s.project).where(eq(s.project.key, projectKey)).limit(1);
  return row?.owner ?? null;
}

/** The id of the discussion room with this key, or null. */
export async function roomIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.discussionRoom.id }).from(s.discussionRoom).where(eq(s.discussionRoom.key, key)).limit(1);
  return row?.id ?? null;
}

/** Records the room a conversation was handed over to, which marks it as handed over. */
export async function linkConversationRoom(conversationId: string, roomId: string): Promise<void> {
  await db().update(s.deploymentConversation).set({ roomId, updatedAt: new Date() }).where(eq(s.deploymentConversation.id, conversationId));
}

/** Every project, for the handoff-queue picker on the deployment. */
export async function projectOptions(): Promise<{ key: string; nameEn: string; nameAr: string }[]> {
  return dbRo().select({ key: s.project.key, nameEn: s.project.nameEn, nameAr: s.project.nameAr }).from(s.project).orderBy(asc(s.project.nameEn));
}

/** The organisation's working hours, which decide whether a channel is in hours. */
export async function workingHours(): Promise<{ start: string; end: string } | null> {
  const [row] = await dbRo()
    .select({ hours: s.calendar.workingHoursJson })
    .from(s.organisation)
    .innerJoin(s.calendar, eq(s.calendar.id, s.organisation.workingCalendarId))
    .limit(1);
  const hours = (row?.hours ?? {}) as { start?: string; end?: string };
  return hours.start && hours.end ? { start: hours.start, end: hours.end } : null;
}

/** The published request types that take intake from one surface, with where they are raised. */
export async function requestTypesForIntake(surface: string): Promise<{ code: string; projectKey: string }[]> {
  const rows = await dbRo()
    .select({ code: s.requestType.code })
    .from(s.requestType)
    .innerJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.requestType.currentPublishedVersionId))
    .where(sql`${surface} = any(${s.requestTypeVersion.intakeChannels})`)
    .orderBy(asc(s.requestType.code));

  const withProject = await Promise.all(
    rows.map(async (row) => ({ code: row.code, projectKey: await projectForRequestType(row.code) })),
  );
  return withProject.filter((row): row is { code: string; projectKey: string } => row.projectKey !== null);
}

/** The channel each deployment surface speaks through. */
const CHANNEL_OF_SURFACE: Record<string, string> = { Widget: "WebWidget", WhatsApp: "WhatsApp", Teams: "MicrosoftTeams" };

/**
 * `UC-62.1-02`: inserts a Draft deployment with no allowed origins, and a surface row for each
 * chosen surface linked to that surface's channel (null when the channel has no row), in one
 * transaction. Throws when the default agent does not exist.
 */
export async function createDeployment(
  input: { code: string; nameEn: string; nameAr: string; defaultAgentCode: string; surfaces: string[] },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const [agent] = await tx.select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, input.defaultAgentCode)).limit(1);
    if (!agent) throw new Error(`No agent ${input.defaultAgentCode}.`);
    const [created] = await tx
      .insert(s.embeddedDeployment)
      .values({
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        defaultAgentId: agent.id,
        status: "Draft",
        allowedOrigins: [],
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.embeddedDeployment.id });

    const channels = await tx.select({ id: s.channel.id, type: s.channel.type }).from(s.channel);
    await tx.insert(s.deploymentSurface).values(
      input.surfaces.map((surface) => ({
        deploymentId: created.id,
        surface,
        channelId: channels.find((channel) => channel.type === CHANNEL_OF_SURFACE[surface])?.id ?? null,
        createdBy: personId,
        updatedBy: personId,
      })),
    );
  });
}

/** `UC-63.1-01`: everything the three cards hold, written in one transaction. */
export async function saveDeployment(
  input: {
    code: string;
    nameEn: string;
    nameAr: string;
    defaultAgentCode: string;
    status: string;
    surfaces: string[];
    allowedOrigins: string[];
    visitorIdentity: string;
    visitorJwtFallback: string;
    visitorJwtSecret?: string;
    handoffQueue: string | null;
    runAsPersonId?: string | null;
    rateLimitPerVisitor: number;
    widgetTitleEn: string | null;
    widgetTitleAr: string | null;
    accentColour: string;
    welcomeEn: string | null;
    welcomeAr: string | null;
    disclaimerEn?: string | null;
    disclaimerAr?: string | null;
    disclaimerDismissible?: boolean;
    quickActions?: QuickAction[];
    voiceInput?: boolean;
    readAloud?: boolean;
    sessionIdleMinutes?: number;
    progressRetentionMinutes?: number;
    version: number;
  },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const [agent] = await tx.select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, input.defaultAgentCode)).limit(1);
    if (!agent) throw new Error(`No agent ${input.defaultAgentCode}.`);

    const updated = await tx
      .update(s.embeddedDeployment)
      .set({
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        defaultAgentId: agent.id,
        status: input.status,
        allowedOrigins: input.allowedOrigins,
        visitorIdentity: input.visitorIdentity,
        visitorJwtFallback: input.visitorJwtFallback,
        ...(input.visitorJwtSecret ? { visitorJwtSecretRef: encrypt(input.visitorJwtSecret) } : {}),
        handoffQueue: input.handoffQueue,
        ...(input.runAsPersonId !== undefined ? { runAsPersonId: input.runAsPersonId } : {}),
        rateLimitPerVisitor: input.rateLimitPerVisitor,
        widgetTitleEn: input.widgetTitleEn,
        widgetTitleAr: input.widgetTitleAr,
        accentColour: input.accentColour,
        welcomeMessageEn: input.welcomeEn,
        welcomeMessageAr: input.welcomeAr,
        ...(input.disclaimerEn !== undefined ? { disclaimerEn: input.disclaimerEn } : {}),
        ...(input.disclaimerAr !== undefined ? { disclaimerAr: input.disclaimerAr } : {}),
        ...(input.disclaimerDismissible !== undefined ? { disclaimerDismissible: input.disclaimerDismissible } : {}),
        ...(input.quickActions !== undefined ? { quickActionsJson: input.quickActions as unknown as Record<string, unknown>[] } : {}),
        ...(input.voiceInput !== undefined ? { voiceInput: input.voiceInput } : {}),
        ...(input.readAloud !== undefined ? { readAloud: input.readAloud } : {}),
        ...(input.sessionIdleMinutes !== undefined ? { sessionIdleMinutes: input.sessionIdleMinutes } : {}),
        ...(input.progressRetentionMinutes !== undefined ? { progressRetentionMinutes: input.progressRetentionMinutes } : {}),
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(and(eq(s.embeddedDeployment.code, input.code), eq(s.embeddedDeployment.version, input.version)))
      .returning({ id: s.embeddedDeployment.id });
    assertWritten(updated, "EmbeddedDeployment");

    await tx.delete(s.deploymentSurface).where(eq(s.deploymentSurface.deploymentId, updated[0].id));
    if (input.surfaces.length > 0) {
      const channels = await tx.select({ id: s.channel.id, type: s.channel.type }).from(s.channel);
      await tx.insert(s.deploymentSurface).values(
        input.surfaces.map((surface) => ({
          deploymentId: updated[0].id,
          surface,
          channelId: channels.find((channel) => channel.type === CHANNEL_OF_SURFACE[surface])?.id ?? null,
          createdBy: personId,
          updatedBy: personId,
        })),
      );
    }
  });
}

/* ------------------------------------------------------- S-64: the storyline editor */

export type StorylineDraft = {
  code: string;
  nameEn: string;
  nameAr: string;
  versionId: string;
  versionNumber: number;
  mode: string;
  status: string;
  /** The version the deployment is running, which conversations in progress keep. */
  publishedVersionNumber: number | null;
  steps: EngineStep[];
};

/**
 * What the editor shows: the draft if there is one, otherwise the published version.
 *
 * Reading never writes. The first change is what copies a published version to a new draft,
 * which is what makes `UC-64.1-09` true — conversations in progress keep the version they
 * started on.
 */
export async function readStorylineView(code: string): Promise<StorylineDraft | null> {
  const [storyline] = await dbRo()
    .select({ id: s.storyline.id, nameEn: s.storyline.nameEn, nameAr: s.storyline.nameAr })
    .from(s.storyline)
    .where(eq(s.storyline.code, code))
    .limit(1);
  if (!storyline) return null;

  const versions = await dbRo()
    .select({ id: s.storylineVersion.id, versionNumber: s.storylineVersion.versionNumber, mode: s.storylineVersion.mode, status: s.storylineVersion.status })
    .from(s.storylineVersion)
    .where(eq(s.storylineVersion.storylineId, storyline.id))
    .orderBy(desc(s.storylineVersion.versionNumber));

  const published = versions.find((version) => version.status === "Published") ?? null;
  const shown = versions.find((version) => version.status === "Draft") ?? published ?? versions[0];
  if (!shown) return null;

  return {
    code,
    nameEn: storyline.nameEn,
    nameAr: storyline.nameAr,
    versionId: shown.id,
    versionNumber: shown.versionNumber,
    mode: shown.mode,
    status: shown.status,
    publishedVersionNumber: published?.versionNumber ?? null,
    steps: await readEngineSteps(shown.id),
  };
}

/** The draft a change is written to, copied from the published version the first time. */
export async function ensureStorylineDraft(code: string, personId: string): Promise<StorylineDraft | null> {
  const [storyline] = await dbRo()
    .select({ id: s.storyline.id, nameEn: s.storyline.nameEn, nameAr: s.storyline.nameAr })
    .from(s.storyline)
    .where(eq(s.storyline.code, code))
    .limit(1);
  if (!storyline) return null;

  const versions = await dbRo()
    .select({ id: s.storylineVersion.id, versionNumber: s.storylineVersion.versionNumber, mode: s.storylineVersion.mode, status: s.storylineVersion.status })
    .from(s.storylineVersion)
    .where(eq(s.storylineVersion.storylineId, storyline.id))
    .orderBy(desc(s.storylineVersion.versionNumber));

  const published = versions.find((version) => version.status === "Published") ?? null;
  let draft = versions.find((version) => version.status === "Draft") ?? null;
  if (!draft) {
    draft = await copyToDraft(storyline.id, published, versions[0]?.versionNumber ?? 0, personId);
  }

  const steps = await readEngineSteps(draft.id);
  return {
    code,
    nameEn: storyline.nameEn,
    nameAr: storyline.nameAr,
    versionId: draft.id,
    versionNumber: draft.versionNumber,
    mode: draft.mode,
    status: draft.status,
    publishedVersionNumber: published?.versionNumber ?? null,
    steps,
  };
}

async function readEngineSteps(versionId: string): Promise<EngineStep[]> {
  const storyline = await readRunnableStoryline(versionId);
  return storyline?.steps ?? [];
}

/**
 * Creates the storyline's Draft version, numbered after its highest, with the mode and steps of
 * `from` (the published version), or Guided and empty when there is none. One transaction.
 */
async function copyToDraft(
  storylineId: string,
  from: { id: string; versionNumber: number; mode: string } | null,
  highest: number,
  personId: string,
): Promise<{ id: string; versionNumber: number; mode: string; status: string }> {
  return db().transaction(async (tx) => {
    const versionNumber = highest + 1;
    const [created] = await tx
      .insert(s.storylineVersion)
      .values({
        storylineId,
        versionNumber,
        mode: from?.mode ?? "Guided",
        status: "Draft",
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.storylineVersion.id });

    if (from) {
      const steps = await tx.select().from(s.storylineStep).where(eq(s.storylineStep.storylineVersionId, from.id)).orderBy(asc(s.storylineStep.sortOrder));
      const copied = new Map<string, string>();
      for (const step of steps) {
        const [one] = await tx
          .insert(s.storylineStep)
          .values({
            storylineVersionId: created.id,
            sortOrder: step.sortOrder,
            name: step.name,
            stepType: step.stepType,
            agentOverrideId: step.agentOverrideId,
            messageEn: step.messageEn,
            messageAr: step.messageAr,
            sendVerbatim: step.sendVerbatim,
            slot: step.slot,
            maxAttempts: step.maxAttempts,
            verifyMethod: step.verifyMethod,
            handoffQueue: step.handoffQueue,
            toolRefs: step.toolRefs,
            skillRefs: step.skillRefs,
            onError: step.onError,
            configJson: step.configJson,
            createdBy: personId,
            updatedBy: personId,
          })
          .returning({ id: s.storylineStep.id });
        copied.set(step.id, one.id);
      }
      // The chain is rebuilt afterwards, because a step may point at one that follows it.
      for (const step of steps) {
        if (!step.nextStepId) continue;
        await tx
          .update(s.storylineStep)
          .set({ nextStepId: copied.get(step.nextStepId) ?? null })
          .where(eq(s.storylineStep.id, copied.get(step.id) as string));
      }
    }
    return { id: created.id, versionNumber, mode: from?.mode ?? "Guided", status: "Draft" };
  });
}

/** `UC-64.1-04` … `-06`: one step as the panel edits it. */
export async function saveStorylineStep(
  versionId: string,
  step: {
    name: string;
    type: string;
    messageEn: string | null;
    messageAr: string | null;
    sendVerbatim: boolean;
    slot: string | null;
    maxAttempts: number | null;
    verifyMethod: string | null;
    handoffQueue: string | null;
    toolRefs: string[];
    skillRefs: string[];
    agentCode: string | null;
    nextStepName: string | null;
    onError: string;
    config: Record<string, unknown>;
  },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const [agent] = step.agentCode
      ? await tx.select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, step.agentCode)).limit(1)
      : [undefined];
    const [next] = step.nextStepName
      ? await tx
          .select({ id: s.storylineStep.id })
          .from(s.storylineStep)
          .where(and(eq(s.storylineStep.storylineVersionId, versionId), eq(s.storylineStep.name, step.nextStepName)))
          .limit(1)
      : [undefined];

    await tx
      .update(s.storylineStep)
      .set({
        stepType: step.type,
        messageEn: step.messageEn,
        messageAr: step.messageAr,
        sendVerbatim: step.sendVerbatim,
        slot: step.slot,
        maxAttempts: step.maxAttempts,
        verifyMethod: step.verifyMethod,
        handoffQueue: step.handoffQueue,
        toolRefs: step.toolRefs,
        skillRefs: step.skillRefs,
        agentOverrideId: agent?.id ?? null,
        nextStepId: next?.id ?? null,
        onError: step.onError,
        configJson: step.config,
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(and(eq(s.storylineStep.storylineVersionId, versionId), eq(s.storylineStep.name, step.name)));
  });
}

/** `UC-64.1-04`: a new step, inserted after the one the designer had selected. */
export async function addStorylineStep(versionId: string, name: string, afterName: string | null, personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const steps = await tx
      .select({ id: s.storylineStep.id, name: s.storylineStep.name, sortOrder: s.storylineStep.sortOrder })
      .from(s.storylineStep)
      .where(eq(s.storylineStep.storylineVersionId, versionId))
      .orderBy(asc(s.storylineStep.sortOrder));

    const at = afterName ? steps.findIndex((step) => step.name === afterName) + 1 : steps.length;
    // The order is a unique index, so later steps move out of the way from the back.
    for (let index = steps.length - 1; index >= at; index -= 1) {
      await tx.update(s.storylineStep).set({ sortOrder: steps[index].sortOrder + 1 }).where(eq(s.storylineStep.id, steps[index].id));
    }
    await tx.insert(s.storylineStep).values({
      storylineVersionId: versionId,
      sortOrder: at,
      name,
      stepType: "Message",
      onError: "Handoff",
      configJson: {},
      createdBy: personId,
      updatedBy: personId,
    });
  });
}

/** `UC-64.1-07`: deleting a step, and the steps that pointed at it. */
export async function deleteStorylineStep(versionId: string, name: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [step] = await tx
      .select({ id: s.storylineStep.id })
      .from(s.storylineStep)
      .where(and(eq(s.storylineStep.storylineVersionId, versionId), eq(s.storylineStep.name, name)))
      .limit(1);
    if (!step) return;
    // A step that pointed at it is left with no next step, which Publish then names.
    await tx.update(s.storylineStep).set({ nextStepId: null }).where(eq(s.storylineStep.nextStepId, step.id));
    await tx.delete(s.storylineStep).where(eq(s.storylineStep.id, step.id));
  });
}

/** Sets one storyline version's mode. */
export async function setStorylineMode(versionId: string, mode: string, personId: string): Promise<void> {
  await db().update(s.storylineVersion).set({ mode, updatedAt: new Date(), updatedBy: personId }).where(eq(s.storylineVersion.id, versionId));
}

/**
 * `UC-64.1-09`: the draft becomes the published version, and the one it replaces is kept.
 *
 * The deployment moves to the new version; conversations already running hold their own
 * version id, so they finish on the script they started with.
 */
export async function publishStorylineVersion(versionId: string, personId: string): Promise<number> {
  return db().transaction(async (tx) => {
    const [version] = await tx
      .select({ storylineId: s.storylineVersion.storylineId, versionNumber: s.storylineVersion.versionNumber })
      .from(s.storylineVersion)
      .where(eq(s.storylineVersion.id, versionId))
      .limit(1);
    if (!version) throw new Error("That storyline version no longer exists.");

    await tx
      .update(s.storylineVersion)
      .set({ status: "Superseded", updatedAt: new Date(), updatedBy: personId })
      .where(and(eq(s.storylineVersion.storylineId, version.storylineId), eq(s.storylineVersion.status, "Published")));
    await tx
      .update(s.storylineVersion)
      .set({ status: "Published", publishedAt: new Date(), updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.storylineVersion.id, versionId));

    // The storyline under the deployment's own code opens its conversations, and a new
    // version of the opening storyline replaces itself there; a storyline with any other code
    // is a scenario a quick action starts (widget specification 8, D231).
    const [storyline] = await tx
      .select({ deploymentId: s.storyline.deploymentId, code: s.storyline.code })
      .from(s.storyline)
      .where(eq(s.storyline.id, version.storylineId))
      .limit(1);
    if (storyline?.deploymentId) {
      const [deployment] = await tx
        .select({
          code: s.embeddedDeployment.code,
          opener: sql<string | null>`(select sv.storyline_id from ai.storyline_version sv where sv.id = ${outer(s.embeddedDeployment.activeStorylineVersionId)})`,
        })
        .from(s.embeddedDeployment)
        .where(eq(s.embeddedDeployment.id, storyline.deploymentId))
        .limit(1);
      if (deployment && (deployment.opener === version.storylineId || (!deployment.opener && storyline.code === deployment.code))) {
        await tx
          .update(s.embeddedDeployment)
          .set({ activeStorylineVersionId: versionId, updatedAt: new Date(), updatedBy: personId })
          .where(eq(s.embeddedDeployment.id, storyline.deploymentId));
      }
    }
    return version.versionNumber;
  });
}

/**
 * The connector tools one agent's active version is granted (D227), which is what a Tool
 * step is checked against.
 */
export async function toolsAllowedTo(agentCode: string | null, defaultAgentCode: string | null): Promise<string[]> {
  const code = agentCode ?? defaultAgentCode;
  if (!code) return [];
  const rows = await dbRo()
    .select({ ref: sql<string>`${s.connector.code} || '/' || ${s.connectorTool.name}` })
    .from(s.agent)
    .innerJoin(s.agentToolMode, eq(s.agentToolMode.agentVersionId, s.agent.activeVersionId))
    .innerJoin(s.connectorTool, eq(s.connectorTool.id, s.agentToolMode.connectorToolId))
    .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
    .where(and(eq(s.agent.code, code), ne(s.agentToolMode.mode, "Denied")));
  return rows.map((row) => row.ref);
}

/** The deployment a storyline belongs to, for its default agent and Arabic setting. */
export async function deploymentOfStoryline(code: string): Promise<{ code: string; defaultAgentCode: string | null } | null> {
  const [row] = await dbRo()
    .select({ code: s.embeddedDeployment.code, defaultAgentCode: s.agent.code })
    .from(s.storyline)
    .innerJoin(s.embeddedDeployment, eq(s.embeddedDeployment.id, s.storyline.deploymentId))
    .leftJoin(s.agent, eq(s.agent.id, s.embeddedDeployment.defaultAgentId))
    .where(eq(s.storyline.code, code))
    .limit(1);
  return row ?? null;
}

/**
 * A deployment's storyline, created with an empty draft for the editor to fill (D219). Named
 * after the deployment, under its code, which is unique, as `readStorylineView` looks it up.
 * False when the deployment does not exist or already has one.
 */
export async function createStoryline(
  deploymentCode: string,
  personId: string,
  named?: { code: string; nameEn: string; nameAr: string },
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [deployment] = await tx
      .select({ id: s.embeddedDeployment.id, nameEn: s.embeddedDeployment.nameEn, nameAr: s.embeddedDeployment.nameAr })
      .from(s.embeddedDeployment)
      .where(eq(s.embeddedDeployment.code, deploymentCode))
      .limit(1);
    if (!deployment) return false;
    // Without a code it is the deployment's first storyline, under the deployment's own code.
    const code = named?.code ?? deploymentCode;
    const [existing] = await tx
      .select({ id: s.storyline.id })
      .from(s.storyline)
      .where(named ? and(eq(s.storyline.deploymentId, deployment.id), eq(s.storyline.code, code)) : eq(s.storyline.deploymentId, deployment.id))
      .limit(1);
    if (existing) return false;
    const [created] = await tx
      .insert(s.storyline)
      .values({
        deploymentId: deployment.id,
        code,
        nameEn: named?.nameEn ?? deployment.nameEn,
        nameAr: named?.nameAr || named?.nameEn || deployment.nameAr,
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.storyline.id });
    await tx.insert(s.storylineVersion).values({ storylineId: created.id, versionNumber: 1, status: "Draft", createdBy: personId, updatedBy: personId });
    return true;
  });
}

/** The codes of the storylines a deployment owns, in code order. */
export async function storylineCodesOf(deploymentCode: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ code: s.storyline.code })
    .from(s.storyline)
    .innerJoin(s.embeddedDeployment, eq(s.embeddedDeployment.id, s.storyline.deploymentId))
    .where(eq(s.embeddedDeployment.code, deploymentCode))
    .orderBy(asc(s.storyline.code));
  return rows.map((row) => row.code);
}

/** The agents a deployment may run, for the default-agent pickers. */
export async function agentOptions(): Promise<{ code: string; nameEn: string; nameAr: string }[]> {
  return dbRo()
    .select({ code: s.agent.code, nameEn: s.agent.nameEn, nameAr: s.agent.nameAr })
    .from(s.agent)
    .where(eq(s.agent.isSystem, false))
    .orderBy(asc(s.agent.nameEn));
}

/** The secret a host site signs a visitor token with, read only on the server. */
export async function visitorTokenSecret(code: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ secretRef: s.embeddedDeployment.visitorJwtSecretRef })
    .from(s.embeddedDeployment)
    .where(eq(s.embeddedDeployment.code, code))
    .limit(1);
  return row?.secretRef ? decrypt(row.secretRef) : null;
}
