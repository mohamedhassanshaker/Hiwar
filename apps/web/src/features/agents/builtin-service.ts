import { audit } from "@/lib/audit";
import * as repository from "./repository";
import { requireAgentPermission } from "./version-service";
import { BUILTIN_DEFAULTS, BUILTIN_DEFAULT_VERSION } from "./builtin";
import { AgentRejected } from "./errors";

/**
 * Grants the draft one platform or harness tool, or revokes it (D38, D80).
 *
 * The grant is data: this writes a name, and the platform MCP server is what refuses
 * everything outside it (D29, D30). A name the catalogue does not carry therefore grants
 * nothing — it is filtered out of `tools/list` and refused at `tools/call`.
 */
/**
 * Put the built-in Assistant back to the configuration it shipped with (D65).
 *
 * Instructions, grant, skills and budgets only. Its runs, memory and audit trail are history
 * rather than configuration, and a reset that erased them would be a different and much
 * worse operation than the one the button offers.
 *
 * Applied to the draft version, like every other configuration change, so it is
 * published deliberately rather than taking effect under a mission already running.
 *
 * @throws {AgentRejected} for any agent that is not the built-in one. There is nothing
 * to reset to for an agent a person wrote: the platform never had an opinion about it.
 */
export async function resetBuiltinToDefaults(code: string): Promise<void> {
  const session = await requireAgentPermission("agents:configure", code);

  if (!(await repository.isBuiltinAgent(code))) {
    throw new AgentRejected(
      `${code} is not the built-in assistant, so there are no platform defaults to restore.`,
      `${code} ليس المساعد المدمج، لذا لا توجد إعدادات افتراضية لاستعادتها.`,
    );
  }

  const versionId = await repository.draftVersionId(code, session.personId);
  if (!versionId) {
    throw new AgentRejected(
      `${code} has no draft version to reset.`,
      `لا توجد نسخة مسودة لـ ${code} لإعادة ضبطها.`,
    );
  }

  await repository.resetVersionConfiguration(versionId, BUILTIN_DEFAULTS, session.personId);
  await repository.replacePlatformToolGrant(versionId, BUILTIN_DEFAULTS.tools, session.personId);
  await repository.replaceSkills(versionId, BUILTIN_DEFAULTS.skills);
  await repository.markDefaultVersion(code, BUILTIN_DEFAULT_VERSION);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:configure",
    objectType: "Agent",
    objectLabel: code,
    detail: { reset: "defaults", defaultVersion: BUILTIN_DEFAULT_VERSION },
  });
}
