/** Channels, embedded deployments and storylines (S-61 to S-65). */

export type Channel = {
  /** WebWidget, WhatsApp or MicrosoftTeams. */
  type: string;
  on: boolean;
  /** Enabled, Degraded or Disabled. */
  st: string;
  boundToEn: string;
  boundToAr: string;
};

export type Deployment = {
  id: string;
  n: string;
  nAr: string;
  /** The default agent's code. */
  a: string;
  /** The surfaces it is published on, as the list writes them. */
  surf: string;
  /** The published storyline, or an em dash. */
  sl: string;
  rate: number;
  conv: number;
  st: string;
  allowedOrigins: string[];
  visitorIdentity: string;
  visitorJwtFallback: string;
  handoffQueue: string | null;
  /** The person the agent acts as for a visitor's free conversation (D221). */
  runAs: string | null;
  rateLimitPerVisitor: number | null;
  widgetTitleEn: string | null;
  widgetTitleAr: string | null;
  accentColour: string | null;
  welcomeEn: string | null;
  welcomeAr: string | null;
  /** The widget's own settings (widget specification 3.3, D231). */
  disclaimerEn: string | null;
  disclaimerAr: string | null;
  disclaimerDismissible: boolean;
  quickActions: QuickAction[];
  voiceInput: boolean;
  readAloud: boolean;
  sessionIdleMinutes: number;
  progressRetentionMinutes: number;
  /** The deployment's storylines, by code, which a quick action may start. */
  storylines: string[];
  /** Guards a save against another designer's change (requirement 26). */
  version: number;
};

export type QuickAction = {
  id: string;
  labelEn: string;
  labelAr: string;
  storyline: string;
  pages: string[];
  minIdentity: "anonymous" | "otp_verified" | "logged_in";
};

export type StorylineStep = {
  id: string;
  /** say, ask, confirm, decide, classify, tool, skill, verify, create_work, handoff, wait, subflow, goto, end. */
  type: string;
  t: string;
  tAr: string;
  exact?: boolean;
  slot?: string;
  branch?: boolean;
  agent: string;
  tools: string[];
  skills: string[];
};

export type StorylineVersion = {
  code: string;
  nameEn: string;
  nameAr: string;
  versionNumber: number;
  mode: string;
  status: string;
  steps: StorylineStep[];
};

/** The fourteen storyline step types of data model section 16. */
export const STEP_TYPES: [string, string, string][] = [
  ["say", "Message", "رسالة"],
  ["ask", "Ask", "سؤال"],
  ["form", "Form", "نموذج"],
  ["confirm", "Confirm", "تأكيد"],
  ["decide", "Decide", "قرار"],
  ["classify", "Classify", "تصنيف"],
  ["tool", "Tool", "أداة"],
  ["skill", "Skill", "مهارة"],
  ["verify", "Verify", "تحقق"],
  ["create_work", "Create work", "إنشاء عمل"],
  ["handoff", "Handoff", "تحويل"],
  ["wait", "Wait", "انتظار"],
  ["subflow", "Subflow", "تدفق فرعي"],
  ["goto", "Go to", "انتقال"],
  ["end", "End", "نهاية"],
];

/** The channels the specification marks "coming soon" (out of scope for v1). */
export const COMING_SOON = ["Slack", "Email", "SMS", "Voice / IVR", "Telegram", "Webex", "Google Chat", "Instagram", "Facebook Messenger"];

/** How the console names each live channel. */
export const CHANNEL_LABEL: Record<string, [string, string]> = {
  WebWidget: ["Web widget", "ويدجت الويب"],
  WhatsApp: ["WhatsApp", "واتساب"],
  MicrosoftTeams: ["Microsoft Teams", "مايكروسوفت تيمز"],
};

/** One channel's whole configuration, as the Configure drawer reads and writes it. */
export type ChannelConfig = {
  type: string;
  isEnabled: boolean;
  status: string;
  bindingType: string | null;
  bindingDeploymentCode: string | null;
  unknownSenders: string;
  rateLimitPerMinute: number;
  businessHours: string;
  offlineMessageEn: string | null;
  offlineMessageAr: string | null;
  endpointUrl: string | null;
  /** The credentials themselves are never read back (specification 9). */
  hasSecret: boolean;
  hasInboundSecret: boolean;
  lastTestAt: string | null;
  lastTestChecks: ChannelCheck[];
  version: number;
};

/** One line of the Test channel result (`UC-61.1-03`, `UC-61.1-05`). */
export type ChannelCheck = { name: string; ok: boolean; detail: string; ms: number | null };

export type ScenarioStats = { scenario: string; started: number; completed: number; handedOff: number; stopped: number };

export type DeploymentStats = {
  conversations: number;
  rating: number | null;
  /** Widget specification 15: per scenario, how many started, finished, went to a person or stopped. */
  scenarios: ScenarioStats[];
  /** Where scenarios that were stopped or abandoned last stood, most common first. */
  dropOff: { scenario: string; step: string; count: number }[];
  otp: { verified: number; locked: number };
};

/** One line of a visitor conversation as stored and read back. */
export type TranscriptLine = {
  role: string;
  kind: string;
  textEn: string | null;
  textAr: string | null;
  payload: Record<string, unknown>;
  /** Where the line is in the conversation, and when it was written; set when read back. */
  seq?: number;
  at?: string;
};

/** Where a conversation stands, as the Conversations screen filters and shows it (D342). */
export type ConversationStatus = "Live" | "AgentPaused" | "HandedOff" | "Ended";

export type ConversationFilter = {
  deploymentCode?: string;
  /** Started within the last this many days. */
  sinceDays?: number;
  /** Started on or after `from`, and before `to`. */
  from?: Date;
  to?: Date;
  status?: ConversationStatus;
  /** Matched literally against what was said and the visitor's key. */
  text?: string;
};

export type ConversationRow = {
  id: string;
  deploymentCode: string;
  deploymentNameEn: string;
  deploymentNameAr: string;
  startedAt: string;
  lastAt: string | null;
  messages: number;
  status: ConversationStatus;
  outcome: string | null;
  rating: number | null;
  channelType: string | null;
  requestKey: string | null;
  pausedBy: string | null;
  /** The visitor's first message, which names what the conversation is about. */
  firstText: string | null;
};

export type ConversationSummary = Omit<ConversationRow, "messages" | "firstText"> & {
  endedAt: string | null;
  pausedAt: string | null;
  roomKey: string | null;
};

/** An open conversation in the panel beside a conversation (D344): the agent's, or one this person holds. */
export type ActiveConversation = {
  id: string;
  deploymentNameEn: string;
  deploymentNameAr: string;
  lastAt: string | null;
  /** What the visitor last wrote. */
  lastText: string | null;
  /** This person has taken it over; otherwise the agent is answering. */
  mine: boolean;
};

/** What the conversations channel says, for the panel and desktop alerts (D344). */
export type ConversationActivity =
  | { kind: "started"; conversationId: string; deployment: string | null }
  | { kind: "message"; conversationId: string; fromVisitor: boolean; pausedBy: string | null; deployment: string | null }
  | { kind: "state"; conversationId: string };
