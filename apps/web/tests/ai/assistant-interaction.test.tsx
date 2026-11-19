// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pushed: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => void nav.pushed.push(href), replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
}));

// The AG-UI client, replaced by a run that ends the way `run.end` says: with the agent's
// text, with a RUN_ERROR event and no throw, which is how `runAgent` reports a refused run,
// or after waiting on a question or an approval until the test releases it.
type Subscriber = {
  onRunStartedEvent?: (params: { event: { runId: string } }) => void;
  onTextMessageContentEvent?: (params: { event: { delta: string } }) => void;
  onRunErrorEvent?: (params: { event: { message: string } }) => void;
  onCustomEvent?: (params: { event: { name: string; value: unknown } }) => void;
  onToolCallStartEvent?: (params: { event: { toolCallId: string; toolCallName: string } }) => void;
  onToolCallEndEvent?: (params: { event: { toolCallId: string }; toolCallArgs: Record<string, unknown> }) => void;
  onToolCallResultEvent?: (params: { event: { toolCallId: string; content: string } }) => void;
};
const run = vi.hoisted(() => ({
  end: "answer" as "answer" | "error" | "question" | "approval" | "form" | "work" | "slow" | "phases",
  sent: [] as string[],
  release: () => undefined as void,
  aborted: false,
}));
/** A run that does work: two calls, the second refused as Pydantic AI tells the model. */
const work: [string, string, Record<string, unknown>, string][] = [
  ["c1", "project_create", { key: "LEDG", nameEn: "Ledger" }, '{"ok":true}'],
  ["c2", "work_item_create", { title: "Close the books" }, "Validation failed: projectKey is required\n\nFix the errors and try again."],
];
vi.mock("@copilotkit/react-core/v2", () => {
  const agent = {
    addMessage: (message: { content: string }) => {
      run.sent.push(message.content);
    },
    abortRun: () => {
      run.aborted = true;
      run.release();
    },
    runAgent: async (_input: unknown, subscriber: Subscriber) => {
      subscriber.onRunStartedEvent?.({ event: { runId: "0199a000-0000-7000-8000-000000000001" } });
      if (run.end === "slow") {
        await new Promise<void>((resolve) => {
          run.release = resolve;
        });
        if (!run.aborted) subscriber.onTextMessageContentEvent?.({ event: { delta: "Done **now**." } });
        return {};
      }
      if (run.end === "error") {
        subscriber.onRunErrorEvent?.({ event: { message: "agent service unavailable" } });
        return {};
      }
      if (run.end === "work") {
        subscriber.onTextMessageContentEvent?.({ event: { delta: "Let me look at the platform first." } });
        for (const [toolCallId, toolCallName, toolCallArgs, content] of work) {
          subscriber.onToolCallStartEvent?.({ event: { toolCallId, toolCallName } });
          subscriber.onToolCallEndEvent?.({ event: { toolCallId }, toolCallArgs });
          subscriber.onToolCallResultEvent?.({ event: { toolCallId, content } });
        }
        subscriber.onTextMessageContentEvent?.({ event: { delta: `Created project LEDG and TSK-0042. ${"The detail of each step follows. ".repeat(30)}` } });
        return {};
      }
      if (run.end === "phases") {
        // Eight reads, a question, then two more calls and the answer.
        const call = (id: string, name: string, key: string) => {
          subscriber.onToolCallStartEvent?.({ event: { toolCallId: id, toolCallName: name } });
          subscriber.onToolCallEndEvent?.({ event: { toolCallId: id }, toolCallArgs: { key } });
          subscriber.onToolCallResultEvent?.({ event: { toolCallId: id, content: "{}" } });
        };
        for (let n = 1; n <= 8; n++) call(`r${n}`, "work_item_search", `MV${n}`);
        subscriber.onCustomEvent?.({ event: { name: "awp.agent.question", value: { questionId: "q-3", question: "Which one?", options: ["MV2", "MV7"] } } });
        await new Promise<void>((resolve) => {
          run.release = resolve;
        });
        subscriber.onTextMessageContentEvent?.({ event: { delta: "Moving MV7 now." } });
        call("w1", "work_item_edit", "MV7");
        call("w2", "work_item_read", "MV7");
        subscriber.onTextMessageContentEvent?.({ event: { delta: "MV7 is done." } });
        return {};
      }
      if (run.end === "question" || run.end === "approval" || run.end === "form") {
        subscriber.onCustomEvent?.({
          event:
            run.end === "question"
              ? { name: "awp.agent.question", value: { questionId: "q-1", question: "Which office?", options: ["Dubai", "Sharjah"] } }
              : run.end === "form"
                ? {
                    name: "awp.agent.question",
                    value: {
                      questionId: "q-2",
                      question: "The project's details",
                      options: [],
                      fields: [
                        { name: "nameEn", label: "Name (English)", options: [], default: "Ledger" },
                        { name: "status", label: "Status", options: ["Active", "Paused"], default: "" },
                      ],
                    },
                  }
                : { name: "awp.tool.approval", value: { approvalKey: "APR-0007", toolName: "file_delete", reason: "file_delete needs a person.", tier: "T2" } },
        });
        await new Promise<void>((resolve) => {
          run.release = resolve;
        });
      }
      subscriber.onTextMessageContentEvent?.({ event: { delta: "Three runs failed today." } });
      return {};
    },
  };
  return {
    CopilotKit: ({ children }: { children: ReactNode }) => children,
    useAgent: () => ({ isReady: true, agent }),
  };
});

