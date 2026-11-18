import { describe, expect, it } from "vitest";

import { Badge, Button, ICON_NAMES, LogoModes, Tag, icon } from "@/ds";

describe("generated design-system module", () => {
  it("resolves every icon the console can ask for", () => {
    const missing = ICON_NAMES.filter((name) => typeof icon(name) !== "function");
    expect(missing).toEqual([]);
  });

  it("resolves the four components the console uses by name", () => {
    expect(typeof Button).toBe("function");
    expect(typeof Tag).toBe("function");
    expect(typeof Badge).toBe("function");
    expect(typeof LogoModes).toBe("function");
  });
});

describe("the design system's stylesheets", () => {
  it("D153 are imported by the layout, all of them, and nothing from another origin", async () => {
    const { readFileSync } = await import("node:fs");
    const vendored = readFileSync("vendor/tahseel-ds/styles.css", "utf8");
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const local = [...vendored.matchAll(/@import '\.\/([^']+)'/g)].map((match) => match[1]);
    expect(local.length).toBeGreaterThan(0);
    for (const file of local) expect(layout).toContain(`import "../../vendor/tahseel-ds/${file}";`);
    // The vendored list's remote font import is the one the CSP refuses.
    expect(layout).not.toContain(`import "../../vendor/tahseel-ds/styles.css"`);
    expect(layout).not.toMatch(/googleapis/);
  });
});
