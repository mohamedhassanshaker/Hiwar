// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveRunSteps } from "@/features/agents/components/live-run-steps";
import type { Person, Project } from "@/types/directory";
import { cleanup, mount, withProviders } from "./dom";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/agents/runs",
}));

/** The run's stream: the test sends it AG-UI events in their wire form, as `/api/sse/runs/{id}` does. */
class FakeSource {
  static last: FakeSource | null = null;
  static readonly CLOSED = 2;
  readyState = 1;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSource.last = this;
  }
  close() {
    this.readyState = FakeSource.CLOSED;
  }
}
vi.stubGlobal("EventSource", FakeSource);

const send = (...events: Record<string, unknown>[]) =>
  act(async () => {
    for (const event of events) FakeSource.last!.onmessage!({ data: JSON.stringify(event) } as MessageEvent<string>);
  });

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [] as Project[], may: [] };

const steps = (scope: ParentNode) =>
  [...scope.querySelectorAll(".d3a-act")].map((step) => [step.className, step.querySelector(".d3a-act-t")?.textContent]);

afterEach(async () => {
  await cleanup();
  FakeSource.last = null;
});

describe("UC-52.1-04 a running run's timeline follows the run as it happens", () => {
  it("should_show_each_tool_call_as_a_step_while_it_runs_and_its_result_when_it_returns", async () => {
    const { container } = await mount(withProviders(<LiveRunSteps runId="RUN-1" toolsOnly={false} />, directory));
    expect(FakeSource.last?.url).toBe("/api/sse/runs/RUN-1");
    expect(container.querySelector(".d3a-typing[role=status]")).not.toBeNull();
    expect(steps(container)).toEqual([]);

    await send(
      { type: "TEXT_MESSAGE_START", messageId: "m1" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Creating the agent." },
      { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "agent_create" },
      { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"code":"kb2"}' },
      { type: "TOOL_CALL_END", toolCallId: "c1" },
    );
    expect(container.textContent).toContain("Creating the agent.");
    expect(steps(container).map(([state]) => state)).toEqual(["d3a-act is-running"]);

    await send({ type: "TOOL_CALL_RESULT", toolCallId: "c1", content: '{"code":"kb2"}', role: "tool" });
    expect(steps(container).map(([state]) => state)).toEqual(["d3a-act is-done"]);
  });

  it("should_keep_only_the_tool_calls_when_the_timeline_shows_tools_only", async () => {
    const { container } = await mount(withProviders(<LiveRunSteps runId="RUN-2" toolsOnly />, directory));
    await send(
      { type: "TEXT_MESSAGE_START", messageId: "m1" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Thinking aloud." },
      { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "skill_list" },
      { type: "TOOL_CALL_END", toolCallId: "c1" },
    );
    expect(container.textContent).not.toContain("Thinking aloud.");
    expect(steps(container)).toHaveLength(1);
  });
});
