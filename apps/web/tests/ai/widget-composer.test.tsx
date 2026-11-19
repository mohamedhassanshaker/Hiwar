// @vitest-environment happy-dom
import { act, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "@/features/engage/components/widget-composer";
import type { Input } from "@/features/engage/protocol";
import { cleanup, mount } from "./dom";

/** A Form step in the embedded widget: each field labelled, kept apart, and sent together (D339). */

afterEach(cleanup);

const form: Input = {
  mode: "field",
  field: {
    id: "check_balance",
    type: "form",
    required: true,
    fields: [
      { key: "account_type", label: "Account type", dataType: "Text", required: true, options: [{ value: "eid", label: "Emirates ID" }, { value: "card", label: "Tahseel card" }] },
      { key: "account_number", label: "Account number", dataType: "Text", required: true },
    ],
  },
};

function type(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("the widget's form composer", () => {
  it("labels each field, keeps their values apart, offers a field's choices, and sends them together", async () => {
    const onField = vi.fn();
    const { container } = await mount(
      <Composer
        input={form}
        step="check_balance"
        disabled={false}
        title="shj3"
        lang="en"
        t={(en) => en}
        draft=""
        setDraft={() => {}}
        composerRef={createRef<HTMLInputElement>()}
        voice={false}
        voiceState="idle"
        onMic={() => {}}
        onSend={() => {}}
        onField={onField}
        onUpload={async () => null}
        onOtp={() => {}}
        onResend={() => {}}
        onCancel={() => {}}
      />,
    );
    const formElement = container.querySelector("form")!;
    expect(formElement.textContent).toContain("Account type *");
    expect(formElement.textContent).toContain("Account number *");

    const select = formElement.querySelector("select")!;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Choose…", "Emirates ID", "Tahseel card"]);
    const number = formElement.querySelector("input")!;
    expect(number.placeholder).toBe("Account number");

    await act(async () => type(select, "eid"));
    await act(async () => type(number, "784-1"));
    expect(select.value).toBe("eid");
    expect(number.value).toBe("784-1");

    await act(async () => formElement.requestSubmit());
    expect(onField).toHaveBeenCalledWith("check_balance", JSON.stringify({ account_type: "eid", account_number: "784-1" }));
  });
});

describe("the widget's free-text composer with Voice input on (D386)", () => {
  const free: Input = { mode: "free" };

  it("keeps the microphone beside Send, so a typed or spoken draft can be added to", async () => {
    const onMic = vi.fn();
    const { container } = await mount(
      <Composer
        input={free}
        step={null}
        disabled={false}
        title="shj3"
        lang="en"
        t={(en) => en}
        draft="My card number is"
        setDraft={() => {}}
        composerRef={createRef<HTMLInputElement>()}
        voice
        voiceState="idle"
        onMic={onMic}
        onSend={() => {}}
        onField={() => {}}
        onUpload={async () => null}
        onOtp={() => {}}
        onResend={() => {}}
        onCancel={() => {}}
      />,
    );
    const labels = [...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["Speak", "Send"]);

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Speak"]')!.click());
    expect(onMic).toHaveBeenCalledTimes(1);
  });

  it("holds the microphone while a recording is turned into text", async () => {
    const { container } = await mount(
      <Composer
        input={free}
        step={null}
        disabled={false}
        title="shj3"
        lang="en"
        t={(en) => en}
        draft=""
        setDraft={() => {}}
        composerRef={createRef<HTMLInputElement>()}
        voice
        voiceState="transcribing"
        onMic={() => {}}
        onSend={() => {}}
        onField={() => {}}
        onUpload={async () => null}
        onOtp={() => {}}
        onResend={() => {}}
        onCancel={() => {}}
      />,
    );
    const mic = container.querySelector<HTMLButtonElement>('button[aria-label="Turning your speech into text"]')!;
    expect(mic.disabled).toBe(true);
    expect(mic.getAttribute("aria-busy")).toBe("true");
  });
});
