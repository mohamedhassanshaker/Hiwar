import { eq } from "drizzle-orm";

import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { CH_LIVE, DEPS } from "@/db/seed/data/platform";
import { SL0 } from "./data/runs";
import { shift } from "@/db/seed/clock";
import { ids } from "@/db/seed/ids";

/**
 * Data model section 16: the live channels, the embedded deployments, the surfaces each
 * deployment is published on, and the storyline the card-replacement deployment runs.
 */

const CHANNEL_TYPE: Record<string, string> = {
  "Web widget": "WebWidget",
  WhatsApp: "WhatsApp",
  "Microsoft Teams": "MicrosoftTeams",
};

const STEP_TYPE: Record<string, string> = {
  say: "Message",
  ask: "Ask",
  confirm: "Confirm",
  decide: "Decide",
  classify: "Classify",
  tool: "Tool",
  skill: "Skill",
  verify: "Verify",
  create_work: "CreateWork",
  handoff: "Handoff",
  wait: "Wait",
  subflow: "Subflow",
  goto: "GoTo",
  end: "End",
};

const SURFACES: Record<string, string[]> = {
  dep_7f3a9c: ["Widget", "WhatsApp"],
  dep_2b81e0: ["Teams"],
  dep_91cd44: ["Widget"],
};

export async function seedEngage(db: Database): Promise<void> {
  await db.insert(s.channel).values(
    CH_LIVE.map(([name, status, binding]) => ({
      id: ids.channel(CHANNEL_TYPE[name]),
      type: CHANNEL_TYPE[name],
      isEnabled: true,
      status,
      bindingType: binding.startsWith("Embedded") ? "EmbeddedDeployment" : "RoomMirror",
      bindingId: binding.startsWith("Embedded") ? ids.deployment("dep_7f3a9c") : null,
      unknownSenders: "ExternalContact",
      rateLimitPerMinute: 30,
      businessHours: "AlwaysOn",
      secretRef: CHANNEL_TYPE[name] === "WebWidget" ? null : encrypt(`${CHANNEL_TYPE[name]}-provider-token`),
      // The webhook is signed, so a channel that takes inbound messages has a secret to
      // check them against from the moment it is seeded.
      inboundSecretRef: encrypt(`${CHANNEL_TYPE[name]}-inbound-secret`),
      endpointUrl: null,
      offlineMessageEn: "We are closed. Your message has been taken in.",
      offlineMessageAr: "نحن مغلقون. تم استلام رسالتك.",
      lastTestAt: shift("2026-10-09T09:00:00Z"),
      lastTestResultJson: { ok: status === "Enabled", latencyMs: 180 },
    })),
  );

  await db.insert(s.embeddedDeployment).values(
    DEPS.map((deployment) => ({
      id: ids.deployment(deployment.id),
      code: deployment.id,
      nameEn: deployment.n,
      nameAr: deployment.nAr,
      defaultAgentId: ids.agent(deployment.a),
      status: deployment.st,
      allowedOrigins: [...(deployment.id === "dep_7f3a9c" ? ["https://tahseel.ae", "https://www.tahseel.ae"] : ["https://tahseel.ae"]), env().APP_URL],
      visitorIdentity: "AnonymousOtpStepUp",
      // The queue is a project: a handoff opens a room in it carrying the conversation.
      handoffQueue: "CS",
      rateLimitPerVisitor: 20,
      widgetTitleEn: deployment.n,
      widgetTitleAr: deployment.nAr,
      accentColour: "#0F6E5C",
      welcomeMessageEn: "Welcome. How can I help?",
      welcomeMessageAr: "مرحباً. كيف يمكنني المساعدة؟",
    })),
  );

  await db.insert(s.deploymentSurface).values(
    DEPS.flatMap((deployment) =>
      SURFACES[deployment.id].map((surface) => ({
        deploymentId: ids.deployment(deployment.id),
        surface,
        channelId:
          surface === "Widget"
            ? ids.channel("WebWidget")
            : surface === "WhatsApp"
              ? ids.channel("WhatsApp")
              : ids.channel("MicrosoftTeams"),
      })),
    ),
  );

  await db.insert(s.storyline).values([
    {
      id: ids.storyline("card-replacement"),
      deploymentId: ids.deployment("dep_7f3a9c"),
      code: "card-replacement",
      nameEn: "Card replacement",
      nameAr: "استبدال بطاقة",
    },
    {
      id: ids.storyline("vendor-onboarding"),
      deploymentId: ids.deployment("dep_91cd44"),
      code: "vendor-onboarding",
      nameEn: "Vendor onboarding",
      nameAr: "تسجيل مورد",
    },
  ]);

  await db.insert(s.storylineVersion).values([
    {
      id: ids.storylineVersion("card-replacement:3"),
      storylineId: ids.storyline("card-replacement"),
      versionNumber: 3,
      mode: "Strict",
      status: "Published",
      publishedAt: shift("2026-09-20T06:00:00Z"),
    },
    {
      id: ids.storylineVersion("vendor-onboarding:1"),
      storylineId: ids.storyline("vendor-onboarding"),
      versionNumber: 1,
      mode: "Guided",
      status: "Draft",
      publishedAt: null,
    },
  ]);

  await db.insert(s.storylineStep).values(
    SL0.map((step, index) => ({
      id: ids.storylineStep(`card-replacement:${step.id}`),
      storylineVersionId: ids.storylineVersion("card-replacement:3"),
      sortOrder: index,
      name: step.id,
      stepType: STEP_TYPE[step.type],
      agentOverrideId: step.agent === "default" ? null : ids.agent(step.agent),
      messageEn: step.t,
      messageAr: step.tAr,
      sendVerbatim: step.exact ?? false,
      slot: step.slot ?? null,
      maxAttempts: step.type === "ask" ? 3 : null,
      verifyMethod: step.type === "verify" ? "Otp" : null,
      handoffQueue: null,
      toolRefs: step.tools,
      skillRefs: step.skills,
      nextStepId: null,
      onError: "Handoff",
      configJson: { ...(step.branch ? { branch: true } : {}), ...(step.config ?? {}) },
    })),
  );

  // The steps are a chain; each one points at the next, as the storyline editor draws it.
  // The Decide step's branches override that for the two paths it chooses between.
  for (let index = 0; index < SL0.length - 1; index += 1) {
    await db
      .update(s.storylineStep)
      .set({ nextStepId: ids.storylineStep(`card-replacement:${SL0[index + 1].id}`) })
      .where(eq(s.storylineStep.id, ids.storylineStep(`card-replacement:${SL0[index].id}`)));
  }

  await db
    .update(s.embeddedDeployment)
    .set({ activeStorylineVersionId: ids.storylineVersion("card-replacement:3") })
    .where(eq(s.embeddedDeployment.id, ids.deployment("dep_7f3a9c")));

  await db.insert(s.deploymentConversation).values([
    {
      id: ids.deployment("conv:1"),
      deploymentId: ids.deployment("dep_7f3a9c"),
      storylineVersionId: ids.storylineVersion("card-replacement:3"),
      externalContactId: ids.externalContact("a-karim"),
      roomId: ids.room("SES-1037"),
      currentStepId: ids.storylineStep("card-replacement:confirm"),
      slotsJson: { reason: "damaged", delivery_addr: "Villa 12, Al Barsha, Dubai", last4: "4821" },
      outcome: "RequestCreated",
      requestId: ids.request("REQ-9011"),
      rating: 5,
      startedAt: shift("2026-10-09T09:30:00Z"),
      endedAt: shift("2026-10-09T09:44:00Z"),
    },
  ]);
}
