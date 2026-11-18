import { unzipSync } from "fflate";
import { parse as parseYaml } from "yaml";

/**
 * What a skill package is allowed to be (S-53, `UC-53.2-01` … `-06`).
 *
 * A skill is instructions an agent loads and follows, so importing one is closer to
 * installing software than to uploading a document: it can carry scripts, it can carry
 * text written to redirect the agent reading it, and it can carry a credential someone
 * pasted. Those are the three things this looks for, and the package is judged before it
 * reaches the registry rather than when an agent first loads it.
 *
 * Pure: it takes bytes and returns findings. No database, no network, no filesystem, so
 * the rules can be tested against a package built in a test rather than one that has to
 * exist somewhere.
 */

/**
 * A file the package carries. `text` is what the scan reads; `data` is what is stored, so a
 * binary asset (an image, a template) keeps its bytes.
 */
export type PackageFile = { path: string; text: string; bytes: number; data: Uint8Array };

/** What a scan found, in the shape `ai.skill_scan_result` keeps. */
export type SkillScan = {
  scripts: number;
  networkCalls: number;
  promptInjectionPatterns: number;
  embeddedSecrets: number;
  /** Whether the package may only ever run in the sandbox. */
  sandboxOnly: boolean;
};

/** The verdict on a package, and everything the import screen shows about it. */
export type PackageReview = {
  files: PackageFile[];
  /** The frontmatter's `name`, `description` and `allowed-tools`. */
  name: string;
  description: string;
  declaredTools: string[];
  frontmatterValid: boolean;
  scan: SkillScan;
  /** Why the package cannot be imported. Empty when it may. */
  blockers: string[];
  /** Things the importer should know, which do not stop the import. */
  warnings: string[];
};

/** A package may not be larger than this, uncompressed. */
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

/** Nor carry more files than this, which no skill needs. */
export const MAX_FILES = 200;

const SCRIPT_EXTENSIONS = [".sh", ".py", ".js", ".ts", ".rb", ".ps1", ".bat"];

/** Calls that leave the machine. A skill that reaches the network runs sandboxed only. */
const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bhttps?:\/\/(?!localhost|127\.0\.0\.1)/,
  /\b(?:curl|wget)\b/,
  /\brequests\.(?:get|post|put|delete)\s*\(/,
  /\burllib\b/,
  /\bsocket\.(?:socket|connect)\b/,
];

/**
 * Text written to redirect the agent that reads the skill.
 *
 * A skill is loaded into the model's context as instructions, so a line telling it to
 * ignore what it was told is an injection with the same force as one in a document — and
 * more, because a skill is trusted by the agent that loaded it.
 */
const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all )?(?:your |the )?(?:previous|prior|above) instructions/i,
  /disregard (?:all )?(?:your |the )?(?:previous|prior|above)/i,
  /you are now (?:a|an|the)\b/i,
  /\bsystem prompt\b.{0,40}\b(?:reveal|print|output|repeat|show)\b/i,
  /\b(?:reveal|print|output|repeat|show)\b.{0,40}\bsystem prompt\b/i,
  /\bdo not (?:tell|inform|mention to) the (?:user|person|operator)\b/i,
];

/** Credentials someone pasted into the package. */
const SECRET_PATTERNS = [
  /\b(?:sk|pk)-[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i,
];

/**
 * The scan findings that fail a package: a credential, or text written to redirect the
 * agent. Scripts and network calls do not: they mark the package sandbox-only.
 *
 * The one rule for "the scan passed", used by the import and by what reaches a run.
 */
export function scanFailures(
  scan: Pick<SkillScan, "embeddedSecrets" | "promptInjectionPatterns">,
): ("embeddedSecrets" | "promptInjectionPatterns")[] {
  return (["embeddedSecrets", "promptInjectionPatterns"] as const).filter((finding) => scan[finding] > 0);
}

/** Why a pinned skill version does not reach a run; null when it does. */
export type NotApplied = "unpublished" | "unscanned" | "scanFailed";

/**
 * Whether a skill version reaches a run (D156 and the owner's rule for uploaded skills).
 *
 * Only a published version does. A bundled skill ships in the agent image; any other is
 * read from the object store, and only when its scan exists and passed.
 */
export function whyNotApplied(version: {
  sourceType: string;
  status: string;
  scan: Pick<SkillScan, "embeddedSecrets" | "promptInjectionPatterns"> | null;
}): NotApplied | null {
  if (version.status !== "Published") return "unpublished";
  if (version.sourceType === "Bundled") return null;
  if (!version.scan) return "unscanned";
  return scanFailures(version.scan).length ? "scanFailed" : null;
}

/** The package's `SKILL.md`: the shallowest file of that name. */
function skillFileOf(files: PackageFile[]): PackageFile | undefined {
  return files
    .filter((file) => /(^|\/)skill\.md$/i.test(file.path))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
}

/**
 * The files an imported skill is stored as, laid out as the Agent Skills loader reads a
 * package: `SKILL.md` at the package root, with the registry's name as its frontmatter
 * `name`, which the standard requires to match the package folder. A zip made from the
 * skill's folder carries that folder, so it is dropped; files outside it are not stored.
 */
export function packageToStore(files: PackageFile[], skillName: string): PackageFile[] {
  const skillFile = skillFileOf(files);
  if (!skillFile) return files;
  const root = skillFile.path.slice(0, skillFile.path.length - "SKILL.md".length);
  return files
    .filter((file) => file.path.startsWith(root))
    .map((file) => {
      if (file !== skillFile) return { ...file, path: file.path.slice(root.length) };
      const end = file.text.indexOf("\n---", 3);
      const text =
        file.text.startsWith("---") && end !== -1
          ? file.text.slice(0, end).replace(/^name\s*:.*$/m, `name: ${skillName}`) + file.text.slice(end)
          : file.text;
      const data = new TextEncoder().encode(text);
      return { path: "SKILL.md", text, bytes: data.length, data };
    });
}

/**
 * Read a `SKILL.md`'s YAML frontmatter as the agent's loader does (a folded `description: >-`
 * is its text, a list is joined with commas); a header YAML refuses is read line by line.
 */
function readFrontmatter(text: string): Record<string, string> | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = text.slice(3, end);
  try {
    const parsed: unknown = parseYaml(block);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value ?? "").trim()]),
      );
    }
  } catch {
    // Not YAML: read it line by line below.
  }
  return readHeaderLines(block);
}

