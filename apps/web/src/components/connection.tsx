"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * PLT-008 FR-006: the offline banner, and the panel's live connection. Server events for the
 * organization refresh the current page's server data (lists, counts, bell).
 */
export function ConnectionBanner({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let source: EventSource | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        router.refresh();
      }, 300);
    };
    const connect = () => {
      source?.close();
      source = new EventSource("/api/live?topic=org");
      source.onmessage = refresh;
      source.onopen = () => setOnline(true);
      source.onerror = () => setOnline(navigator.onLine && source?.readyState === EventSource.OPEN);
    };
    // PLT-008 FR-009: after a network loss the browser may give the stream up for good, so it is
    // opened again, and the page catches up on what changed while it was away.
    const up = () => {
      setOnline(true);
      if (!source || source.readyState === EventSource.CLOSED) connect();
      refresh();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    connect();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      source?.close();
      if (pending) clearTimeout(pending);
    };
  }, [orgId, router]);
  if (online) return null;
  return (
    <div className="offline-banner" role="alert">
      You are offline. Changes are kept and sent when the connection is back.
    </div>
  );
}
