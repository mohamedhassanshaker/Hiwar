"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { useDirectory, useMay } from "@/components/shared/directory";
import { useAwp } from "@/hooks/use-awp";
import { hrefOf, useGo } from "@/lib/routes";
import type { ConversationActivity } from "@/features/engage/types";

/** Raised when the person turns desktop alerts on, so the notifier starts listening at once. */
export const ALERTS_CHANGED = "awp:conversation-alerts";

/** Whether this browser shows desktop notifications and what the person said: null where it cannot. */
function alertPermission(): NotificationPermission | null {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : null;
}

function onAlertsChanged(changed: () => void): () => void {
  window.addEventListener(ALERTS_CHANGED, changed);
  return () => window.removeEventListener(ALERTS_CHANGED, changed);
}

/** The person's answer to desktop notifications, kept current when they turn alerts on; null on the server. */
export function useAlertPermission(): NotificationPermission | null {
  return useSyncExternalStore(onAlertsChanged, alertPermission, () => null);
}

/**
 * D344: a desktop notification for a new visitor conversation, and for a visitor's message in one
 * the agent is answering or this person holds, never one somebody else has taken over. Mounted
 * in the shell, so it alerts on every console screen; it listens only once the person has allowed
 * notifications and may read conversations, and stays connected while the tab is hidden, which
 * is when an alert matters. The conversation the person is looking at does not alert.
 */
export function ConversationNotifier() {
  const may = useMay();
  const { me } = useDirectory();
  const { t } = useAwp();
  const go = useGo();
  const pathname = usePathname();
  const granted = useAlertPermission() === "granted";
  const viewing = useRef(pathname);
  const allowed = may("conversations:read");

  useEffect(() => {
    viewing.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!allowed || !granted) return;
    const source = new EventSource("/api/sse/conversations");
    source.onmessage = (event: MessageEvent<string>) => {
      let activity: ConversationActivity;
      try {
        activity = JSON.parse(event.data) as ConversationActivity;
      } catch {
        return;
      }
      if (activity.kind === "state") return;
      const path = hrefOf("conversation", { id: activity.conversationId });
      if (document.visibilityState === "visible" && viewing.current === path) return;
      const title =
        activity.kind === "started"
          ? t("New visitor conversation", "محادثة زائر جديدة")
          : activity.fromVisitor && (activity.pausedBy === null || activity.pausedBy === me.id)
            ? t("New message from a visitor", "رسالة جديدة من زائر")
            : null;
      if (!title) return;
      // One notification per conversation: a newer one replaces it rather than stacking.
      const shown = new Notification(title, { body: activity.deployment ?? "", tag: activity.conversationId });
      shown.onclick = () => {
        window.focus();
        go("conversation", { id: activity.conversationId });
        shown.close();
      };
    };
    // An installation without Valkey answers 501; stop rather than reconnect for ever.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) source.close();
    };
    return () => source.close();
  }, [allowed, granted, me.id, t, go]);

  return null;
}