const saved = vi.hoisted(() => ({ chats: [] as unknown[], deleted: [] as unknown[], renamed: [] as unknown[], answered: [] as unknown[] }));
vi.mock("@/features/assistant/actions", () => ({
  listSavedChats: async () => [{ id: "chat-1", title: "What failed today?", screen: "/dashboard", lastMessageAt: new Date().toISOString(), messageCount: 2 }],
  readSavedChat: async () => null,
  deleteSavedChat: async (input: unknown) => {
    saved.deleted.push(input);
    return true;
  },
  renameSavedChat: async (input: unknown) => {
    saved.renamed.push(input);
    return true;
  },
  readAttachment: async (input: { name: string }) => {
    reads.push(input.name);
    return { ok: true, text: "Invoice 42: AED 186", truncated: false, storable: !/\.(zip|json|xls)$/.test(input.name) };
  },
  saveChat: async (input: unknown) => {
    saved.chats.push(input);
    return "chat-1";
  },
}));
const reads = vi.hoisted(() => [] as string[]);
const stops = vi.hoisted(() => [] as unknown[]);
const uploads = vi.hoisted(() => [] as unknown[]);
vi.mock("@/features/files/actions", () => ({
  uploadFile: async (input: { name: string }) => {
    uploads.push(input);
    return { ok: true, value: { id: "0199a000-0000-7000-8000-0000000000f1", name: input.name, quarantined: null } };
  },
}));
vi.mock("@/features/agents/actions", () => ({
  stopOwnRun: async (input: unknown) => {
    stops.push(input);
  },
}));
const approvals = vi.hoisted(() => ({ mine: null as string | null, approvers: ["Fatima Noor"], decided: [] as unknown[] }));
vi.mock("@/features/inbox/actions", () => ({
  answerAsked: async (input: unknown) => {
    saved.answered.push(input);
    return { ok: true, runResumed: true };
  },
  panelApproval: async () => ({ inboxItemId: approvals.mine, approvers: approvals.approvers }),
  decide: async (input: unknown) => {
    approvals.decided.push(input);
    return { ok: true, settled: true, runResumed: true };
  },
}));

import { act } from "react";
import { PageAssistant } from "@/features/assistant/components/page-assistant";
import type { Person, Project } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [] as Project[], may: ["agents:invoke" as const] };

const panelOf = (hidden: boolean, dir: typeof directory = directory) =>
  withProviders(<PageAssistant hidden={hidden} onClose={() => undefined} />, dir);

/** Lets the queued saves land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

/** Opens the panel and asks its first suggested question. */
async function askFirstSuggestion() {
  const screen = await mount(panelOf(false));
  await click(screen.container.querySelector(".d3a-sugg .awp-chip"));
  await settle();
  return screen;
}

afterEach(async () => {
  run.release();
  await cleanup();
  run.sent.length = 0;
  run.aborted = false;
  stops.length = 0;
  uploads.length = 0;
  reads.length = 0;
  approvals.mine = null;
  approvals.decided.length = 0;
  nav.pushed.length = 0;
  for (const list of Object.values(saved)) list.length = 0;
});

