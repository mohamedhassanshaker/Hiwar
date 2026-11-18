import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Requirement 65. The layering of `apps/web/src/` is a rule, not a convention, so it is
 * asserted rather than reviewed: the sample data is gone, nothing renders a hard-coded
 * record, and only a repository touches the database client.
 */

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

/** Every source file under a folder, as an absolute path. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if ([".ts", ".tsx"].includes(extname(entry))) {
      found.push(full);
    }
  }
  return found;
}

/** The import specifiers of one file. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const pattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

const relativeToSrc = (file: string) => relative(srcDir, file).replaceAll("\\", "/");

/**
 * Criterion 13: a screen renders what a feature service read, never a record it carries
 * itself. The prototype's sample data had two shapes, and both are refused here:
 *
 * - an array of object literals that each name a record — an identity field (`id`, `key`,
 *   `code`) and a name or title, with nothing but literal values;
 * - an array of tuples that each carry one of the platform's record keys (`SES-1042`).
 *
 * A list of tabs, chips or enum labels is none of those: its values are translations or
 * expressions, and it names no record.
 */
const ARRAY_OF_OBJECTS = /\[\s*(\{[^{}[\]()]{2,400}?\})\s*,\s*(\{[^{}[\]()]{2,400}?\})/g;
const ARRAY_OF_TUPLES = /\[\s*(\[[^[\]{}]{2,400}?\])\s*,\s*(\[[^[\]{}]{2,400}?\])/g;
const LITERAL_FIELDS = /^(?:\s*[A-Za-z_$][\w$]*\s*:\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|-?\d+(?:\.\d+)?|true|false)\s*,?)+\s*$/;
const IDENTITY_FIELD = /\b(?:id|key|code|k)\s*:/;
const NAMING_FIELD = /\b(?:name|nameEn|nameAr|title|titleEn|titleAr|n)\s*:/;
const RECORD_KEY = /(['"`])[A-Z]{2,6}-\d+\1/;

function isRecordObject(objectLiteral: string): boolean {
  const body = objectLiteral.slice(1, -1);
  return LITERAL_FIELDS.test(body) && IDENTITY_FIELD.test(body) && NAMING_FIELD.test(body);
}

/** Where a `@/`-prefixed specifier resolves to, as a path under `src/`. */
function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = join(srcDir, specifier.slice(2));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Whether a module opts the file into the client bundle. */
const isClientModule = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"));

describe("architecture", () => {
  /**
   * A server action may not read a value from a client module.
   *
   * React gives a `"use server"` module client *references*, not values, for anything it
   * imports from a `"use client"` module. The symbol is there and typed, so this compiles
   * and passes review; at runtime the import is `undefined`. It cost the route table:
   * `revalidatePath(ROUTES.people)` was called with `undefined` and crashed the render
   * after every successful write, while the write itself and its tests all passed.
   */
  it("keeps server actions off client modules", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      if (!/^\s*["']use server["']/.test(readFileSync(file, "utf8"))) continue;
      for (const specifier of importsOf(file)) {
        const target = resolveAlias(specifier);
        if (target && isClientModule(target)) {
          offenders.push(`${relativeToSrc(file)} imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no sample-data folder", () => {
    expect(existsSync(join(srcDir, "data"))).toBe(false);
  });

  it("has exactly the twenty-two feature modules", () => {
    const modules = readdirSync(join(srcDir, "features")).sort();
    expect(modules).toEqual([
      "agents",
      "assistant",
      "auth",
      "budgets",
      "comments",
      "connectors",
      "engage",
      "files",
      "governance",
      "home",
      "inbox",
      "integrations",
      "knowledge",
      "memory",
      "models",
      "organisation",
      "projects",
      "requests",
      "rooms",
      "schedules",
      "skills",
      "work-items",
    ]);
  });

  it("gives every feature module its six files", () => {
    const featuresDir = join(srcDir, "features");
    const missing: string[] = [];
    for (const name of readdirSync(featuresDir)) {
      for (const file of ["components", "actions.ts", "service.ts", "repository.ts", "schema.ts", "types.ts"]) {
        if (!existsSync(join(featuresDir, name, file))) missing.push(`${name}/${file}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("imports no sample data from a feature, a component or a route", () => {
    const offenders: string[] = [];
    for (const dir of ["features", "components", "app"]) {
      for (const file of sourceFiles(join(srcDir, dir))) {
        const bad = importsOf(file).filter(
          (specifier) => specifier.startsWith("@/data") || /(^|\/)\.\.?\/data\//.test(specifier),
        );
        if (bad.length > 0) offenders.push(`${relativeToSrc(file)} → ${bad.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports the database client only from a repository or from src/db", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const path = relativeToSrc(file);
      if (path.startsWith("db/")) continue;
      if (/^features\/[^/]+\/repository\.ts$/.test(path)) continue;
      const bad = importsOf(file).filter(
        (specifier) => specifier === "@/db" || specifier.startsWith("@/db/client"),
      );
      if (bad.length > 0) offenders.push(`${path} → ${bad.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("calls a repository only from its own module's service or actions", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const path = relativeToSrc(file);
      const own = path.match(/^features\/([^/]+)\//)?.[1];
      for (const specifier of importsOf(file)) {
        const target = specifier.match(/^@\/features\/([^/]+)\/repository$/)?.[1];
        if (!target) continue;
        const allowed =
          own === target && ["service.ts", "actions.ts", "repository.ts"].some((name) => path.endsWith(name));
        if (!allowed) offenders.push(`${path} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps routes thin: a page imports no repository and no database client", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(srcDir, "app"))) {
      const bad = importsOf(file).filter(
        (specifier) => /\/repository$/.test(specifier) || specifier.startsWith("@/db"),
      );
      if (bad.length > 0) offenders.push(`${relativeToSrc(file)} → ${bad.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("renders no hard-coded record", () => {
    const dirs = [
      join(srcDir, "components"),
      join(srcDir, "app"),
      ...readdirSync(join(srcDir, "features")).map((name) => join(srcDir, "features", name, "components")),
    ];
    const offenders: string[] = [];
    for (const file of dirs.flatMap(sourceFiles)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(ARRAY_OF_OBJECTS)) {
        if ([match[1], match[2]].every(isRecordObject)) offenders.push(`${relativeToSrc(file)}: ${match[0].slice(0, 60)}…`);
      }
      for (const match of source.matchAll(ARRAY_OF_TUPLES)) {
        if ([match[1], match[2]].every((row) => RECORD_KEY.test(row))) offenders.push(`${relativeToSrc(file)}: ${match[0].slice(0, 60)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("writes every refusal in both console languages", () => {
    // Specification section 9: a refusal is the only thing a screen has to say about why
    // nothing happened, so it is written like every other piece of console text — the two
    // strings side by side. The constructor makes the second argument required; this is
    // what stops it from being the English one again.
    const ARABIC = /[؀-ۿ]/;
    const offenders: string[] = [];
    for (const file of [...sourceFiles(join(srcDir, "features")), ...sourceFiles(join(srcDir, "lib"))]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/new [A-Z][A-Za-z]*(?:Rejected|Error|Refused|NotStarted|NotEditable)\(/g)) {
        const open = match.index + match[0].length;
        let depth = 1;
        let end = open;
        while (end < source.length && depth > 0) {
          if ("([{".includes(source[end])) depth += 1;
          else if (")]}".includes(source[end])) depth -= 1;
          end += 1;
        }
        const args = source.slice(open, end - 1);
        // Only the refusals that carry their own words: one built from a variable, or a
        // reason code, is checked where that text is written instead.
        if (!/["`]/.test(args)) continue;
        if (!ARABIC.test(args)) offenders.push(`${relativeToSrc(file)}: ${match[0]}${args.slice(0, 50)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names the table of every column a correlated subquery reaches out to", () => {
    // A column interpolated into a `sql` template is rendered unqualified when the query
    // has no join, and inside a subquery that bare name binds to the subquery's own table
    // first. The result is a valid query with the wrong answer — `src/db/outer.ts` is how
    // such a reference is written, and this is what keeps the next one from being written
    // any other way.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(srcDir, "features"))) {
      const source = readFileSync(file, "utf8");
      let index = 0;
      for (;;) {
        const start = source.toLowerCase().indexOf("(select", index);
        if (start === -1) break;
        let depth = 0;
        let end = start;
        while (end < source.length) {
          if (source[end] === "(") depth += 1;
          else if (source[end] === ")") {
            depth -= 1;
            if (depth === 0) break;
          }
          end += 1;
        }
        const span = source.slice(start, end + 1);
        for (const match of span.matchAll(/\$\{(s\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+)\}/g)) {
          offenders.push(`${relativeToSrc(file)}: ${match[1]} is not wrapped in outer()`);
        }
        index = end + 1;
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never uses a TypeScript escape hatch", () => {
    const offenders = sourceFiles(srcDir).filter((file) =>
      /@ts-(ignore|expect-error|nocheck)/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map(relativeToSrc)).toEqual([]);
  });
});
