import { readFileSync } from "node:fs";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DirectoryProvider } from "@/components/shared/directory";
import { ErrorScreen, NotFound } from "@/components/shared/error-screen";
import { useAwp } from "@/hooks/use-awp";
import { ConsoleSkeleton } from "@/components/shared/skeleton";
import { Ic } from "@/components/ui/icon";
import { NOT_PERMITTED_DIGEST, STALE_WRITE_DIGEST } from "@/lib/digests";
import { PreferencesProvider } from "@/lib/preferences";

/**
 * The screens a route-level error boundary puts up. They are ordinary components, so they
 * are rendered here with `react-dom/server` rather than driven through a browser: what
 * matters is the words they show and the words they do not.
 */
const render = (node: ReactNode) => renderToStaticMarkup(<PreferencesProvider>{node}</PreferencesProvider>);

describe("COM-06 the error boundary", () => {
  it("shows a non-technical banner with Retry and no raw error text", () => {
    const html = render(<ErrorScreen digest="7781234" />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Retry");
    expect(html).not.toContain("7781234");
    expect(html).not.toContain("Error:");
    expect(html).not.toContain("at ");
  });

  it("COM-07 shows “You don’t have access” for a refusal", () => {
    const html = render(<ErrorScreen digest={NOT_PERMITTED_DIGEST} />);
    expect(html).toContain("You don");
    expect(html).toContain("have access");
    expect(html).not.toContain(NOT_PERMITTED_DIGEST);
  });

  it("COM-10 a toast names a stale write in words, not the production placeholder", () => {
    let said = "";
    function Probe() {
      said = useAwp().why({ message: "Minified React error #441", digest: STALE_WRITE_DIGEST });
      return null;
    }
    renderToStaticMarkup(
      <PreferencesProvider>
        <DirectoryProvider value={{ me: null as never, agents: [], people: [], projects: [], may: [] }}>
          <Probe />
        </DirectoryProvider>
      </PreferencesProvider>,
    );
    expect(said).toBe("This record was changed by someone else.");
  });

  it("COM-10 shows the stale-write message with a way to reload", () => {
    const html = render(<ErrorScreen digest={STALE_WRITE_DIGEST} />);
    expect(html).toContain("This record was changed by someone else.");
    expect(html).toContain("Reload");
  });

  it("says the same thing in Arabic", () => {
    // `t(en, ar)` picks by language, so the Arabic half is in the source of every case.
    const source = ["ليس لديك", "تم تغيير هذا السجل"];
    const file = readErrorScreen();
    for (const arabic of source) expect(file).toContain(arabic);
  });
});

describe("COM-04 the loading state", () => {
  it("fills the page slot while a screen is read", () => {
    const html = renderToStaticMarkup(<ConsoleSkeleton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-loading="1"');
    expect(html).toContain("awp-page");
  });
});

describe("an address that belongs to no screen", () => {
  it("says so, and offers the way back in one language at a time", () => {
    const html = render(<NotFound />);
    expect(html).toContain("This screen does not exist");
    // The way back is a link to the dashboard, labelled through `t()` like every other
    // string: one language, the reader's, never both at once.
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain(">Dashboard<");
    expect(html).not.toContain("لوحة المعلومات");
  });
});

function readErrorScreen(): string {
  return readFileSync(new URL("../src/components/shared/error-screen.tsx", import.meta.url), "utf8");
}

describe("the icon component", () => {
  it("hides itself from assistive tech, since the visible label beside it already says what it is", () => {
    const html = render(<Ic n="X" />);
    expect(html).toContain('aria-hidden="true"');
  });
});

