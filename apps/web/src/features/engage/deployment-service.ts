import { isFeatureEnabled } from "@/features/governance/service";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { Rejected } from "@/lib/rejection";
import { accessibleAlternative, contrastAgainstWhite, meetsAA } from "@/lib/contrast";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { CreateDeploymentInput, SaveDeploymentInput } from "./schema";

/** The window the deployment detail reports on (`UC-63.1-07`). */
const THIRTY_DAYS_MS = 30 * 86_400_000;

/**
 * S-62 and S-63 in one read: every deployment, its storyline as the editor shows it, the
 * snippet a host site pastes, and what the last thirty days did.
 */
export async function loadDeployments() {
  await requirePermission("channels:read");
  if (!(await isFeatureEnabled(FEATURE_FLAGS.embeddedDeployments))) {
    return { enabled: false as const, deployments: [], extras: {}, agentOptions: [] };
  }
  const [deployments, options, projects, agentOptions] = await Promise.all([
    repository.listDeployments(),
    repository.listStorylineOptions(),
    repository.projectOptions(),
    repository.agentOptions(),
  ]);
  const extras = Object.fromEntries(
    await Promise.all(
      deployments.map(async (deployment) => {
        const codes = await repository.storylineCodesOf(deployment.id);
        const drafts = (await Promise.all(codes.map((code) => repository.readStorylineView(code)))).filter(
          (draft): draft is NonNullable<typeof draft> => draft !== null,
        );
        return [
          deployment.id,
          {
            drafts,
            options,
            projects,
            embedSnippet: snippetFor(deployment.id),
            activity: await repository.deploymentStats(deployment.id, new Date(Date.now() - THIRTY_DAYS_MS)),
          },
        ] as const;
      }),
    ),
  );
  return { enabled: true as const, deployments, extras, agentOptions };
}

/** Thrown when a deployment change is refused, for a reason the screen shows. */
export class DeploymentRejected extends Rejected {
  readonly suggestion?: string;

  constructor(message: string, messageAr: string, suggestion?: string) {
    super(message, messageAr);
    this.name = "DeploymentRejected";
    this.suggestion = suggestion;
  }
}

/**
 * `UC-62.1-02`: creates a Draft deployment on the chosen surfaces, with no allowed origins, and
 * audits it. Requires `channels:write`.
 */
export async function createDeployment(input: CreateDeploymentInput): Promise<void> {
  const session = await requirePermission("channels:write");
  await repository.createDeployment(input, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "channels:deployment",
    objectType: "EmbeddedDeployment",
    objectLabel: input.code,
    detail: { created: true, defaultAgent: input.defaultAgentCode, surfaces: input.surfaces },
  });
}

/**
 * `UC-63.1-01`: saves the deployment, after the two rules that decide whether it is safe to
 * publish — `UC-63.1-04` an enabled web widget needs somewhere it may run, and `UC-63.1-05`
 * the accent colour has to stay readable.
 *
 * @throws {DeploymentRejected} when either rule fails, carrying the suggested colour.
 */
export async function saveDeployment(input: SaveDeploymentInput): Promise<void> {
  const session = await requirePermission("channels:write");

  // D221: who an anonymous visitor's agent acts as is a grant, so only an administrator sets it,
  // and only to an active person.
  if (input.runAsPersonId !== undefined && input.runAsPersonId !== (await repository.runAsOf(input.code))) {
    await requirePermission("agents:configure");
    if (input.runAsPersonId && !(await repository.personIsActive(input.runAsPersonId))) {
      throw new DeploymentRejected("The assistant can only act as an active person.", "لا يعمل المساعد إلا باسم شخص نشط.");
    }
  }
  if (input.status === "Enabled" && input.surfaces.includes("Widget") && input.allowedOrigins.length === 0) {
    throw new DeploymentRejected("A web widget cannot be enabled with no allowed origins.", "لا يمكن تفعيل أداة الويب بلا مصادر مسموح بها.");
  }
  if (!meetsAA(input.accentColour)) {
    throw new DeploymentRejected(
      `Contrast ${contrastAgainstWhite(input.accentColour)}:1 against white is below WCAG 2.2 AA.`,
      `تباين ${contrastAgainstWhite(input.accentColour)}:1 مع الأبيض دون معيار WCAG 2.2 AA.`,
      accessibleAlternative(input.accentColour),
    );
  }

  // A quick action starts one of this deployment's own storylines (widget specification 8).
  if (input.quickActions?.length) {
    const own = new Set(await repository.storylineCodesOf(input.code));
    const unknown = input.quickActions.filter((action) => !own.has(action.storyline)).map((action) => action.storyline);
    if (unknown.length) {
      throw new DeploymentRejected(
        `A quick action names a storyline this deployment does not have: ${unknown.join(", ")}.`,
        `يشير إجراء سريع إلى سيناريو غير موجود في هذا النشر: ${unknown.join("، ")}.`,
      );
    }
    const ids = input.quickActions.map((action) => action.id);
    if (new Set(ids).size !== ids.length) {
      throw new DeploymentRejected("Two quick actions have the same id.", "لإجراءين سريعين المعرّف نفسه.");
    }
  }

  await repository.saveDeployment(input, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "channels:deployment",
    objectType: "EmbeddedDeployment",
    objectLabel: input.code,
    detail: { status: input.status, surfaces: input.surfaces, origins: input.allowedOrigins.length },
  });
}

/** `UC-63.1-*`: the conversation count a delete confirmation shows before it removes them. */
export async function deploymentConversationCount(code: string): Promise<number> {
  await requirePermission("channels:read");
  return repository.deploymentConversationCount(code);
}

/**
 * Removes a deployment — its surfaces, storylines and conversation history go with it.
 *
 * Refused while a channel still binds to it: that reference is not a foreign key (a
 * channel's binding is polymorphic), so nothing else would catch a channel routing to a
 * deployment that no longer exists.
 */
export async function deleteDeployment(code: string): Promise<void> {
  const session = await requirePermission("channels:write");

  const channels = await repository.deploymentBoundChannels(code);
  if (channels.length) {
    throw new DeploymentRejected(
      `This deployment cannot be deleted: ${channels.join(", ")} still binds to it.`,
      `لا يمكن حذف هذا النشر: لا يزال ${channels.join("، ")} مرتبطاً به.`,
    );
  }

  await repository.deleteDeployment(code);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "channels:delete",
    objectType: "EmbeddedDeployment",
    objectLabel: code,
  });
}

/** `UC-63.1-02`: the snippet the host website pastes. */
function snippetFor(code: string): string {
  // Widget specification 3.1: the loader, its deployment, and the attributes a host may change.
  return [
    "<script",
    `  src="${env().APP_URL.replace(/\/$/, "")}/embed/v1/widget.js"`,
    `  data-deployment="${code}"`,
    '  data-lang="auto"',
    '  data-position="bottom-right"',
    "  defer></script>",
  ].join("\n");
}
