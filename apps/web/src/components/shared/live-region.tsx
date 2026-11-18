"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page when a channel says something it shows has changed (`UC-10.1-02`).
 *
 * `router.refresh()` re-runs the server components of the current route and swaps the
 * result in, so the cards update in place with the person's own permissions applied again.
 * Nothing is pushed into the client's state, which is why a person never receives a figure
 * they may not see.
 *
 * Bursts are collapsed: ten runs finishing at once are one re-read, not ten. A hidden tab
 * holds no connection at all — it has nothing to show, and a stream per background tab is a
 * socket per background tab on the server and on the machine the browser is running on.
 */

/** How long to wait for the burst to stop before re-reading. */
const SETTLE_MS = 400;

/**
 * Follows the event stream at `path` while the tab is visible and refreshes the route 400 ms
 * after the last message of a burst. Renders a hidden marker whose `data-live` says whether the
 * stream is open.
 */
export function LiveRegion({ path }: { path: string }) {
  const router = useRouter();
  const [live, setLive] = useState(false);

  useEffect(() => {
    let source: EventSource | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const close = () => {
      source?.close();
      source = null;
      setLive(false);
    };

    const open = () => {
      if (source) return;
      source = new EventSource(path);
      source.onopen = () => setLive(true);
      source.onmessage = () => {
        clearTimeout(settle);
        settle = setTimeout(() => router.refresh(), SETTLE_MS);
      };
      // An installation without Valkey answers 501; EventSource would otherwise reconnect
      // for ever against a stream that will never exist.
      source.onerror = () => {
        setLive(false);
        if (source?.readyState === EventSource.CLOSED) close();
      };
    };

    const follow = () => (document.visibilityState === "visible" ? open() : close());
    follow();
    document.addEventListener("visibilitychange", follow);

    return () => {
      document.removeEventListener("visibilitychange", follow);
      clearTimeout(settle);
      close();
    };
  }, [path, router]);

  return <span data-live={live ? "on" : "off"} hidden />;
}
