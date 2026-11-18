import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { hrefOf, ROUTES } from "@/lib/routes";

const appDir = fileURLToPath(new URL("../src/app", import.meta.url));

/** Every `page.tsx` under src/app, as the URL it serves (route groups removed). */
function pageRoutes(dir: string, segments: string[] = []): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const next = entry.startsWith("(") && entry.endsWith(")") ? segments : [...segments, entry];
      found.push(...pageRoutes(full, next));
    } else if (entry === "page.tsx") {
      found.push("/" + segments.join("/"));
    }
  }
  return found;
}

describe("route map", () => {
  it("has a page file for every screen id", () => {
    const pages = new Set(pageRoutes(appDir));
    const missing = Object.entries(ROUTES).filter(([, url]) => !pages.has(url));
    expect(missing).toEqual([]);
  });

  it("maps the root to the dashboard redirect", () => {
    expect(pageRoutes(appDir)).toContain("/");
  });

  it("fills a path segment from the parameter of the same name", () => {
    expect(hrefOf("session", { key: "SES-1041" })).toBe("/discussion-rooms/SES-1041");
    // Anything the path does not name becomes a query string.
    expect(hrefOf("agents", { agent: "exp" })).toBe("/agents?agent=exp");
  });

  it("refuses a navigation that leaves a path segment unfilled", () => {
    // `{ id }` for a route whose segment is `[key]` produced `/discussion-rooms/[key]?id=…`
    // and an invariant error from inside the Next.js renderer.
    expect(() => hrefOf("session", { id: "SES-1041" })).toThrow(/\[key\]/);
    expect(() => hrefOf("session")).toThrow(/\[key\]/);
  });
});