/** A frontmatter block as `key: value` lines, for a header that is not valid YAML. */
function readHeaderLines(block: string): Record<string, string> {
  const header: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (match) header[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return header;
}

/** `allowed-tools` however it was written: a list, or one comma-separated line. */
function declaredToolsOf(header: Record<string, string>): string[] {
  const raw = header["allowed-tools"] ?? header["allowed_tools"] ?? "";
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** Count how many of a set of patterns a body matches. */
function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

/**
 * Read a `.zip` into the files it carries.
 *
 * @throws {Error} when the bytes are not a zip or exceed the limits above: refused rather
 *   than imported empty, which would install a skill with no instructions in it.
 */
export function readPackage(zip: Uint8Array): PackageFile[] {
  const entries = unzipSync(zip);
  const files: PackageFile[] = [];
  let total = 0;

  for (const [name, bytes] of Object.entries(entries)) {
    // Windows PowerShell's Compress-Archive writes `\`, which the zip format does not allow.
    const path = name.replaceAll("\\", "/");
    if (path.endsWith("/")) continue;
    // A path that climbs out of the package is refused rather than normalised: nothing a
    // skill needs is above its own folder, so this is only ever an attempt.
    if (path.includes("..") || path.startsWith("/")) {
      throw new Error(`The package contains an unsafe path: ${path}`);
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("The package is larger than 5 MB.");
    if (files.length >= MAX_FILES) throw new Error("The package contains more than 200 files.");
    files.push({ path, text: new TextDecoder().decode(bytes), bytes: bytes.length, data: bytes });
  }
  return files;
}

/**
 * Judge a package: what it is, what it carries, and whether it may be imported.
 *
 * `UC-53.2-05`: a missing or invalid `SKILL.md` blocks the import, because a skill with no
 * frontmatter has no name and no description, and the description is what an agent reads
 * to decide whether to load it at all.
 *
 * `UC-53.2-06`: an embedded secret blocks it outright — importing one would copy a live
 * credential into the registry — and prompt-injection patterns block it too, because a
 * skill is loaded as instructions by an agent that trusts it.
 *
 * `UC-53.2-04`: a script that reaches the network is a warning, not a blocker, and marks
 * the package sandbox-only. Plenty of legitimate skills call an API; what matters is that
 * it never runs anywhere but the sandbox.
 */
export function reviewPackage(files: PackageFile[]): PackageReview {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const skillFile = skillFileOf(files);
  const header = skillFile ? readFrontmatter(skillFile.text) : null;

  if (!skillFile) {
    blockers.push("The package has no SKILL.md.");
  } else if (!header) {
    blockers.push("SKILL.md has no YAML frontmatter.");
  } else {
    if (!header.name) blockers.push("SKILL.md frontmatter has no name.");
    if (!header.description) {
      blockers.push("SKILL.md frontmatter has no description, which is what an agent reads to decide when to load the skill.");
    }
  }

  const scriptFiles = files.filter((file) =>
    SCRIPT_EXTENSIONS.some((extension) => file.path.toLowerCase().endsWith(extension)),
  );
  const body = files.map((file) => file.text).join("\n");

  const scan: SkillScan = {
    scripts: scriptFiles.length,
    networkCalls: countMatches(scriptFiles.map((file) => file.text).join("\n"), NETWORK_PATTERNS),
    promptInjectionPatterns: countMatches(body, PROMPT_INJECTION_PATTERNS),
    embeddedSecrets: countMatches(body, SECRET_PATTERNS),
    sandboxOnly: true,
  };

  const failures = scanFailures(scan);
  if (failures.includes("embeddedSecrets")) {
    blockers.push("The package contains what looks like a credential. Remove it and import again.");
  }
  if (failures.includes("promptInjectionPatterns")) {
    blockers.push(
      "The package contains text written to redirect the agent reading it. A skill is loaded as instructions, so this is refused.",
    );
  }
  if (scan.networkCalls > 0) {
    warnings.push("Script makes network calls — will run in sandbox only.");
  }

  return {
    files,
    name: header?.name ?? "",
    description: header?.description ?? "",
    declaredTools: header ? declaredToolsOf(header) : [],
    frontmatterValid: blockers.length === 0 || !blockers.some((reason) => reason.includes("SKILL.md")),
    scan,
    blockers,
    warnings,
  };
}
