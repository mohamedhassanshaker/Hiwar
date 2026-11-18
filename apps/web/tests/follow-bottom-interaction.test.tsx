// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { cleanup, mount } from "./dom";

/**
 * D233, D288: a conversation that follows what is being written, the assistant panel's
 * streamed answer and a room's reply alike, without pulling a reader back who scrolled up.
 *
 * happy-dom does no layout, so the list's geometry is set here: 100px tall over 1000px of
 * earlier conversation, and 40px per character written since.
 */

function Thread({ text }: { text: string }) {
  const list = useFollowBottom<HTMLDivElement>(0);
  return (
    <div data-testid="list" ref={list}>
      <p>{text}</p>
    </div>
  );
}

function withGeometry(list: HTMLElement): void {
  Object.defineProperty(list, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(list, "scrollHeight", { get: () => 1000 + 40 * (list.textContent ?? "").length, configurable: true });
}

/** Lets the MutationObserver deliver what the last render changed. */
const observed = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

afterEach(cleanup);

describe("D288 a list that follows the text being written", () => {
  it("keeps the end in view while a reply streams in", async () => {
    const { container, rerender } = await mount(<Thread text="one" />);
    const list = container.querySelector<HTMLElement>('[data-testid="list"]')!;
    withGeometry(list);
    list.scrollTop = list.scrollHeight - 100;
    list.dispatchEvent(new Event("scroll"));

    await rerender(<Thread text="one two three" />);
    await observed();
    expect(list.scrollTop).toBe(list.scrollHeight);
  });

  it("leaves a reader who scrolled up where they are", async () => {
    const { container, rerender } = await mount(<Thread text="one" />);
    const list = container.querySelector<HTMLElement>('[data-testid="list"]')!;
    withGeometry(list);
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll"));

    await rerender(<Thread text="one two three four" />);
    await observed();
    expect(list.scrollTop).toBe(0);
  });
});