describe("D177 the assistant panel and a run that ends in RUN_ERROR", () => {
  it("says the assistant is unavailable and keeps nothing: the question saved when asked is taken back", async () => {
    run.end = "error";
    const { container: panel } = await askFirstSuggestion();
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe("The assistant is unavailable, try again");
    expect(panel.querySelector(".d3a-m.is-assistant:not(.d3a-typing)")).toBeNull();
    expect(saved.chats).toHaveLength(1);
    expect(saved.deleted).toEqual([{ chatId: "chat-1" }]);
  });

  it("shows an answered run and saves it as one conversation", async () => {
    run.end = "answer";
    const { container: panel } = await askFirstSuggestion();
    expect(panel.querySelector('[role="alert"]')).toBeNull();
    expect(panel.querySelector(".d3a-m.is-assistant")?.textContent).toContain("Three runs failed today.");
    // Saved when asked and again with the answer, the second time onto the same chat.
    expect(saved.chats).toHaveLength(2);
    expect((saved.chats[1] as { chatId?: string }).chatId).toBe("chat-1");
  });
});

describe("D239 the panel while a run waits on a person", () => {
  it("shows the run's question, takes the answer here, and keeps the chat in the history", async () => {
    run.end = "question";
    const { container: panel } = await askFirstSuggestion();
    const card = panel.querySelector('[role="group"]') as HTMLElement;
    expect(card.textContent).toContain("Which office?");
    // Saved when asked and again when the run started waiting.
    expect(saved.chats).toHaveLength(2);

    await click(byText(card, "button", "Dubai"));
    expect(saved.answered).toEqual([{ questionId: "q-1", answer: "Dubai" }]);
    // Answered, the question leaves the bottom of the panel and stays, with its answer, in the turn it was asked in.
    expect(panel.querySelector('[role="group"]')).toBeNull();
    expect(panel.querySelector(".d3a-m.is-assistant .d3a-asked")?.textContent).toBe("Which office?Dubai");

    await act(async () => run.release());
    await settle();
    expect(panel.textContent).toContain("Three runs failed today.");
  });

  it("says which approval the run waits on and who decides it", async () => {
    run.end = "approval";
    const { container: panel } = await askFirstSuggestion();
    const card = panel.querySelector('[role="status"]') as HTMLElement;
    expect(card.textContent).toContain("Waiting for approval APR-0007");
    expect(card.textContent).toContain("Waiting on Fatima Noor, who decide it in their Inbox");
    expect(byText(card, "button", "Approve")).toBeUndefined();
  });

  it("D281 lets the person it waits on approve it here", async () => {
    run.end = "approval";
    approvals.mine = "0199a000-0000-7000-8000-0000000000a1";
    const { container: panel } = await askFirstSuggestion();
    const card = panel.querySelector('[role="status"]') as HTMLElement;
    await click(byText(card, "button", "Approve"));
    expect(approvals.decided).toEqual([{ inboxItemId: "0199a000-0000-7000-8000-0000000000a1", decision: "Approved" }]);
    expect(card.textContent).toContain("Approved. The run continues.");
  });

  it("D285 asks for changes here, with the note the agent acts on", async () => {
    run.end = "approval";
    approvals.mine = "0199a000-0000-7000-8000-0000000000a3";
    const { container: panel } = await askFirstSuggestion();
    const card = panel.querySelector('[role="status"]') as HTMLElement;
    // Without a note there is nothing for the agent to change.
    expect(byText(card, "button", "Request changes")?.hasAttribute("disabled")).toBe(true);
    await typeInto(card.querySelector('input[aria-label="Note for the agent"]') as HTMLInputElement, "Name it Ledger 2");
    await click(byText(card, "button", "Request changes"));
    expect(approvals.decided).toEqual([
      { inboxItemId: "0199a000-0000-7000-8000-0000000000a3", decision: "ChangesRequested", reason: "Name it Ledger 2" },
    ]);
    expect(card.textContent).toContain("Changes requested. The agent is told what to change.");
  });

  it("D282 in Auto approves it as it arrives, and only for this conversation", async () => {
    run.end = "approval";
    approvals.mine = "0199a000-0000-7000-8000-0000000000a2";
    const { container: panel } = await mount(panelOf(false));
    // D298: the mode is a Manual/Auto choice beside Send.
    const mode = () => panel.querySelector('.d3a-compose button[aria-label="Approval mode"]') as HTMLElement;
    expect(mode().textContent).toBe("Manual");
    await click(mode());
    await click(byText(document.body, '[role="option"]', "Auto"));
    expect(mode().textContent).toBe("Auto");
    await click(panel.querySelector(".d3a-sugg .awp-chip"));
    await settle();
    expect(approvals.decided).toEqual([
      {
        inboxItemId: "0199a000-0000-7000-8000-0000000000a2",
        decision: "Approved",
        reason: "Approved automatically: approval mode Auto in the assistant panel.",
      },
    ]);
    expect((panel.querySelector('[role="status"]') as HTMLElement).textContent).toContain("Approved. The run continues.");

    // A new chat starts in Manual again.
    await act(async () => run.release());
    await settle();
    await click(panel.querySelector('button[aria-label="New chat"]'));
    expect(mode().textContent).toBe("Manual");
  });

  it("hides rather than closes: the conversation is there when it is shown again", async () => {
    run.end = "answer";
    const screen = await askFirstSuggestion();
    await screen.rerender(panelOf(true));
    expect((screen.container.querySelector('[role="dialog"]') as HTMLElement).style.display).toBe("none");
    await screen.rerender(panelOf(false));
    expect(screen.container.textContent).toContain("Three runs failed today.");
  });
});

