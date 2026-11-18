// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/schedules/actions", () => ({ saveSchedule: async () => ({ ok: true, value: undefined }) }));
vi.mock("@/features/schedules/directory", () => ({
  loadScheduleOptions: async () => ({ requestTypes: [], groups: [] }),
  loadSchedule: async () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/scheduled-work-items",
  useSearchParams: () => new URLSearchParams(),
}));

import { Field } from "@/components/ui/field";
import { ScheduleModal } from "@/features/schedules/components/schedule-modal";
import type { Person } from "@/types/directory";
import { cleanup, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [], may: [] };

afterEach(cleanup);

describe("NFR-17 a row of buttons keeps its own names inside a Field", () => {
  it("names a group by its caption and leaves every button outside a label", async () => {
    const { container } = await mount(
      <Field group label="Audience">
        <button>Agent</button>
        <button>Human</button>
      </Field>,
    );
    const group = container.querySelector("[role=group]") as HTMLElement;
    const caption = container.querySelector(`#${CSS.escape(group.getAttribute("aria-labelledby") ?? "none")}`);

    expect(caption?.textContent).toBe("Audience");
    expect(container.querySelector("label")).toBeNull();
    expect([...group.querySelectorAll("button")].every((button) => button.closest("label") === null)).toBe(true);
  });

  it("still wraps a single control in a label that names it", async () => {
    const { container } = await mount(
      <Field label="Title">
        <input />
      </Field>,
    );

    expect(container.querySelector("label")?.textContent).toBe("Title");
    expect(container.querySelector("[role=group]")).toBeNull();
  });

  it("UC-31.2-01 keeps the Agent and Once buttons of the schedule dialog out of their captions' labels", async () => {
    await mount(withProviders(<ScheduleModal onClose={() => undefined} go={() => undefined} />, directory));
    const button = (text: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text);

    expect(button("Agent")?.closest("label")).toBeNull();
    expect(button("Once")?.closest("label")).toBeNull();
    expect(button("Agent")?.closest("[role=group]")?.getAttribute("aria-labelledby")).toBeTruthy();
  });
});
