import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { zipSync } from "fflate";

import { getObject, objectStoreConfigured, objects, splitReference } from "@/lib/objects";
import { requirePermission } from "@/lib/session";
import { MAX_FILES, MAX_TOTAL_BYTES } from "@/lib/skill-package";
import { BadPackagePath, PackageStoreUnavailable, SkillMissing, SkillRejected } from "./errors";
import * as repository from "./repository";

/**
 * The files of a skill's current version, as the import stored them: the `skills` bucket,
 * under the version's `package_ref` prefix. Every read requires `skills:read` and reaches only
 * keys under that prefix.
 */

export type StoredFile = { path: string; size: number };

/** The bucket and key prefix of the current version's files, or null when it has none. */
async function locate(skillName: string): Promise<{ bucket: string; prefix: string; versionLabel: string } | null> {
  const found = await repository.packageOf(skillName);
  if (!found) throw new SkillMissing("That skill does not exist.", "هذه المهارة غير موجودة.");
  // A bundled skill ships in the agent image (D127), which this console's image does not carry.
  if (found.sourceType === "Bundled") {
    throw new SkillRejected(
      `${skillName} ships with the platform. Its files are in packages/skills-bundled/${skillName} of the platform's source, not in the object store.`,
      `${skillName} مدمجة في المنصة. ملفاتها في packages/skills-bundled/${skillName} من مصدر المنصة، وليست في مخزن الكائنات.`,
    );
  }
  if (!objectStoreConfigured()) {
    throw new PackageStoreUnavailable(
      "Object storage is not configured, so the skill's files cannot be read.",
      "مخزن الكائنات غير مُعدّ، لذا لا يمكن قراءة ملفات المهارة.",
    );
  }
  if (!found.packageRef) return null;
  const { bucket, key } = splitReference(found.packageRef);
  return { bucket, prefix: `${key.replace(/\/+$/, "")}/`, versionLabel: found.versionLabel };
}

/** Every file under the prefix, `SKILL.md` first and then by path; refused past the import's file limit. */
async function listFiles(where: { bucket: string; prefix: string }): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  let token: string | undefined;
  do {
    const page = await objects().send(
      new ListObjectsV2Command({ Bucket: where.bucket, Prefix: where.prefix, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key && !item.Key.endsWith("/")) files.push({ path: item.Key.slice(where.prefix.length), size: item.Size ?? 0 });
    }
    if (files.length > MAX_FILES) {
      throw new SkillRejected(`The package has more than ${MAX_FILES} files.`, `تحتوي الحزمة على أكثر من ${MAX_FILES} ملف.`);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return files.sort((a, b) => Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md") || a.path.localeCompare(b.path));
}

/** A path inside the package: relative, `/`-separated, with no empty, `.` or `..` segment. */
function checkedPath(path: string): string {
  const segments = path.split("/");
  if (!path || path.length > 1024 || /[\\\0]/.test(path) || segments.some((part) => part === "" || part === "." || part === "..")) {
    throw new BadPackagePath("That is not a path inside the skill's package.", "هذا ليس مساراً داخل حزمة المهارة.");
  }
  return path;
}

async function bytesOf(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/**
 * The files of the skill's current version, by path.
 *
 * @throws {SkillMissing} when there is no such skill.
 * @throws {SkillRejected} for a bundled skill, or a package past the file limit.
 * @throws {PackageStoreUnavailable} when the object store is not configured.
 */
export async function listSkillFiles(skillName: string): Promise<StoredFile[]> {
  await requirePermission("skills:read");
  const where = await locate(skillName);
  return where ? listFiles(where) : [];
}

/**
 * One file of the skill's current version.
 *
 * @throws {BadPackagePath} when the path is not a plain path inside the package.
 * @throws {SkillMissing} when there is no such skill or file.
 */
export async function readSkillFile(
  skillName: string,
  path: string,
): Promise<{ body: ReadableStream<Uint8Array>; size: number | null }> {
  await requirePermission("skills:read");
  const inside = checkedPath(path);
  const where = await locate(skillName);
  const object = where ? await getObject(`${where.bucket}/${where.prefix}${inside}`) : null;
  if (!object) throw new SkillMissing("The skill's package has no such file.", "لا يوجد هذا الملف في حزمة المهارة.");
  return { body: object.body, size: object.size };
}

/**
 * The skill's current version as a `.zip`, its files inside a folder named after the skill as
 * the Agent Skills standard lays a package out. Bounded like an import: 5 MB and 200 files.
 *
 * @throws {SkillMissing} when there is no such skill, or it has no stored files.
 */
export async function skillPackageZip(skillName: string): Promise<{ name: string; bytes: Uint8Array<ArrayBuffer> }> {
  await requirePermission("skills:read");
  const where = await locate(skillName);
  const files = where ? await listFiles(where) : [];
  if (!where || !files.length) throw new SkillMissing("No files are stored for this skill.", "لا توجد ملفات مخزنة لهذه المهارة.");
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
    throw new SkillRejected("The package is larger than 5 MB.", "الحزمة أكبر من 5 ميجابايت.");
  }

  const entries = await Promise.all(
    files.map(async (file) => {
      const object = await getObject(`${where.bucket}/${where.prefix}${file.path}`);
      if (!object) throw new SkillMissing(`${file.path} is no longer stored.`, `لم يعد ${file.path} مخزناً.`);
      return [`${skillName}/${file.path}`, await bytesOf(object.body)] as const;
    }),
  );
  return { name: `${skillName}-${where.versionLabel}.zip`, bytes: new Uint8Array(zipSync(Object.fromEntries(entries))) };
}
