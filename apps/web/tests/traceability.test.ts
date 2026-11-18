import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Requirement 63 and 71. `docs/02-product-requirements/screens-use-cases.md` is the acceptance document,
 * and the stack specification's convention is that a test names the use-case id it covers.
 * This test reads the document, reads every test name in the Vitest suite and in the Playwright suite
 * at the repository root (`tests/`), and fails listing any in-scope scenario that no test names.
 *
 * Every scenario the document defines is in scope: all 559, and the eighteen common ones
 * that every screen owes.
 *
 * It is deliberately mechanical: it proves that a scenario has a test with that id in its
 * name, not that the test is a good one. Deleting a covered test makes it fail.
 */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const testsDir = fileURLToPath(new URL(".", import.meta.url));
/** The Playwright suite: browser, API and live cases for the whole console. */
const browserSuiteDir = join(repoRoot, "tests");
const useCases = join(repoRoot, "docs", "02-product-requirements", "screens-use-cases.md");

const SCENARIO_ROW = /^\|\s*(UC-\d{2}\.\d-\d{2})\s*\|/gm;
const COMMON_ROW = /^\|\s*(COM-\d{2})\s*\|/gm;
const TITLE = /\b(?:it|test|describe)(?:\.\w+)*\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const ID_IN_TITLE = /\b(?:UC-\d{2}\.\d-\d{2}|COM-\d{2})\b/g;

/** Every scenario id the document defines, in document order. */
function documentedIds(pattern: RegExp): string[] {
  const document = readFileSync(useCases, "utf8");
  const found: string[] = [];
  for (const match of document.matchAll(pattern)) found.push(match[1]);
  return found;
}

/**
 * Every `.test.ts`, `.spec.ts` and `.setup.ts` under a tests folder. The Playwright
 * setup file holds real cases — signing in through SSO is `UC-01.1-01` — so it counts.
 */
function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...testFiles(full));
    } else if (/\.(test|spec|setup)\.tsx?$/.test(entry) && extname(entry) !== ".md") {
      found.push(full);
    }
  }
  return found;
}

/** The ids named by the Vitest and Playwright test titles, with the file that names them. */
function coveredIds(): Map<string, string[]> {
  const covered = new Map<string, string[]>();
  for (const file of [...testFiles(testsDir), ...testFiles(browserSuiteDir)]) {
    const source = readFileSync(file, "utf8");
    const where = relative(repoRoot, file).replaceAll("\\", "/");
    for (const title of source.matchAll(TITLE)) {
      for (const id of title[2].matchAll(ID_IN_TITLE)) {
        const key = id[0];
        covered.set(key, [...(covered.get(key) ?? []), where]);
      }
    }
  }
  return covered;
}

describe("use-case traceability", () => {
  const scenarios = documentedIds(SCENARIO_ROW);
  const common = documentedIds(COMMON_ROW);
  const covered = coveredIds();

  it("reads every scenario in the use-case document", () => {
    expect(scenarios.length).toBe(559);
    expect(new Set(scenarios).size).toBe(559);
    expect(common).toEqual(
      Array.from({ length: 18 }, (_, index) => `COM-${String(index + 1).padStart(2, "0")}`),
    );
  });

  it("names every scenario of the document in an automated test", () => {
    const missing = scenarios.filter((id) => !covered.has(id));
    expect({ missing: missing.length, ids: missing }).toEqual({ missing: 0, ids: [] });
  });

  it("names every one of the 18 common scenarios in an automated test", () => {
    const missing = common.filter((id) => !covered.has(id));
    expect({ missing: missing.length, ids: missing }).toEqual({ missing: 0, ids: [] });
  });

  it("names no scenario that the document does not define", () => {
    const known = new Set([...scenarios, ...common]);
    const invented = [...covered.keys()].filter((id) => !known.has(id)).sort();
    expect(invented).toEqual([]);
  });

  it("reports the coverage it found", () => {
    const done = scenarios.filter((id) => covered.has(id)).length;
    process.stdout.write(
      `  use cases: ${done} of ${scenarios.length} scenarios and ${common.filter((id) => covered.has(id)).length} of ${common.length} common scenarios covered
`,
    );
    expect(done).toBe(scenarios.length);
  });
});
