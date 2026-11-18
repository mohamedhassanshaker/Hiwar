import { strToU8, zipSync } from "fflate";

import { audit } from "@/lib/audit";
import { egressFetch } from "@/lib/egress";
import { env } from "@/lib/env";
import { buckets, putObject } from "@/lib/objects";
import { packageToStore, readPackage, reviewPackage, type PackageReview } from "@/lib/skill-package";
import { requireOrganisationPermission } from "@/lib/session";
import * as repository from "./repository";
import { SkillRejected } from "./errors";

/** A skill name from a title, in the shape the registry and the loader both use. */
function skillNameFrom(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

/**
 * Writes a package's files under `skillName/versionLabel/` in the `skills` bucket.
 *
 * The agent service has no route to this console: it reads a skill's body from the `skills`
 * bucket, at the same `bucket/key` reference every object store write returns. Without this,
 * a skill version is a database row an agent can never actually load.
 */
async function storePackage(review: PackageReview, skillName: string, versionLabel: string): Promise<void> {
  await Promise.all(
    packageToStore(review.files, skillName).map((file) =>
      putObject(
        buckets.skills,
        `${skillName}/${versionLabel}/${file.path}`,
        file.data,
        file.path.endsWith(".md") ? "text/markdown; charset=utf-8" : "application/octet-stream",
      ),
    ),
  );
}

/**
 * The label of the version an update adds: the next minor of `1.0.0`, the next `v2` of `v1`,
 * or the current label with a counter, skipping any label the skill already has.
 */
export function nextVersionLabel(current: string, taken: readonly string[]): string {
  const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  const numbered = /^v(\d+)$/i.exec(current);
  const candidate = (step: number) =>
    semver
      ? `${semver[1]}.${Number(semver[2]) + step}.0`
      : numbered
        ? `v${Number(numbered[1]) + step}`
        : `${current}-${step + 1}`;
  let step = 1;
  while (taken.includes(candidate(step))) step += 1;
  return candidate(step);
}

/**
 * `UC-53.2`: replace an installed skill's files from a new package, as a new version.
 *
 * The package is validated as an import is, and stored as the skill's next version, which
 * becomes its current one. The earlier version and its files stay: an agent version pinned to
 * it keeps loading what it was published with. With `moveAgents`, the agents' active versions
 * and open drafts that carry the skill move to the new version, as Import's "Enable for
 * agents" pins an active version; earlier published agent versions keep their pin.
 *
 * @throws {SkillRejected} when the skill is gone or bundled, or the package may not be imported.
 */
export async function updateSkillPackage(input: {
  skillName: string;
  zipBase64?: string;
  gitUrl?: string;
  moveAgents: boolean;
}): Promise<{ versionLabel: string; moved: { agent: string; version: number }[] }> {
  const session = await requireOrganisationPermission("skills:write");

  const installed = await repository.packageOf(input.skillName);
  if (!installed) throw new SkillRejected("That skill no longer exists.", "لم تعد هذه المهارة موجودة.");
  // D228: a bundled skill ships in the agent image, so its files are not the console's to replace.
  if (installed.sourceType === "Bundled") {
    throw new SkillRejected(
      `${input.skillName} ships with the platform and cannot be updated here.`,
      `${input.skillName} مدمجة في المنصة ولا يمكن تحديثها هنا.`,
    );
  }

  const review = await validateSkillPackage(input);
  if (review.blockers.length) {
    throw new SkillRejected("This package cannot be imported.", "لا يمكن استيراد هذه الحزمة.", review.blockers);
  }

  const versionLabel = nextVersionLabel(installed.versionLabel, await repository.versionLabels(input.skillName));
  await storePackage(review, input.skillName, versionLabel);

  const moved = input.moveAgents ? await repository.agentVersionsUsingSkill(input.skillName) : [];
  await repository.addSkillVersion({
    skillName: input.skillName,
    versionLabel,
    descriptionEn: review.description,
    declaredTools: review.declaredTools,
    scan: review.scan,
    moveAgents: input.moveAgents,
    personId: session.personId,
  });

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "skills:write",
    objectType: "Skill",
    objectLabel: input.skillName,
    detail: {
      updated: true,
      from: installed.versionLabel,
      to: versionLabel,
      source: input.gitUrl ?? "upload",
      movedAgents: moved.map((use) => `${use.agent} v${use.version}`),
      scan: review.scan,
    },
  });
  return { versionLabel, moved };
}

/**
 * D376: an installed skill's next version from the text of its files, which is how an agent
 * hands a package over. The files are zipped and go through `updateSkillPackage` exactly as an
 * uploaded package does, so the scan, the limits and the refusals are the same.
 *
 * @throws {SkillRejected} as `updateSkillPackage` does, with a path that climbs out among them.
 */
