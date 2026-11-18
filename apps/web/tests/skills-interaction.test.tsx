// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const files = [
  { path: "SKILL.md", size: 120 },
  { path: "assets/logo.png", size: 2048 },
  { path: "scripts/build.py", size: 30 },
  { path: "templates/deck.pptx", size: 40960 },
];

// The server actions answer as the server would; what is under test is what the detail draws.
vi.mock("@/features/skills/actions", () => ({
  loadSkillFiles: async () => ({ ok: true, value: files }),
  deleteSkill: async () => ({ ok: true }),
  publishSkill: async () => ({ ok: true, usedBy: [] }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/skills",
  useSearchParams: () => new URLSearchParams(),
}));

import { act } from "react";

import { Skills } from "@/features/skills/components/skills";
import type { Skill, SkillDetail } from "@/features/skills/types";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const person = { id: "p1", ini: "QA", photo: null, name: "", nameAr: "", role: "", roleAr: "", email: "" };
const directory = { me: person, agents: [], people: [], projects: [], may: [] };

const skill: Skill = { n: "deck-builder", src: "Uploaded", v: "1.0.0", d: "Builds decks.", dAr: "", tags: [], agents: 0, b: "Installed" };
const details: Record<string, SkillDetail> = {
  "deck-builder": { name: "deck-builder", packageRef: "skills/deck-builder/1.0.0", checksum: null, frontmatterValid: true, scan: null, usedBy: [] },
};

const fetched: string[] = [];
globalThis.fetch = (async (url: string) => {
  fetched.push(String(url));
  return new Response(String(url).includes("SKILL.md") ? "---\nname: deck-builder\n---\n# Deck" : "print('hi')\n");
}) as typeof fetch;

/** Lets the action's and the fetch's promises settle and React draw what they returned. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

afterEach(async () => {
  fetched.length = 0;
  await cleanup();
});

describe("S-53 skill detail", () => {
  it("lists every file of the package and shows the selected one, with no test bench or test cases", async () => {
    const { container } = await mount(withProviders(<Skills skills={[skill]} details={details} />, directory));
    await click(container.querySelector("button.awp-card"));
    await settle();

    const listed = [...container.querySelectorAll("button.awp-row.awp-mono")].map((row) => row.textContent?.trim());
    expect(listed).toEqual(files.map((file) => file.path));
    // SKILL.md opens first, read through the route that serves the package's files.
    expect(container.querySelector("pre")?.textContent).toContain("name: deck-builder");
    expect(fetched).toEqual(["/api/skills/deck-builder/files?path=SKILL.md"]);

    await click(byText(container, "button", "scripts/build.py"));
    await settle();
    expect(container.querySelector("pre")?.textContent).toBe("print('hi')\n");

    await click(byText(container, "button", "assets/logo.png"));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/skills/deck-builder/files?path=assets%2Flogo.png");

    await click(byText(container, "button", "templates/deck.pptx"));
    expect(container.textContent).toContain("This file cannot be shown here · 40 KB");

    expect(byText(container, "button", "Download as .zip")?.hasAttribute("disabled")).toBe(false);
    expect(container.textContent).not.toMatch(/Test bench|Test cases|Add case/);
  });
});
