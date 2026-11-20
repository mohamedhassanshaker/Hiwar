import { expect, test, type Page } from "@playwright/test";

import { closeContexts, signUpOwner } from "../support/accounts";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

/** The palette of PLT-002 FR-003, which the Brand sheet and `hiwar.css` define as tokens. */
const BRAND_TOKENS = ["#1B1F4B", "#4338CA", "#EEF0FF", "#14B8A6", "#0F766E", "#0E7A4F", "#F8B102", "#8A5800", "#C8261D"];

/** Every colour used on the page that is not a token of the shared stylesheet or the brand palette. */
async function strayColours(page: Page): Promise<string[]> {
  return page.evaluate((brand) => {
    const probe = document.createElement("i");
    document.body.appendChild(probe);
    const norm = (value: string): string | null => {
      probe.style.color = "";
      probe.style.color = value.trim();
      if (!probe.style.color) return null;
      const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)!.map(Number);
      if (rgb.length === 4 && rgb[3] === 0) return null;
      return rgb.slice(0, 3).join(",");
    };
    const tokens = new Set<string>(brand.map(norm).filter((x): x is string => Boolean(x)));
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule) || !/:root/.test(rule.selectorText)) continue;
        for (const name of Array.from(rule.style)) {
          if (name.startsWith("--")) {
            const n = norm(rule.style.getPropertyValue(name));
            if (n) tokens.add(n);
          }
        }
      }
    }
    const stray = new Set<string>();
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const box = (el as HTMLElement).getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      const cs = getComputedStyle(el);
      const used = [cs.color, cs.backgroundColor];
      if (parseFloat(cs.borderTopWidth) > 0) used.push(cs.borderTopColor);
      for (const value of used) {
        const n = norm(value);
        if (n && !tokens.has(n)) stray.add(`${value} on <${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`);
      }
    }
    probe.remove();
    return [...stray];
  }, BRAND_TOKENS);
}

function contrast(fg: number[], bg: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test.describe("PLT-002 Brand and visual identity", () => {
  test("AC-PLT-002-01: the Latin Hiwar and the Arabic حوار appear together in the public header and the sidebar", async ({ page, browser }) => {
    await page.goto("/");
    const header = page.getByRole("banner").getByRole("link", { name: "Hiwar home" });
    await expect(header).toContainText("Hiwar");
    await expect(header.getByText("حوار")).toHaveAttribute("dir", "rtl");

    const owner = await signUpOwner(browser);
    const sidebar = owner.page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Hiwar home" });
    await expect(sidebar).toContainText("Hiwar");
    await expect(sidebar.getByText("حوار")).toBeVisible();
    const [latin, arabic] = await Promise.all([sidebar.getByText("Hiwar", { exact: true }).boundingBox(), sidebar.getByText("حوار").boundingBox()]);
    expect(arabic!.x).toBeGreaterThan(latin!.x);
  });

  test("AC-PLT-002-02: every colour on the public and panel screens comes from a token", async ({ page, browser }) => {
    const stray: Record<string, string[]> = {};
    for (const path of ["/", "/pricing"]) {
      await page.goto(path);
      stray[path] = await strayColours(page);
    }
    const owner = await signUpOwner(browser);
    for (const path of ["/conversations", "/agents", "/knowledge", "/deployments", "/analytics", "/billing", "/team", "/audit"]) {
      await owner.page.goto(path);
      await expect(owner.page.getByRole("main")).toBeVisible();
      stray[path] = await strayColours(owner.page);
    }
    expect(Object.fromEntries(Object.entries(stray).filter(([, v]) => v.length))).toEqual({});
  });

  test("AC-PLT-002-03: danger text has at least 5.6:1 contrast on white", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.goto("/team");
    const colour = await page.evaluate(() => {
      const el = document.createElement("span");
      el.className = "c-danger";
      el.textContent = "x";
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c.match(/\d+/g)!.slice(0, 3).map(Number);
    });
    expect(contrast(colour, [255, 255, 255])).toBeGreaterThanOrEqual(5.6);
  });
});
