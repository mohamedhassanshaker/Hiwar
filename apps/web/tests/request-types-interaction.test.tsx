// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/request-types",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/requests/actions", () => ({ createRequestType: async () => ({ ok: false, reason: "not called" }) }));

import { RequestTypes } from "@/features/requests/components/request-types";
import type { RequestType } from "@/features/requests/types";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const person = { id: "p1", ini: "QA", photo: null, name: "", nameAr: "", role: "", roleAr: "", email: "" };
const projects = [
  { k: "FIN", n: "Finance", nAr: "المالية" },
  { k: "HR", n: "People", nAr: "الموارد البشرية" },
] as never[];
const directory = { me: person, agents: [], people: [], projects, may: [] };
const types: RequestType[] = [
  { c: "PROC", n: "Procurement", nAr: "مشتريات", cat: "Finance", v: "v2", st: "Published", ch: "Console", dec: "none", sla: "2 days", open: 1, p: "FIN" },
  { c: "HIRE", n: "Hiring", nAr: "توظيف", cat: "People", v: "v1", st: "Draft", ch: "Console, Widget", dec: "agent", sla: "—", open: 0, p: "HR" },
  { c: "LEAVE", n: "Leave", nAr: "إجازة", cat: "People", v: "v1", st: "Published", ch: "Widget", dec: "none", sla: "—", open: 0, p: "" },
];
const screen = (mayWriteTypes: boolean) =>
  withProviders(<RequestTypes types={types} typeDetails={{}} mayWriteTypes={mayWriteTypes} appUrl="https://awp.example.test" />, directory);
const listed = (container: HTMLElement) => [...container.querySelectorAll("tbody tr .awp-lnk-t")].map((cell) => cell.textContent);

async function choose(container: HTMLElement, current: string, option: string) {
  await click(byText(container, '[role="combobox"]', current) ?? [...container.querySelectorAll('[role="combobox"]')].find((box) => box.textContent?.includes(current)));
  await click(byText(document.body, '[role="option"]', option));
}

afterEach(cleanup);

describe("the request types screen", () => {
  it("offers New request type only to somebody who may design one", async () => {
    const { container } = await mount(screen(true));
    expect(byText(container, "button", "New request type")).toBeDefined();
    await cleanup();
    const read = await mount(screen(false));
    expect(byText(read.container, "button", "New request type")).toBeUndefined();
  });

  it("filters by name or code, project, category and channel, and clears", async () => {
    const { container } = await mount(screen(true));
    expect(listed(container)).toEqual(["Procurement", "Hiring", "Leave"]);

    const search = container.querySelector('input[aria-label="Name or code"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "hire");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(listed(container)).toEqual(["Hiring"]);
    await click(byText(container, "button", "Clear"));

    await choose(container, "Any category", "People");
    expect(listed(container)).toEqual(["Hiring", "Leave"]);
    await choose(container, "Any channel", "Widget");
    expect(listed(container)).toEqual(["Hiring", "Leave"]);
    await choose(container, "Any status", "Draft");
    expect(listed(container)).toEqual(["Hiring"]);
    await click(byText(container, "button", "Clear"));

    await choose(container, "All projects", "FIN — Finance");
    expect(listed(container)).toEqual(["Procurement"]);
    await click(byText(container, "button", "Clear"));
    expect(listed(container)).toEqual(["Procurement", "Hiring", "Leave"]);
  });
});
