import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_SKILLS } from "@/db/ai-seed/data/default-start";
import { SKILLS } from "@/db/ai-seed/data/skills";

const bundle = fileURLToPath(new URL("../../../../packages/skills-bundled", import.meta.url));

describe("the shipped seed's bundled skills", () => {
  // A skill seeded as Bundled is read from the agent image's bundle at run time (D127), so one
  // with no package there is granted and never reaches a run, while the agent screen shows it as
  // applied. `task-planning` was seeded that way for `def`.
  const shipped = SKILLS.filter(
    (skill) => skill.src === "Bundled" && (DEFAULT_SKILLS as readonly string[]).includes(skill.n),
  );

  it.each(shipped.map((skill) => skill.n))("%s has a package of the same name in the bundle", (name) => {
    const path = join(bundle, name, "SKILL.md");
    expect(existsSync(path), path).toBe(true);
    expect(readFileSync(path, "utf8")).toMatch(new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`));
  });

  it("covers every skill the shipped seed installs as Bundled", () => {
    expect(shipped.map((skill) => skill.n).sort()).toEqual(
      expect.arrayContaining(["task-planning", "work-item-execution", "bilingual-writing", "request-triage"]),
    );
  });
});
