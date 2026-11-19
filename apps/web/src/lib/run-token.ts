import { SignJWT, jwtVerify } from "jose";

import { env } from "./env";

/**
 * The per-run identity of stack specification 10.
 *
 * A run token is minted here, on the server, and never reaches the browser (§4.3.2). It
 * travels two ways: the CopilotKit runtime sends it to the agent service as the bearer of
 * an AG-UI request, and the harness presents it to agentgateway, which validates the same
 * signature and decides which models and connectors that run may reach. One secret,
 * `RUN_TOKEN_SIGNING_KEY`, is shared by the three.
 *
 * The claims are the run's whole authority. Nothing downstream widens them: the harness
 * enforces tiers, approvals, trust and project policy on top, and agentgateway refuses
 * anything the token does not name (§6.1, defence in depth).
 */

/**
 * How long a minted token is good for. A run that outlives it re-mints (#31).
 *
 * Exported because the harness has to know when to refresh, and a second constant on
 * that side would be free to disagree with this one.
 */
export const RUN_TOKEN_LIFETIME_SECONDS = 60 * 30;

const ISSUER = "awp-web";
const AUDIENCE = "awp-agents";

/**
 * Which half of the run a token speaks for.
 *
 * `model` is what the agent's own tool calls travel on; `harness` is what the harness's
 * plumbing uses to record an approval, ask a question or finish a run. They are separate
 * tokens because they present identically at the server otherwise — and the model must
 * not be able to call `run_finish` merely by knowing the name.
 */
export type RunTokenKind = "model" | "harness";

export type RunTokenClaims = {
  /** Which half of the run this token speaks for. */
  kind: RunTokenKind;
  /**
   * The run this token was minted for.
   *
   * The plumbing tools all name a run in their arguments, and nothing tied the two
   * together: a token for one run could record an approval against another, or finish it.
   * The claim is the binding, so the run a call acts on has to be the run the token was
   * issued for.
   */
  runId: string;
  /** The agent version this run executes. */
  agentId: string;
  /** The person the run acts for. Every platform MCP call is checked against them. */
  personId: string;
  /** The project whose policies apply, when the run has one. */
  projectId?: string;
  /** The model route aliases the run may call. */
  routes: string[];
  /** The connectors the run may reach, by code. */
  connectors: string[];
  /**
   * Exactly the tools this run may call, by name.
   *
   * The agent's configuration decides what it holds; this is that decision made
   * enforceable. Without it the platform MCP server offered every agent caller the whole
   * catalogue, and the only thing keeping a run out of a tool
   * was that the model had not been told its name. That is obscurity, not a boundary.
   */
  tools: string[];
};

function key(): Uint8Array {
  const secret = env().RUN_TOKEN_SIGNING_KEY;
  if (!secret) throw new Error("RUN_TOKEN_SIGNING_KEY is not set; no run token can be minted");
  return new TextEncoder().encode(secret);
}

/** Mint the token for one run. Server-side only. */
export async function mintRunToken(claims: RunTokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.agentId)
    .setIssuedAt()
    .setExpirationTime(`${RUN_TOKEN_LIFETIME_SECONDS}s`)
    .sign(key());
}

/**
 * Read a token back. Used by the platform MCP server, which is called by the harness
 * through agentgateway and has to know which person the agent is acting for.
 */
export async function verifyRunToken(token: string): Promise<RunTokenClaims> {
  const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: AUDIENCE });
  return {
    // A token minted before this claim existed is a model token: it was the only kind,
    // and reading it as `harness` would widen what it may do.
    kind: payload.kind === "harness" ? "harness" : "model",
    // A token minted before this claim existed names no run, so it may act on none. Such
    // a run has to be drained before the change deploys rather than quietly exempted.
    runId: payload.runId ? String(payload.runId) : "",
    agentId: String(payload.agentId ?? payload.sub ?? ""),
    personId: String(payload.personId ?? ""),
    projectId: payload.projectId ? String(payload.projectId) : undefined,
    routes: Array.isArray(payload.routes) ? payload.routes.map(String) : [],
    connectors: Array.isArray(payload.connectors) ? payload.connectors.map(String) : [],
    tools: Array.isArray(payload.tools) ? payload.tools.map(String) : [],
  };
}
