import { NextResponse } from "next/server";

import { RunNotStarted, startRun } from "@/features/agents/service";
import type { ConversationTurn } from "@/features/agents/types";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/logger";
import { NotPermitted } from "@/lib/session";

/**
 * The AG-UI endpoint one agent is reached through (`UC-03.1-01`).
 *
 * The console's CopilotKit runtime attaches an `HttpAgent` to this path. One POST starts a
 * run and streams its AG-UI events back, because that is the contract the client speaks;
 * the agent service's own API is two calls, and joining them is this route's whole job.
 *
 * It sits in the web app rather than in the agent service on purpose. A run is assembled
 * from the agent's version, instructions, route and budget, and from the permissions of
 * the person asking — all of which are this application's data. The agent service is
 * handed a finished run and a token, never a database and never a session.
 */

// A run streams for as long as it takes, and nothing here may be cached.
export const instant = false;
export const maxDuration = 300;

/** What the AG-UI client sends. Only the parts this route needs are named. */
type RunAgentInput = {
  messages?: { role?: string; content?: unknown }[];
  forwardedProps?: {
    screen?: string;
    /** The panel's own transcript, which is what a saved chat reopened in the panel restores. */
    history?: { role?: string; text?: unknown }[];
  };
};

/** The latest thing the person actually typed. */
function latestUserMessage(body: RunAgentInput): string {
  const messages = body.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && typeof message.content === "string") return message.content;
  }
  return "";
}

/**
 * The turns the panel is holding, as the harness's own conversation.
 *
 * Without this the run only ever saw the latest sentence, so an agent that asked a
 * question could not read the answer: every turn was a new run with no memory, and a
 * follow-up like "what do you need?" restarted the agent's introduction instead of
 * continuing. The whole exchange goes, latest message included — the harness renders it
 * as the conversation block and takes the last entry as the prompt, and compacts the
 * history itself once it outgrows the model's budget.
 */
const ROLES = new Set(["user", "assistant", "system"]);
const MAX_TURNS = 100;

/** The non-empty user, assistant and system turns of the request, the latest `MAX_TURNS` of them. */
function conversationOf(body: RunAgentInput): ConversationTurn[] {
  // The panel's own transcript wins when it sends one: a saved chat reopened in the panel is
  // in the transcript but not in the AG-UI client's own messages, so the run would otherwise
  // start with no idea what was already asked and answered.
  const sent = body.forwardedProps?.history;
  const source: { role?: string; text?: unknown }[] = Array.isArray(sent)
    ? sent
    : (body.messages ?? []).map((message) => ({ role: message.role, text: message.content }));

  const turns: ConversationTurn[] = [];
  for (const message of source) {
    const role = String(message.role ?? "");
    if (!ROLES.has(role) || typeof message.text !== "string") continue;
    const text = message.text.trim();
    // A streaming placeholder is an empty assistant turn; sending it would tell the model
    // it had already answered and said nothing.
    if (!text) continue;
    turns.push({ role: role as ConversationTurn["role"], text });
  }
  return turns.slice(-MAX_TURNS);
}

/**
 * Starts a run of the agent on the assistant panel surface as the signed-in person, then relays
 * the agent service's AG-UI stream for it unchanged, with the run id in `x-awp-run-id`. Answers
 * 400 with no user message, 403 when the person may not invoke the agent, and 503 when the run
 * cannot start or its stream does not open.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentCode: string }> },
): Promise<Response> {
  const { agentCode } = await params;
  const body = (await request.json().catch(() => ({}))) as RunAgentInput;

  const prompt = latestUserMessage(body);
  if (!prompt.trim()) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }

  const forwarded = body.forwardedProps ?? {};

  let runId: string;
  try {
    runId = await startRun({
      agentCode,
      prompt,
      screen: forwarded.screen,
      // This route is the assistant panel, so that is the surface, stated here rather
      // than read from the body. The context type follows from it, so a client cannot
      // name its own.
      surface: "AssistantPanel",
      conversation: conversationOf(body),
    });
  } catch (problem) {
    // `COM-07`: not being allowed to invoke an agent is not an error to investigate.
    if (problem instanceof NotPermitted) {
      return NextResponse.json({ error: "You cannot use this assistant." }, { status: 403 });
    }
    if (problem instanceof RunNotStarted) {
      // `UC-03.1-05`: the panel turns this into "the assistant is unavailable, try again"
      // and the screen behind it is untouched.
      logServerError("/api/agui", problem, { agentCode });
      return NextResponse.json({ error: problem.message }, { status: 503 });
    }
    throw problem;
  }

  const upstream = await fetch(`${env().AGENT_SERVICE_URL}/agui/runs/${runId}/stream`, {
    headers: { accept: "text/event-stream" },
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    logServerError("/api/agui", new Error("the run started but its stream did not open"), {
      agentCode,
      runId,
    });
    return NextResponse.json({ error: "The assistant is unavailable." }, { status: 503 });
  }

  // Passed through rather than parsed: these are AG-UI events and the client is what
  // understands them. Re-encoding here would only add a place for them to be wrong.
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      // The run id lets the viewer open the same run the panel is showing.
      "x-awp-run-id": runId,
      "x-accel-buffering": "no",
    },
  });
}
