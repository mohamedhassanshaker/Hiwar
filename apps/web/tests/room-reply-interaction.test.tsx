// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StreamingReply } from "@/features/rooms/components/streaming-reply";
import type { Person, Project } from "@/types/directory";
import { cleanup, click, mount, withProviders } from "./dom";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/rooms",
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

const titles = (scope: ParentNode) =>
  [...scope.querySelectorAll(".d3a-act")].map((step) => [step.className, step.querySelector(".d3a-act-t")?.textContent]);

afterEach(async () => {
  await cleanup();
  FakeSource.last = null;
});

describe("D352 an agent's reply in a room while it is written", () => {
  it("shows each tool call as a step as it runs and returns, between the text before and after it", async () => {
    const { container } = await mount(withProviders(<StreamingReply runId="r1" agentName="Stock SME" />, directory));
    expect(FakeSource.last?.url).toBe("/api/sse/runs/r1");
    expect(container.textContent).toBe("Stock SME is working…");

    await send(
      { type: "TEXT_MESSAGE_START", messageId: "r1" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "r1", delta: "Let me read the market first." },
      { type: "TEXT_MESSAGE_END", messageId: "r1" },
      { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "spx__quote_list", parentMessageId: "r1" },
      { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"query":' },
      { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '"SPX"}' },
      { type: "TOOL_CALL_END", toolCallId: "c1" },
    );
    expect(container.querySelector(".d3a-acts-h")?.textContent).toBe("Working · 1 step");
    expect(titles(container)).toEqual([["d3a-act is-running", "List quote · SPX"]]);

    await send(
      { type: "TOOL_CALL_RESULT", messageId: "r1:c1", toolCallId: "c1", content: '[{"ticker":"APP","last":2.27}]', role: "tool" },
      { type: "TOOL_CALL_START", toolCallId: "c2", toolCallName: "work_item_create", parentMessageId: "r1" },
      { type: "TOOL_CALL_ARGS", toolCallId: "c2", delta: '{"title":"Watch APP"}' },
      { type: "TOOL_CALL_END", toolCallId: "c2" },
      { type: "TOOL_CALL_RESULT", toolCallId: "c2", content: "projectKey is required\n\nFix the errors and try again.", role: "tool" },
      // A question is not a step: the room shows it as its own card.
      { type: "TOOL_CALL_START", toolCallId: "c3", toolCallName: "ask_person", parentMessageId: "r1" },
      { type: "TEXT_MESSAGE_START", messageId: "r1" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "r1", delta: "APP last traded at **2.27**." },
    );
    expect(container.querySelector(".d3a-acts-h")?.textContent).toBe("2 steps done · 1 refused");
    expect(titles(container)).toEqual([
      ["d3a-act is-failed", "Create work item · Watch APP"],
      ["d3a-act is-done", "List quote · SPX"],
    ]);
    expect([...container.children].map((part) => part.className)).toEqual(["d3a-md", "d3a-acts", "d3a-md"]);
    expect(container.lastElementChild?.querySelector("strong")?.textContent).toBe("2.27");

    // A step opens onto its arguments and what came back.
    const quote = container.querySelectorAll(".d3a-act")[1];
    await click(quote.querySelector("button"));
    expect(quote.querySelector(".d3a-act-d")?.textContent).toBe('{\n  "query": "SPX"\n}\n\n[{"ticker":"APP","last":2.27}]');
  });

  it("closes the stream when the reply leaves the room", async () => {
    await mount(withProviders(<StreamingReply runId="r2" agentName="Stock SME" />, directory));
    const source = FakeSource.last!;
    await cleanup();
    expect(source.readyState).toBe(FakeSource.CLOSED);
  });
});
