import { env } from "./env";

/** Client for `services/agent`. Types mirror `hiwar_agent.turn`. */

export interface ToolSpec {
  key: string;
  name: string;
  description: string;
  access: "read" | "write";
  policy: "read" | "auto" | "staff_approval" | "ask_visitor";
  input_schema: Record<string, unknown>;
  kind: "builtin" | "http";
  endpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  secrets?: Record<string, string>;
}

export interface TurnLine {
  role: "visitor" | "ai" | "staff" | "note";
  text: string;
  name?: string;
}

export interface TurnRequest {
  org_id: string;
  agent: {
    name: string;
    model: "fast" | "standard" | "advanced";
    instructions: string;
    tone: string;
    creativity: number;
    reply_length: string;
    allowed_topics: string;
    blocked_topics: string;
    refusal_message: string;
    disclose_ai: boolean;
    say_unsure: boolean;
    agent_request: boolean;
  };
  transcript: TurnLine[];
  language: "auto" | "ar" | "en";
  sources: { id: string; name: string }[];
  tools: ToolSpec[];
  handback_note?: string | null;
  test?: boolean;
}

export interface ToolEvent {
  key: string;
  name: string;
  access: "read" | "write";
  policy: string;
  inputs: Record<string, unknown>;
  status: "ran" | "failed" | "waiting_approval" | "waiting_visitor" | "proposed";
  result?: unknown;
  duration_ms?: number | null;
}

export interface TurnResult {
  text: string;
  language: "ar" | "en";
  citations: { source_id: string; name: string; chunk: number; confidence: "high" | "medium" | "low"; score: number }[];
  tools: ToolEvent[];
  escalate: string | null;
  low_confidence: boolean;
  negative: boolean;
  unanswered: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_aed: number;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${env().AGENT_SERVICE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${env().AGENT_SERVICE_TOKEN}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`agent service ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

export function runTurn(request: TurnRequest): Promise<TurnResult> {
  return call<TurnResult>("/turn", { method: "POST", body: JSON.stringify(request) });
}

export function ingest(request: {
  org_id: string;
  source_id: string;
  type: "file" | "website" | "faq";
  file?: string;
  mime?: string;
  url?: string;
  depth?: number;
  domains?: string[];
  question?: string;
  answer?: string;
}): Promise<unknown> {
  return call("/ingest", { method: "POST", body: JSON.stringify(request) });
}

export function deleteChunks(orgId: string, sourceId: string): Promise<unknown> {
  return call(`/sources/${sourceId}?org_id=${orgId}`, { method: "DELETE" });
}

export function runTool(tool: ToolSpec, inputs: Record<string, unknown>): Promise<{ ok: boolean; result: unknown; duration_ms: number }> {
  return call("/tools/run", { method: "POST", body: JSON.stringify({ tool, inputs }) });
}

/** Checks the shared token on callbacks from the agent service. */
export function isAgentService(request: Request): boolean {
  return request.headers.get("authorization") === `Bearer ${env().AGENT_SERVICE_TOKEN}`;
}
