// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { DataTable } from "@/components/shared/layout";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const person = { id: "p1", ini: "QA", photo: null, name: "", nameAr: "", role: "", roleAr: "", email: "" };
const directory = { me: person, agents: [], people: [], projects: [], may: [] };
const rows = Array.from({ length: 60 }, (_, index) => ({ n: index + 1 }));
const table = (list: { n: number }[]) =>
  withProviders(<DataTable rows={list} cols={[{ h: "N", r: (row) => `row-${row.n}` }]} />, directory);

afterEach(cleanup);

describe("every table pages its rows", () => {
  it("shows 25 rows at a time and moves between pages", async () => {
    const { container } = await mount(table(rows));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
    expect(container.textContent).toContain("1–25 of 60");

    await click(byText(container, "button", "Next"));
    expect(container.textContent).toContain("26–50 of 60");
    expect(container.textContent).toContain("row-26");
    expect(container.textContent).not.toContain("row-25");

    await click(byText(container, "button", "Next"));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(byText(container, "button", "Next")?.hasAttribute("disabled")).toBe(true);
  });

  it("stays on a page that still exists when the list shrinks", async () => {
    const { container, rerender } = await mount(table(rows));
    await click(byText(container, "button", "Next"));
    await click(byText(container, "button", "Next"));
    await rerender(table(rows.slice(0, 30)));
    expect(container.textContent).toContain("26–30 of 30");
  });

  it("draws no pager when everything fits on one page", async () => {
    const { container } = await mount(table(rows.slice(0, 5)));
    expect(container.querySelector(".awp-pager")).toBeNull();
  });
});
