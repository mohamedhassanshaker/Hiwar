"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

import { useAwp } from "@/hooks/use-awp";
import { Conversation } from "./assistant-conversation";

/**
 * S-03, the page assistant: an agent run bound to the screen it was opened on.
 *
 * The question goes to the `pa` agent through this application's AG-UI route, which
 * assembles the run and mints a token carrying the person who asked. Every platform tool
 * the run calls is checked against them, so `UC-03.1-04` holds by construction: the
 * assistant cannot read what the person cannot, because the data is not reachable under
 * that token. Nothing here asks it to refuse.
 *
 * `UC-03.1-02`: the screen is forwarded with the run, and the agent reads that screen's
 * data itself rather than being handed content from the browser — a page summary built
 * from what the client happened to have would be neither complete nor trustworthy.
 *
 * Handoff v2 adds the glass panel, the orb at its head, the status line, the typing
 * indicator and the saved history. The history is server-side and per person
 * (`src/features/assistant`), so it follows them to another device.
 */

/**
 * The panel, with its own runtime connection.
 *
 * `UC-03.1-06`: the panel follows the person between pages rather than starting again on
 * each one. The conversation is not keyed by screen — a thread that vanished when someone
 * opened the record it was about is a thread they have to retype — so the component stays
 * mounted and the current path is passed on each turn instead. Every question is still
 * answered about the page it was asked on: `screen` is what the run carries, and the
 * assistant reads that screen with `page_read`. New chat is how a thread is ended.
 */
export function PageAssistant({
  hidden,
  onClose,
}: {
  /** D239: hidden rather than unmounted, so its conversation and a running answer stay. */
  hidden: boolean;
  onClose: () => void;
}) {
  const { t } = useAwp();
  const screen = usePathname();
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={"awp-card awp-assist is-d3 d3a" + (expanded ? " is-expanded" : "")}
      role="dialog"
      aria-label={t("AI Assistant", "المساعد الذكي")}
      hidden={hidden}
      style={hidden ? { display: "none" } : undefined}
    >
      <CopilotKit runtimeUrl="/api/copilotkit">
        <Conversation
          screen={screen}
          expanded={expanded}
          onExpand={() => setExpanded(!expanded)}
          onClose={onClose}
        />
      </CopilotKit>
    </div>
  );
}
