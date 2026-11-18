import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { evaluate, type Grant, type Principal } from "@/authz/evaluate";
import { PERMISSION_CODES } from "@/authz/permissions";
import { SCREEN_PERMISSION } from "@/authz/screens";
import { navFor, NAV } from "@/components/shared/nav";
import { ROUTES, type ScreenId } from "@/lib/routes";

/**
 * Requirement 27: the screen → permission map is declared once, and both the navigation
 * filter and the guard in front of the screen's data use it.
 *
 * The navigation half is checked by calling `navFor`. The guard half is checked by
 * reading the page and the feature service behind it: a screen that needs `audit:read`
 * must be served by a service that asks `requirePermission("audit:read")` before it reads
 * anything, so a direct URL is refused and audited even with the navigation item gone.
 */
const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const appDir = join(srcDir, "app");

/** The `page.tsx` that serves a URL, route groups removed from the path. */
function pageOf(url: string): string | null {
  const wanted = url === "/" ? [] : url.slice(1).split("/");
  let found: string | null = null;
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, entry.startsWith("(") && entry.endsWith(")") ? segments : [...segments, entry]);
      } else if (entry === "page.tsx" && segments.join("/") === wanted.join("/")) {
        found = full;
      }
    }
  };
  walk(appDir, []);
  return found;
}

/** A principal with organisation-wide `Allow` for each of `permissions`. */
function principalWith(permissions: string[]): Principal {
  const grants: Grant[] = permissions.map((permission) => ({
    permission: permission as Grant["permission"],
    effect: "Allow",
    scope: { type: "Organisation" },
  }));
  return { personId: "test", grants, orgUnitPath: [] };
}

describe("the screen → permission map", () => {
  it("names every screen exactly once, with a permission the catalogue defines", () => {
    const screens = Object.keys(ROUTES) as ScreenId[];
    expect(Object.keys(SCREEN_PERMISSION).sort()).toEqual([...screens].sort());
    for (const [screen, permission] of Object.entries(SCREEN_PERMISSION)) {
      if (permission !== null) expect(PERMISSION_CODES, screen).toContain(permission);
    }
  });

  it("is what guards the screen's own data", () => {
    const unguarded: string[] = [];
    for (const [screen, permission] of Object.entries(SCREEN_PERMISSION)) {
      if (permission === null) continue;
      const page = pageOf(ROUTES[screen as ScreenId]);
      if (!page) {
        unguarded.push(`${screen}: no page`);
        continue;
      }
      const modules = [...readFileSync(page, "utf8").matchAll(/@\/features\/([^/"']+)\/service/g)].map((m) => m[1]);
      if (modules.length === 0) {
        unguarded.push(`${screen}: the page reads no feature service`);
        continue;
      }
      const guarded = modules.some((name) => {
        const service = join(srcDir, "features", name, "service.ts");
        return existsSync(service) && readFileSync(service, "utf8").includes(`requirePermission("${permission}")`);
      });
      if (!guarded) unguarded.push(`${screen}: ${modules.join(", ")} never asks for ${permission}`);
    }
    expect(unguarded).toEqual([]);
  });
});

describe("COM-07 the navigation a person may use", () => {
  it("shows everything to someone who may see everything", () => {
    const everything = navFor(principalWith([...PERMISSION_CODES]));
    expect(everything.length).toBe(NAV.length);
    expect(everything.flatMap((group) => group.items).length).toBe(NAV.flatMap((group) => group.items).length);
  });

  it("drops an item the person may not reach, and the heading when nothing is left", () => {
    const nothing = navFor(principalWith([]));
    const screens = nothing.flatMap((group) => group.items).map(([id]) => id);
    // Only the screens that need no permission survive.
    expect(screens).toEqual(screens.filter((id) => SCREEN_PERMISSION[id] === null));
    expect(nothing.every((group) => group.items.length > 0)).toBe(true);
    expect(nothing.some((group) => group.h?.[0] === "Govern")).toBe(false);
  });

  it("gives a reason for every refusal, which is what the audit entry records", () => {
    const principal = principalWith(["projects:read"]);
    expect(evaluate(principal, "projects:read").reason).toBe("allowed");
    expect(evaluate(principal, "audit:read").reason).toBe("no-grant");
  });
});
