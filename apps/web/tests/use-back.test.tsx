// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }));

import { useBack } from "@/lib/routes";
import { cleanup, mount } from "./dom";

/** Mounts a button that calls `useBack("sessions")`, with `entries` entries in the history. */
async function mountBack(entries: number): Promise<HTMLButtonElement> {
  vi.spyOn(window.history, "length", "get").mockReturnValue(entries);
  function Back() {
    return <button onClick={useBack("sessions")}>Back</button>;
  }
  const { container } = await mount(<Back />);
  return container.querySelector("button") as HTMLButtonElement;
}

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("UC-23.3-07 Back from a room", () => {
  it("steps back in the history so the list returns with its filters", async () => {
    (await mountBack(3)).click();

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("opens the rooms list when the room was the first page of the tab", async () => {
    (await mountBack(1)).click();

    expect(router.push).toHaveBeenCalledWith("/discussion-rooms");
    expect(router.back).not.toHaveBeenCalled();
  });
});