describe("D239 a file attached to a question, and a chat's name", () => {
  it("sends the file's text with the question and shows only its name", async () => {
    run.end = "answer";
    const { container: panel } = await mount(panelOf(false));
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["%PDF"], "invoice.pdf", { type: "application/pdf" })] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(panel.textContent).toContain("📎 invoice.pdf");

    await click(panel.querySelector('button[aria-label="Send"]'));
    await settle();
    expect(run.sent[0]).toContain("Invoice 42: AED 186");
    expect(panel.querySelector(".d3a-m.is-user")?.textContent).toContain("📎 invoice.pdf");
    expect(panel.querySelector(".d3a-m.is-user")?.textContent).not.toContain("Invoice 42");
  });

  it("names the open chat", async () => {
    run.end = "answer";
    const { container: panel } = await askFirstSuggestion();
    await click(panel.querySelector('button[aria-label="Name this chat"]'));
    const name = panel.querySelector('input[aria-label="Chat name"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "Failed runs");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(byText(panel, "button", "Save"));
    expect(saved.renamed).toEqual([{ chatId: "chat-1", title: "Failed runs" }]);
  });
});

/** Types into a textarea or input as React sees it. */
async function typeInto(field: HTMLTextAreaElement | HTMLInputElement, text: string) {
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(field: HTMLElement, shiftKey = false) {
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true, cancelable: true }));
  });
  await settle();
}

describe("D252 a run that does work", () => {
  it("lists each step with its outcome, newest first, opens a step's detail, keeps the text in order and adds no controls of its own", async () => {
    run.end = "work";
    const { container: panel } = await askFirstSuggestion();
    const header = panel.querySelector(".d3a-acts-h") as HTMLElement;
    expect(header.textContent).toBe("2 steps done · 1 refused");

    // The steps stay open once the run has ended, the latest at the top.
    const steps = [...panel.querySelectorAll(".d3a-act")];
    expect(steps.map((step) => [step.className, step.querySelector(".d3a-act-t")?.textContent])).toEqual([
      ["d3a-act is-failed", "Create work item · Close the books"],
      ["d3a-act is-done", "Create project · Ledger"],
    ]);
    await click(steps[0].querySelector("button"));
    expect(steps[0].querySelector(".d3a-act-d")?.textContent).toContain("projectKey is required");

    // D292: what the agent wrote before its steps comes before them, and the answer after them in full.
    const answer = panel.querySelector(".d3a-m.is-assistant") as HTMLElement;
    expect([...answer.children].map((part) => part.className)).toEqual(["d3a-md", "d3a-acts", "d3a-md"]);
    expect(answer.children[0].textContent).toBe("Let me look at the platform first.");
    expect(answer.children[2].textContent).toBe(`Created project LEDG and TSK-0042. ${"The detail of each step follows. ".repeat(30).trim()}`);

    // The answer names records; the panel adds no controls for them that nobody asked for.
    expect([...answer.querySelectorAll("button")].map((button) => button.textContent).filter((label) => label?.startsWith("Open"))).toEqual([]);
    // Only the text is saved.
    expect(saved.chats.at(-1)).toMatchObject({ turns: [{ role: "user" }, { role: "assistant" }] });
    expect(JSON.stringify(saved.chats.at(-1))).not.toContain("actions");
  });

  it("draws a plain answer as it is", async () => {
    run.end = "answer";
    const { container: panel } = await askFirstSuggestion();
    expect(panel.querySelector(".d3a-acts")).toBeNull();
    expect(panel.querySelector(".d3a-m.is-assistant")?.textContent).toBe("Three runs failed today.");
  });
});

