import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { PreferencesProvider } from "@/lib/preferences";
import type { Directory } from "@/types/directory";

/**
 * Mounting a screen in the DOM for the interaction tests, which run under happy-dom
 * (`// @vitest-environment happy-dom` in the test file) rather than `react-dom/server`.
 */

// Tells React that updates are wrapped in `act`, so it flushes them before `act` returns.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The providers every console screen reads, with no modal registered. */
export function withProviders(node: ReactNode, directory: Directory): ReactNode {
  return (
    <PreferencesProvider>
      <DirectoryProvider value={directory}>
        <ToastProvider>
          <ModalProvider registry={{} as ModalRegistry}>{node}</ModalProvider>
        </ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>
  );
}

const roots: Root[] = [];

/** Renders `node` into a fresh container; `rerender` passes new props as the server would. */
export async function mount(node: ReactNode): Promise<{ container: HTMLElement; rerender: (next: ReactNode) => Promise<void> }> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { container, rerender: (next) => act(async () => root.render(next)) };
}

/** Unmounts everything `mount` rendered and empties the body, portals included. */
export async function cleanup(): Promise<void> {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
}

/** Clicks an element and waits for what the click started, a server action included. */
export async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("nothing to click");
  await act(async () => element.click());
}

/** The first element under `scope` matching `selector` whose text is exactly `text`. */
export function byText(scope: ParentNode, selector: string, text: string): HTMLElement | undefined {
  return [...scope.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.trim() === text);
}