export async function updateSkillFiles(input: {
  skillName: string;
  files: { path: string; content: string }[];
  moveAgents: boolean;
}): Promise<{ versionLabel: string; moved: { agent: string; version: number }[] }> {
  const zip = zipSync(Object.fromEntries(input.files.map((file) => [file.path, strToU8(file.content)])));
  return updateSkillPackage({ skillName: input.skillName, zipBase64: Buffer.from(zip).toString("base64"), moveAgents: input.moveAgents });
}

/**
 * `UC-53.2-01`: read a package and say what it is and whether it may be imported.
 *
 * Nothing is stored. The screen shows the file list, the scan and the verdict, and the
 * import is a second, deliberate step — `UC-53.2-08` goes back from here without having
 * changed anything.
 */
export async function validateSkillPackage(input: {
  zipBase64?: string;
  gitUrl?: string;
}): Promise<PackageReview> {
  await requireOrganisationPermission("skills:write");

  let bytes: Uint8Array;
  if (input.gitUrl) {
    bytes = await fetchPackageFromGit(input.gitUrl);
  } else if (input.zipBase64) {
    bytes = Uint8Array.from(Buffer.from(input.zipBase64.split(",").pop() ?? "", "base64"));
  } else {
    throw new SkillRejected("Choose a package or a Git URL.", "اختر حزمة أو عنوان Git.");
  }

  let files;
  try {
    files = readPackage(bytes);
  } catch (problem) {
    throw new SkillRejected(
      problem instanceof Error ? problem.message : "That is not a skill package.",
      problem instanceof Error ? problem.message : "هذا ليس حزمة مهارة.",
    );
  }
  return reviewPackage(files);
}

/**
 * `UC-53.2-03`: fetch a package from a Git URL.
 *
 * Only an archive over HTTPS from a host the platform is configured to allow. A skill is
 * code the agents will follow, and fetching one from an arbitrary host on an admin's say-so
 * is how a supply chain is compromised — the allow-list is what makes this an import from
 * a known registry rather than a download.
 *
 * @throws {SkillRejected} when the host is not allowed, or the URL cannot be reached.
 */
async function fetchPackageFromGit(url: string): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SkillRejected("That is not a URL.", "هذا ليس عنوان ويب صالحاً.");
  }
  if (parsed.protocol !== "https:") throw new SkillRejected("A skill package must be fetched over HTTPS.", "يجب جلب حزمة المهارة عبر HTTPS.");

  const allowed = (env().SKILL_GIT_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean);
  if (!allowed.includes(parsed.hostname)) {
    throw new SkillRejected(
      `Packages may only be fetched from ${allowed.length ? allowed.join(", ") : "a configured host"}.`,
      `لا تُجلب الحزم إلا من ${allowed.length ? allowed.join("، ") : "مضيف مُعدّ مسبقاً"}.`,
    );
  }

  let response: Response;
  try {
    response = await egressFetch(parsed, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch (problem) {
    // `UC-53.2-07`: the URL could not be reached, and the screen says so rather than
    // leaving the admin on a spinner.
    throw new SkillRejected(
      `That URL could not be reached: ${String(problem).slice(0, 120)}`,
      `تعذّر الوصول إلى هذا العنوان: ${String(problem).slice(0, 120)}`,
    );
  }
  if (!response.ok) {
    throw new SkillRejected(`That URL answered ${response.status}.`, `أجاب هذا العنوان بالرمز ${response.status}.`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * `UC-53.2-02`: import a package that has been validated, and enable it for agents.
 *
 * Validated again here rather than trusting what the screen was shown: the review the
 * admin read came from a request of their own, and the package is re-read from the same
 * source before anything is stored.
 *
 * @throws {SkillRejected} when the package may not be imported, with every reason.
 */
export async function importSkill(input: {
  zipBase64?: string;
  gitUrl?: string;
  agentCodes: string[];
}): Promise<string> {
  const session = await requireOrganisationPermission("skills:write");
  const review = await validateSkillPackage(input);

  if (review.blockers.length) {
    throw new SkillRejected("This package cannot be imported.", "لا يمكن استيراد هذه الحزمة.", review.blockers);
  }

  const skillName = skillNameFrom(review.name);
  if (await repository.skillNameTaken(skillName)) {
    throw new SkillRejected(
      `A skill called ${skillName} is already installed.`,
      `توجد مهارة باسم ${skillName} مثبّتة بالفعل.`,
    );
  }

  const versionLabel = "1.0.0";
  await storePackage(review, skillName, versionLabel);

  await repository.importSkill({
    skillName,
    titleEn: review.name,
    titleAr: review.name,
    descriptionEn: review.description,
    descriptionAr: review.description,
    sourceType: input.gitUrl ? "Git" : "Uploaded",
    sourceUrl: input.gitUrl ?? null,
    versionLabel,
    declaredTools: review.declaredTools,
    scan: review.scan,
    agentCodes: input.agentCodes,
    importedBy: session.personId,
  });

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "skills:write",
    objectType: "Skill",
    objectLabel: skillName,
    detail: {
      imported: true,
      source: input.gitUrl ?? "upload",
      agents: input.agentCodes,
      scan: review.scan,
    },
  });
  return skillName;
}
