import { audit } from "@/lib/audit";
import * as repository from "./repository";
import { requireAgentPermission } from "./version-service";
import { AgentRejected } from "./errors";

/** The score a version must reach before it may be published (`UC-51.3-04`). */
const EVALUATION_GATE = 70;

/**
 * `UC-51.3-02`: publish the draft, which is what new runs then use.
 *
 * `UC-51.3-03` refuses empty release notes: the version list is what someone reads when a
 * run misbehaves, and a row with no note explains nothing. `UC-51.3-04` refuses a version
 * whose evaluation is below the gate, with the score. `UC-51.3-05` is the permission —
 * designing an agent and publishing one are deliberately different rights.
 *
 * @throws {AgentRejected} when there is nothing to publish, the notes are empty, or the
 *   evaluation has not passed.
 */
export async function publishVersion(input: { code: string; releaseNotes: string }): Promise<number> {
  const session = await requireAgentPermission("agents:publish", input.code);

  const versionId = await repository.draftVersionId(input.code, session.personId);
  if (!versionId) throw new AgentRejected("That agent no longer exists.", "لم يعد هذا الوكيل موجوداً.");

  const version = await repository.readVersion(versionId);
  if (!version) throw new AgentRejected("There is no draft to publish.", "لا توجد مسودة لنشرها.");

  const notes = input.releaseNotes.trim();
  if (!notes) throw new AgentRejected("Release notes are required.", "ملاحظات الإصدار مطلوبة.");

  if (version.evalScore !== null && version.evalScore < EVALUATION_GATE) {
    throw new AgentRejected(
      `The evaluation scored ${version.evalScore}, below the gate of ${EVALUATION_GATE}.`,
      `بلغت درجة التقييم ${version.evalScore}، وهي دون الحد ${EVALUATION_GATE}.`,
    );
  }

  const published = await repository.publishVersion(input.code, versionId, notes, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:publish",
    objectType: "AgentVersion",
    objectLabel: `${input.code} v${published}`,
    detail: { versionNumber: published },
  });
  return published;
}
