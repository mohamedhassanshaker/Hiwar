import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The router only moves between screens once a person acts.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/embedded-deployment",
}));

// A screen calls its server actions over the network once a person acts; first render calls
// none, so each is a stub that would refuse if it ever were called.
vi.mock("@/features/engage/actions", () =>
  Object.fromEntries(
    [
      "addStorylineStep",
      "configureChannel",
      "createDeployment",
      "deleteDeployment",
      "deleteStorylineStep",
      "deploymentConversationCount",
      "mirrorRoom",
      "previewOpen",
      "previewTurn",
      "publishStorylineDraft",
      "requestTypeFields",
      "saveDeployment",
      "saveStorylineStep",
      "setChannelEnabled",
      "setStorylineMode",
      "simulateStoryline",
      "testChannel",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ToastProvider } from "@/components/shared/toast";
import { Deployments } from "@/features/engage/components/deployments";
import { type DeploymentExtras } from "@/features/engage/components/deployment-detail";
import { Storyline, type DraftView } from "@/features/engage/components/storyline";
import type { Step } from "@/features/engage/storyline-types";
import type { Deployment } from "@/features/engage/types";
import { PreferencesProvider } from "@/lib/preferences";
import type { Agent } from "@/types/directory";

/**
 * What the embedded-deployment screens draw on first render, held as a snapshot.
 *
 * Each screen is rendered with fixed props through `react-dom/server`, so the snapshot is
 * the markup a person sees before touching anything.
 */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const agent: Agent = {
  id: "def",
  ini: "DF",
  name: "Default agent",
  nameAr: "الوكيل الافتراضي",
  unit: "Operations",
  unitAr: "العمليات",
  ver: "v3",
  model: "reasoning-default",
  status: "Idle",
  profile: "Conversational",
  runs: 4,
  cost: 1.5,
};

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [agent], people: [me], projects: [], may }}>
        <ToastProvider>{node}</ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

const step = (over: Partial<Step> & Pick<Step, "name" | "type">): Step => ({
  messageEn: null,
  messageAr: null,
  sendVerbatim: false,
  slot: null,
  maxAttempts: null,
  verifyMethod: null,
  handoffQueue: null,
  toolRefs: [],
  skillRefs: [],
  agentCode: null,
  nextStepName: null,
  onError: "Handoff",
  config: {},
  ...over,
});

const draft: DraftView = {
  code: "card-replacement",
  nameEn: "Card replacement",
  nameAr: "استبدال البطاقة",
  versionNumber: 3,
  mode: "Strict",
  publishedVersionNumber: 2,
  steps: [
    step({ name: "greet", type: "Message", messageEn: "Hello {{name}}.", messageAr: "مرحباً {{name}}.", sendVerbatim: true, nextStepName: "ask_reason" }),
    step({
      name: "ask_reason",
      type: "Ask",
      messageEn: "Why do you need a new card?",
      messageAr: "لماذا تحتاج إلى بطاقة جديدة؟",
      slot: "reason",
      maxAttempts: 2,
      nextStepName: "block_card",
      config: { choices: [{ value: "lost", en: "Lost", ar: "مفقودة" }] },
    }),
    step({ name: "block_card", type: "Tool", toolRefs: ["cards/block"], agentCode: "def", nextStepName: "done", onError: "GoToStep", config: { branch: true, onErrorStepName: "done" } }),
    step({ name: "done", type: "End" }),
  ],
};
const options = { tools: ["cards/block", "crm/contact.lookup"], skills: ["card-policy"] };

describe("S-64 the storyline editor", () => {
  it("draws the draft with its first step open", () => {
    expect(renderScreen(<Storyline draft={draft} options={options} defaultAgent="def" />, ["channels:write"])).toMatchSnapshot();
  });
});

describe("S-62 the embedded deployments", () => {
  const deployment = (over: Partial<Deployment> & Pick<Deployment, "id" | "n" | "nAr">): Deployment => ({
    a: "def",
    surf: "Widget · WhatsApp",
    sl: "Card replacement v2",
    rate: 4.5,
    conv: 12,
    st: "Enabled",
    allowedOrigins: ["https://example.test"],
    visitorIdentity: "AnonymousOtpStepUp",
    visitorJwtFallback: "Anonymous",
    handoffQueue: null,
    runAs: null,
    rateLimitPerVisitor: 20,
    widgetTitleEn: "Help",
    widgetTitleAr: "مساعدة",
    accentColour: "#12034B",
    welcomeEn: null,
    welcomeAr: null,
    disclaimerEn: null,
    disclaimerAr: null,
    disclaimerDismissible: true,
    quickActions: [],
    voiceInput: true,
    readAloud: true,
    sessionIdleMinutes: 30,
    progressRetentionMinutes: 1440,
    storylines: ["card-replacement"],
    version: 1,
    ...over,
  });
  const deployments = [
    deployment({ id: "dep_one", n: "Customer help", nAr: "مساعدة العملاء" }),
    deployment({ id: "dep_two", n: "Vendor intake", nAr: "استقبال الموردين", st: "Draft", rate: 0, sl: "—", surf: "Widget" }),
  ];
  const extras: Record<string, DeploymentExtras> = {
    dep_one: {
      drafts: [draft],
      options,
      embedSnippet: '<script src="https://platform.example.test/embed/v1/widget.js" data-deployment="dep_one" defer></script>',
      activity: { conversations: 12, rating: 4.5, scenarios: [], dropOff: [], otp: { verified: 0, locked: 0 } },
      projects: [{ key: "OPS", nameEn: "Operations", nameAr: "العمليات" }],
    },
  };

  it("draws the list of deployments", () => {
    expect(
      renderScreen(<Deployments deployments={deployments} extras={extras} agentOptions={[{ code: "def", nameEn: "Default agent", nameAr: "الوكيل الافتراضي" }]} />, [
        "channels:write",
      ]),
    ).toMatchSnapshot();
  });
});
