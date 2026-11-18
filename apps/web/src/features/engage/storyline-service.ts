import type { Mode } from "./storyline-types";
import * as requests from "@/features/requests/service";
import { Rejected } from "@/lib/rejection";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/session";
import { advance, newConversation } from "./storyline";
import { dependentSteps, publishProblems, type PublishProblem } from "./storyline-publish";
import { type FormField } from "./storyline-types";
import * as repository from "./repository";
import type { AddStepInput, DeleteStepInput, SetModeInput, SimulateInput, StorylineStepInput } from "./schema";

/** Thrown when an editor change or a publish is refused. */
export class StorylineRejected extends Rejected {
  readonly problems: PublishProblem[];

  constructor(message: string, messageAr: string, problems: PublishProblem[] = []) {
    super(message, messageAr);
    this.name = "StorylineRejected";
    this.problems = problems;
  }
}

/**
 * The fields a `Form` step shows, copied from a request type's own published attributes.
 *
 * A `Form` step's `config.formFields` is authored once rather than read live off the type
 * (the same choice `Ask`'s `slot` already makes), so this is a sync the designer asks for —
 * not something the engine or the widget ever calls on their own.
 */
export async function requestTypeFields(requestTypeCode: string): Promise<FormField[]> {
  await requirePermission("channels:write");
  const detail = await requests.loadRequestTypeDetail(requestTypeCode);
  if (!detail) throw new StorylineRejected(`No request type ${requestTypeCode}.`, `لا يوجد نوع طلب بالرمز ${requestTypeCode}.`);
  return detail.attributes.filter((attribute) => attribute.stepName === null).map((attribute) => ({
    key: attribute.key,
    labelEn: attribute.labelEn,
    labelAr: attribute.labelAr,
    dataType: attribute.dataType,
    required: attribute.required,
    ...(attribute.enumValues?.length ? { choices: attribute.enumValues.map((one) => ({ value: one.value, en: one.labelEn, ar: one.labelAr })) } : {}),
  }));
}

/**
 * D219: give a deployment a storyline, as an empty draft the editor then fills and publishes.
 * The first is under the deployment's code; each further one, a scenario a quick action
 * starts, is named (D231).
 */
export async function createStoryline(deploymentCode: string, named?: { code: string; nameEn: string; nameAr: string }): Promise<void> {
  const session = await requirePermission("channels:write");
  if (!(await repository.createStoryline(deploymentCode, session.personId, named))) {
    throw new StorylineRejected(
      named ? `${deploymentCode} already has a storyline ${named.code}, or does not exist.` : `${deploymentCode} already has a storyline, or does not exist.`,
      named ? `لدى ${deploymentCode} سيناريو ${named.code} بالفعل، أو أنه غير موجود.` : `لدى ${deploymentCode} سيناريو بالفعل، أو أنه غير موجود.`,
    );
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "channels:storyline",
    objectType: "Storyline",
    objectLabel: named?.code ?? deploymentCode,
  });
}

/**
 * `UC-64.1-04` … `-06`: saves one step of the storyline's draft, copying the published version
 * to a new draft first when there is none. Requires `channels:write`; not audited.
 */
export async function saveStorylineStep(input: StorylineStepInput): Promise<void> {
  const session = await requirePermission("channels:write");
  const draft = await repository.ensureStorylineDraft(input.code, session.personId);
  if (!draft) throw new StorylineRejected(`No storyline ${input.code}.`, `لا يوجد سيناريو بالرمز ${input.code}.`);
  await repository.saveStorylineStep(draft.versionId, input, session.personId);
}

/**
 * `UC-64.1-04`: adds a Message step to the draft after the named step, or at the end. Refuses a
 * name the draft already has. Requires `channels:write`.
 */
export async function addStorylineStep(input: AddStepInput): Promise<void> {
  const session = await requirePermission("channels:write");
  const draft = await repository.ensureStorylineDraft(input.code, session.personId);
  if (!draft) throw new StorylineRejected(`No storyline ${input.code}.`, `لا يوجد سيناريو بالرمز ${input.code}.`);
  if (draft.steps.some((step) => step.name === input.name)) {
    throw new StorylineRejected(
      `This storyline already has a step called ${input.name}.`,
      `يوجد في هذا السيناريو خطوة باسم ${input.name} بالفعل.`,
    );
  }
  await repository.addStorylineStep(draft.versionId, input.name, input.afterName, session.personId);
}

/** `UC-64.1-07`: deleting a step, and naming the steps that pointed at it. */
export async function deleteStorylineStep(input: DeleteStepInput): Promise<{ toFix: string[] }> {
  const session = await requirePermission("channels:write");
  const draft = await repository.ensureStorylineDraft(input.code, session.personId);
  if (!draft) throw new StorylineRejected(`No storyline ${input.code}.`, `لا يوجد سيناريو بالرمز ${input.code}.`);
  const toFix = dependentSteps(draft.steps, input.name);
  await repository.deleteStorylineStep(draft.versionId, input.name);
  return { toFix };
}

/** Sets the draft's mode, creating the draft first when there is none. Requires `channels:write`. */
export async function setStorylineMode(input: SetModeInput): Promise<void> {
  const session = await requirePermission("channels:write");
  const draft = await repository.ensureStorylineDraft(input.code, session.personId);
  if (!draft) throw new StorylineRejected(`No storyline ${input.code}.`, `لا يوجد سيناريو بالرمز ${input.code}.`);
  await repository.setStorylineMode(draft.versionId, input.mode, session.personId);
}

