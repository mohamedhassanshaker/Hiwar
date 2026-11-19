"use client";

import { useEffect, useState } from "react";

import { failedResult, withAction, withActionChange, withText, type Part } from "./assistant-activity";

/** The AG-UI fields a run's stream carries that are drawn, in the stream's camelCase wire form. */
type StreamEvent = { type?: string; delta?: string; toolCallId?: string; toolCallName?: string; content?: unknown };

/**
 * A run's text and tool calls as they happen, read from its AG-UI stream (`/api/sse/runs/{runId}`) from the start
 * (D161, D352): the text as it arrives, each tool call as a step that is Running until its result comes back, and a
 * new paragraph for each model turn. Calls named in `skip` are left out because the caller draws them its own way.
 * A stream that cannot be opened (no Valkey, or not this person's to read) leaves the parts empty rather than
 * reconnecting for ever.
 */
export function useRunParts(runId: string, skip: readonly string[] = []): Part[] {
  const [parts, setParts] = useState<Part[]>([]);
  const skipped = skip.join("|");

  useEffect(() => {
    const hidden = new Set(skipped ? skipped.split("|") : []);
    // A call's arguments arrive as JSON deltas between its start and its end.
    const args = new Map<string, string>();
    const source = new EventSource(`/api/sse/runs/${runId}`);
    source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as StreamEvent;
      const id = event.toolCallId ?? "";
      if (event.type === "TEXT_MESSAGE_START") setParts((now) => (now.at(-1)?.kind === "text" ? withText(now, "\n\n") : now));
      if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) setParts((now) => withText(now, event.delta!));
      if (event.type === "TOOL_CALL_START" && event.toolCallName && !hidden.has(event.toolCallName)) {
        const name = event.toolCallName;
        setParts((now) => withAction(now, { id, name, args: {}, state: "running", result: "" }));
      }
      if (event.type === "TOOL_CALL_ARGS" && event.delta) args.set(id, (args.get(id) ?? "") + event.delta);
      if (event.type === "TOOL_CALL_END") {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(args.get(id) || "{}") as Record<string, unknown>;
        } catch {
          // Arguments the model sent as broken JSON are shown without them.
        }
        setParts((now) => withActionChange(now, id, { args: parsed }));
      }
      if (event.type === "TOOL_CALL_RESULT") {
        const content = typeof event.content === "string" ? event.content : JSON.stringify(event.content);
        setParts((now) => withActionChange(now, id, { state: failedResult(content) ? "failed" : "done", result: content }));
      }
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) source.close();
    };
    return () => source.close();
  }, [runId, skipped]);

  return parts;
}