describe("D292 a long run with a question in it", () => {
  it("shows each list's latest 6 steps, newest first, and starts a new list after the answered question", async () => {
    run.end = "phases";
    const { container: panel } = await askFirstSuggestion();
    const titles = (list: Element) => [...list.querySelectorAll(".d3a-act-t")].map((step) => step.textContent);
    const first = panel.querySelector(".d3a-acts") as HTMLElement;
    expect(titles(first)).toEqual(["Search work item · MV8", "Search work item · MV7", "Search work item · MV6", "Search work item · MV5", "Search work item · MV4", "Search work item · MV3"]);
    await click(byText(first, "button", "Show all 8"));
    expect(titles(first)).toHaveLength(8);
    expect(titles(first).at(-1)).toBe("Search work item · MV1");

    await click(byText(panel.querySelector('[role="group"]') as HTMLElement, "button", "MV7"));
    await act(async () => run.release());
    await settle();

    const turn = panel.querySelector(".d3a-m.is-assistant") as HTMLElement;
    expect([...turn.children].map((part) => part.className)).toEqual(["d3a-acts", "d3a-asked", "d3a-md", "d3a-acts", "d3a-md"]);
    expect(turn.children[1].textContent).toBe("Which one?MV7");
    expect(titles(turn.children[3])).toEqual(["Read work item · MV7", "Update work item · MV7"]);
    expect(turn.children[4].textContent).toBe("MV7 is done.");
    // Only the text is saved, a paragraph each.
    expect(JSON.stringify(saved.chats.at(-1))).toContain("Moving MV7 now.\\n\\nMV7 is done.");
  });
});

describe("D252 a question that asks for several values", () => {
  it("draws a form with the proposed values and answers one line per field", async () => {
    run.end = "form";
    const { container: panel } = await askFirstSuggestion();
    const card = panel.querySelector('[role="group"]') as HTMLElement;
    const name = card.querySelector(".d3a-qf input") as HTMLInputElement;
    expect(name.value).toBe("Ledger");
    expect((card.querySelector(".d3a-qf select") as HTMLSelectElement).value).toBe("Active");
    // The free-text answer is replaced by the form.
    expect(card.querySelector('input[aria-label="Your answer"]')).toBeNull();

    await typeInto(name, "General ledger");
    await click(byText(card, "button", "Send"));
    expect(saved.answered).toEqual([{ questionId: "q-2", answer: "Name (English): General ledger\nStatus: Active" }]);
  });
});

describe("D252 the composer", () => {
  it("sends on Enter, keeps a new line on Shift+Enter, and carries several files", async () => {
    run.end = "answer";
    const { container: panel } = await mount(panelOf(false));
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    Object.defineProperty(input, "files", { value: [new File(["a"], "a.pdf"), new File(["b"], "b.xlsx")] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(panel.querySelectorAll(".d3a-files .awp-chip")).toHaveLength(2);

    const message = panel.querySelector("textarea") as HTMLTextAreaElement;
    await typeInto(message, "Compare these\nline by line");
    await press(message, true);
    expect(run.sent).toHaveLength(0);
    await press(message);
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]).toContain("Compare these\nline by line");
    // The agent is told what it holds, and that no stored copy exists to look for.
    // With no project to keep it in, the file is not stored, and the agent is told so.
    expect(run.sent[0]).toContain("--- a.pdf: its full text. It is not stored on the platform. ---\nInvoice 42");
    expect(uploads).toEqual([]);
    expect(run.sent[0]).toContain("--- b.xlsx: its full text.");
    expect(panel.querySelector(".d3a-m.is-user")?.textContent).toContain("📎 a.pdf📎 b.xlsx".replace("📎 b", "\n📎 b"));
  });
});