/** Everything that would block a publish, which the editor shows before it is clicked. */
export async function publishProblemsOf(code: string): Promise<PublishProblem[]> {
  await requirePermission("channels:read");
  const draft = await repository.readStorylineView(code);
  if (!draft) throw new StorylineRejected(`No storyline ${code}.`, `لا يوجد سيناريو بالرمز ${code}.`);
  const deployment = await repository.deploymentOfStoryline(code);

  const allowed = new Map<string | null, string[]>();
  for (const step of draft.steps) {
    if (step.type !== "Tool" || allowed.has(step.agentCode)) continue;
    allowed.set(step.agentCode, await repository.toolsAllowedTo(step.agentCode, deployment?.defaultAgentCode ?? null));
  }

  return publishProblems(
    { code: draft.code, versionNumber: draft.versionNumber, mode: draft.mode as Mode, steps: draft.steps },
    { arabicEnabled: true, allowedTools: (agentCode) => allowed.get(agentCode) ?? [] },
  );
}

/**
 * `UC-64.1-09`: publishes the draft as the next version.
 *
 * @throws {StorylineRejected} listing the steps that block it (`UC-64.1-10` … `-12`).
 */
export async function publishStoryline(code: string): Promise<number> {
  const session = await requirePermission("channels:write");
  const problems = await publishProblemsOf(code);
  if (problems.length > 0) throw new StorylineRejected("This storyline is not ready to publish.", "هذا السيناريو غير جاهز للنشر.", problems);

  const draft = await repository.ensureStorylineDraft(code, session.personId);
  if (!draft) throw new StorylineRejected(`No storyline ${code}.`, `لا يوجد سيناريو بالرمز ${code}.`);
  const versionNumber = await repository.publishStorylineVersion(draft.versionId, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "channels:publish_storyline",
    objectType: "Storyline",
    objectLabel: code,
    detail: { versionNumber, mode: draft.mode },
  });
  return versionNumber;
}

/** One line of a simulation, as the designer reads it. */
export type SimulatedLine = { from: "Agent" | "Visitor" | "System"; text: string; step: string | null };

/**
 * `UC-64.1-08`: runs the draft against test variables and a list of replies.
 *
 * Nothing is written and nothing is called: the engine runs on its own, and an effect is
 * reported as having succeeded so the designer sees the path rather than the plumbing. A
 * step whose On error path is being tested is driven by a reply of `fail`.
 */
export async function simulateStoryline(input: SimulateInput): Promise<{ lines: SimulatedLine[]; slots: Record<string, string>; outcome: string | null }> {
  await requirePermission("channels:write");
  const draft = await repository.readStorylineView(input.code);
  if (!draft) throw new StorylineRejected(`No storyline ${input.code}.`, `لا يوجد سيناريو بالرمز ${input.code}.`);

  const storyline = {
    code: draft.code,
    versionNumber: draft.versionNumber,
    mode: draft.mode as Mode,
    steps: draft.steps,
  };
  const lines: SimulatedLine[] = [];
  let state = { ...newConversation(), slots: { ...input.variables } };

  const play = (result: ReturnType<typeof advance>) => {
    for (const emission of result.emissions) {
      if (emission.kind === "Message" || emission.kind === "Confirm") lines.push({ from: "Agent", text: emission.en, step: result.state.stepName });
      if (emission.kind === "OtpPrompt") lines.push({ from: "System", text: `Waiting for a ${emission.method} code`, step: result.state.stepName });
      if (emission.kind === "Ended") lines.push({ from: "System", text: `Ended: ${emission.outcome}`, step: null });
    }
    state = result.state;
    return result;
  };

  let result = play(advance(storyline, state, { kind: "Open" }));
  const replies = [...input.turns];

  // Each loop either consumes a reply or settles an effect, and both are bounded.
  for (let guard = 0; guard < replies.length + draft.steps.length * 2; guard += 1) {
    if (state.outcome !== null) break;
    // A side answer is the agent's reply; the script stays where it is, as it does live.
    if (result.effects.length > 0 && result.effects.every((effect) => effect.kind === "SideAnswer")) {
      lines.push({ from: "System", text: "SideAnswer", step: state.stepName });
      result = { ...result, effects: [] };
      continue;
    }
    if (result.effects.length > 0) {
      const failing = replies[0] === "fail";
      if (failing) replies.shift();
      for (const effect of result.effects) {
        lines.push({ from: "System", text: `${effect.kind}${failing ? " failed" : ""}`, step: effect.kind === "Handoff" ? null : (effect as { step?: string }).step ?? null });
      }
      result = play(advance(storyline, state, { kind: "Resume", ok: !failing, reference: "REQ-SIMULATED" }));
      continue;
    }
    const reply = replies.shift();
    if (reply === undefined) break;
    lines.push({ from: "Visitor", text: reply, step: state.stepName });
    const turn =
      state.awaiting === "Confirmation"
        ? reply.toLowerCase() === "change"
          ? ({ kind: "Change" } as const)
          : ({ kind: "Confirm" } as const)
        : state.awaiting === "Otp"
          ? ({ kind: "Resume", ok: reply !== "fail" } as const)
          : ({ kind: "Reply", text: reply } as const);
    result = play(advance(storyline, state, turn));
  }

  return { lines, slots: state.slots, outcome: state.outcome };
}
