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
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const source = new EventSource("/api/live?topic=org");
    let pending: ReturnType<typeof setTimeout> | null = null;
    source.onmessage = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        router.refresh();
      }, 300);
    };
    source.onopen = () => setOnline(true);
    source.onerror = () => setOnline(navigator.onLine && source.readyState === EventSource.OPEN);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      source.close();
    };
  }, [orgId, router]);
  if (online) return null;
  return (
    <div className="offline-banner" role="alert">
      You are offline. Changes are kept and sent when the connection is back.
    </div>
  );
}
