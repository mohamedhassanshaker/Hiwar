import { Rejected } from "@/lib/rejection";
import * as repository from "./repository";
import { newConversation } from "./storyline";
import { type Choice, type Conversation, type FormField } from "./storyline-types";

/** Why a visitor was refused, as the widget shows it. */
export class VisitorRefused extends Rejected {
  readonly reason:
    | "OriginNotAllowed"
    | "DeploymentOff"
    | "NoStoryline"
    | "NotYours"
    | "RateLimited"
    | "NoConversation"
    | "IdentityRequired";

  constructor(reason: VisitorRefused["reason"], message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "VisitorRefused";
    this.reason = reason;
  }
}

export type VisitorLine = { role: string; kind: string; textEn: string | null; textAr: string | null; payload: Record<string, unknown> };

export type VisitorView = {
  conversationId: string;
  title: { en: string; ar: string };
  accentColour: string | null;
  welcome: { en: string; ar: string } | null;
  visitorIdentity: string;
  storyline: { code: string; versionNumber: number; mode: string; step: number; total: number } | null;
  lines: VisitorLine[];
  awaiting: "Reply" | "Confirmation" | "Otp" | "Form" | null;
  quickReplies: Choice[];
  formFields: FormField[];
  outcome: string | null;
  rating: number | null;
  /** `UC-63.1-09`: the default agent cannot run, so a person is offered instead. */
  agentWarning: string | null;
  /** The agent is still answering (D221): the widget asks again until its reply is written. */
  pending: boolean;
  /** Only in a console preview: the code the platform could not deliver anywhere. */
  previewOtp?: string;
};

/** Everything the runtime keeps that is not the engine's business. */
export type RuntimeState = {
  engine: Conversation;
  otp?: { hash: string; expiresAt: number; attempts: number; resends: number; undeliverable?: boolean; preview?: string };
  handoffQueue?: string;
  /** A half-finished scenario the visitor came back to: the widget offers to continue it. */
  resumable?: boolean;
  /** The widget's recent message ids, so a retried send is taken once. */
  clientMessages?: string[];
  /** The language the visitor reads. */
  lang?: "en" | "ar";
};

/** A conversation's stored state, with a fresh engine conversation when none is stored. */
export function readState(stored: Record<string, unknown>): RuntimeState {
  const state = stored as Partial<RuntimeState>;
  return {
    engine: state.engine ?? newConversation(),
    otp: state.otp,
    handoffQueue: state.handoffQueue,
    resumable: state.resumable,
    clientMessages: state.clientMessages,
    lang: state.lang,
  };
}

/** The quick replies the last emission offered, which is what the visitor may tap. */
function quickRepliesOf(lines: VisitorLine[]): Choice[] {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].kind === "QuickReplies") return (lines[index].payload.choices ?? []) as Choice[];
    if (lines[index].role === "Visitor") return [];
  }
  return [];
}

/** The fields a `Form` step asked for, which is what the visitor fills in at once. */
function formFieldsOf(lines: VisitorLine[]): FormField[] {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].kind === "FormPrompt") return (lines[index].payload.fields ?? []) as FormField[];
    if (lines[index].role === "Visitor") return [];
  }
  return [];
}

function warningFor(status: string | null): string | null {
  if (status === "Paused") return "The assistant is paused. You can ask for a person instead.";
  if (status === "Error") return "The assistant is not working. You can ask for a person instead.";
  return null;
}

/** What the widget draws, read back from what was written. */
export async function view(conversationId: string, preview: boolean): Promise<VisitorView> {
  const conversation = await repository.readConversation(conversationId);
  if (!conversation) throw new VisitorRefused("NoConversation", "This conversation no longer exists.", "لم تعد هذه المحادثة موجودة.");
  const deployment = await repository.readRunnableDeployment(conversation.deploymentCode);
  const state = readState(conversation.stateJson ?? {});
  const lines = await repository.readTranscript(conversationId);

  const storyline = conversation.storylineVersionId ? await repository.readRunnableStoryline(conversation.storylineVersionId) : null;
  const stepIndex = storyline ? storyline.steps.findIndex((step) => step.name === state.engine.stepName) : -1;

  return {
    conversationId,
    title: {
      en: deployment?.widgetTitleEn ?? conversation.deploymentCode,
      ar: deployment?.widgetTitleAr ?? conversation.deploymentCode,
    },
    accentColour: deployment?.accentColour ?? null,
    welcome: deployment?.welcomeEn ? { en: deployment.welcomeEn, ar: deployment.welcomeAr ?? deployment.welcomeEn } : null,
    visitorIdentity: deployment?.visitorIdentity ?? "AnonymousOtpStepUp",
    storyline: storyline
      ? {
          code: storyline.code,
          versionNumber: storyline.versionNumber,
          mode: storyline.mode,
          step: stepIndex >= 0 ? stepIndex + 1 : storyline.steps.length,
          total: storyline.steps.length,
        }
      : null,
    lines,
    awaiting: state.engine.awaiting,
    quickReplies: quickRepliesOf(lines),
    formFields: formFieldsOf(lines),
    outcome: conversation.outcome,
    rating: conversation.rating,
    agentWarning: warningFor(deployment?.defaultAgentStatus ?? null),
    pending: await repository.agentAnswering(conversationId),
    ...(preview && state.otp?.preview ? { previewOtp: state.otp.preview } : {}),
  };
}

/** The origins one deployment allows, which is what the widget endpoint answers for. */
export async function allowedOriginsOf(deploymentCode: string): Promise<string[]> {
  const deployment = await repository.readRunnableDeployment(deploymentCode);
  return deployment?.allowedOrigins ?? [];
}