describe("the panel while a run works", () => {
  it("shows the dots inside the answer until text arrives, then draws the answer as Markdown", async () => {
    run.end = "slow";
    const { container: panel } = await askFirstSuggestion();
    expect(panel.querySelector(".d3a-m.is-assistant .d3a-typing")).not.toBeNull();
    expect(panel.querySelectorAll(".d3a-m.is-assistant")).toHaveLength(1);

    await act(async () => run.release());
    await settle();
    expect(panel.querySelector(".d3a-typing")).toBeNull();
    expect(panel.querySelector(".d3a-m.is-assistant strong")?.textContent).toBe("now");
  });

  it("D67 lets the next question be written, and Stop ends the run and keeps what it said", async () => {
    run.end = "slow";
    const { container: panel } = await askFirstSuggestion();
    const message = panel.querySelector("textarea") as HTMLTextAreaElement;
    expect(message.disabled).toBe(false);
    expect(panel.querySelector('button[aria-label="Send"]')).toBeNull();

    // Enter does not send while the run works.
    await typeInto(message, "And last week?");
    await press(message);
    expect(run.sent).toHaveLength(1);

    await click(panel.querySelector('button[aria-label="Stop"]'));
    await settle();
    expect(run.aborted).toBe(true);
    expect(stops).toEqual([{ runId: "0199a000-0000-7000-8000-000000000001" }]);
    expect(panel.querySelector(".d3a-m.is-assistant")?.textContent).toBe("Stopped.");
    expect(panel.querySelector('[role="alert"]')).toBeNull();

    // The question written meanwhile is still there and now sends.
    expect(message.value).toBe("And last week?");
    await click(panel.querySelector('button[aria-label="Send"]'));
    expect(run.sent).toHaveLength(2);
  });
});

describe("D266 a file sent with a question", () => {
  it("is kept as a file only its sender reads, in the chosen project, and the agent is given its id", async () => {
    run.end = "answer";
    const project = { k: "FIN", n: "Finance", nAr: "المالية", st: "Active", own: "", unit: "", sens: "", items: 0 } as unknown as Project;
    const { container: panel } = await mount(panelOf(false, { ...directory, projects: [project] }));
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["%PDF"], "features.md", { type: "text/markdown" })] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    await click(panel.querySelector('button[aria-label="Send"]'));
    await settle();
    expect(uploads).toEqual([expect.objectContaining({ projectKey: "FIN", name: "features.md", scope: "OnlyMe" })]);
    expect(run.sent[0]).toContain(
      "--- features.md: its full text. It is stored as file 0199a000-0000-7000-8000-0000000000f1 in project FIN, readable only by the person asking. ---",
    );
  });

  it("reads a zip but does not keep it, and says why a .ppt is not read", async () => {
    run.end = "answer";
    const project = { k: "FIN", n: "Finance", nAr: "المالية", st: "Active", own: "", unit: "", sens: "", items: 0 } as unknown as Project;
    const { container: panel } = await mount(panelOf(false, { ...directory, projects: [project] }));
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement;
    for (const type of [".zip", ".pdf", ".json", ".xls", ".xlsx", ".ppt", ".pptx"]) expect(input.accept.split(",")).toContain(type);
    Object.defineProperty(input, "files", { value: [new File(["PK"], "claims.zip"), new File(["x"], "deck.ppt")] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(reads).toContain("claims.zip");
    expect(reads).not.toContain("deck.ppt");
    expect(panel.textContent).toContain("deck.ppt: .ppt files cannot be read. Save it as .pptx and attach it again.");

    await click(panel.querySelector('button[aria-label="Send"]'));
    await settle();
    expect(uploads).toEqual([]);
    expect(run.sent[0]).toContain(
      "--- claims.zip: its full text. It is not stored on the platform: the file store does not keep this type. ---",
    );
  });
});
