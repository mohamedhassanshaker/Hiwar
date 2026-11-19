/**
 * The Test channel checks (`UC-61.1-03`, `UC-61.1-05`).
 *
 * Each check really happens: the credentials are the ones stored, the outbound message goes
 * to the endpoint the channel is configured with, and the inbound check calls this
 * platform's own webhook. A check that cannot run says why instead of passing quietly.
 */

import type { ChannelCheck } from "./types";

export type ChannelCheckInput = {
  channelType: string;
  /** The stored provider credential, already decrypted. */
  secret: string | null;
  endpointUrl: string | null;
  /** This platform's inbound webhook for the channel. */
  inboundUrl: string;
  sendTo: string;
  message: string;
  /** Replaced in tests with a server the test itself runs. */
  fetchImpl?: typeof fetch;
};

const TIMEOUT_MS = 5_000;

function reason(problem: unknown): string {
  if (problem instanceof Error) return problem.name === "TimeoutError" || problem.name === "AbortError" ? `No answer within ${TIMEOUT_MS} ms.` : problem.message;
  return String(problem);
}

/** Runs one check and adds how long it took; a thrown error becomes a failed check with its reason. */
async function timed(call: () => Promise<{ ok: boolean; detail: string }>): Promise<{ ok: boolean; detail: string; ms: number }> {
  const started = performance.now();
  try {
    const result = await call();
    return { ...result, ms: Math.round(performance.now() - started) };
  } catch (problem) {
    return { ok: false, detail: reason(problem), ms: Math.round(performance.now() - started) };
  }
}

/**
 * Runs the three checks and returns one line each. The caller stores the result and the
 * status it implies; nothing here writes.
 */
export async function runChannelChecks(input: ChannelCheckInput): Promise<ChannelCheck[]> {
  const call = input.fetchImpl ?? fetch;
  const checks: ChannelCheck[] = [];

  // The web widget is served by this platform, so there is no provider credential to hold.
  const needsCredential = input.channelType !== "WebWidget";
  checks.push({
    name: "Credentials valid",
    ok: !needsCredential || input.secret !== null,
    detail: !needsCredential
      ? "The web widget is served by the platform and needs no provider credentials."
      : input.secret !== null
        ? "A credential is stored and could be read."
        : "No credential has been saved for this channel.",
    ms: null,
  });

  const outbound = await timed(async () => {
    if (!input.endpointUrl) return { ok: false, detail: "No endpoint is configured for this channel." };
    const answer = await call(input.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(input.secret ? { authorization: `Bearer ${input.secret}` } : {}) },
      body: JSON.stringify({ to: input.sendTo, text: input.message }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      ok: answer.ok,
      detail: answer.ok ? `The provider accepted the message (${answer.status}).` : `The provider answered ${answer.status}.`,
    };
  });
  checks.push({ name: "Outbound message delivered", ...outbound });

  const inbound = await timed(async () => {
    const answer = await call(input.inboundUrl, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return {
      ok: answer.ok,
      detail: answer.ok ? "The inbound webhook answered." : `The inbound webhook answered ${answer.status}.`,
    };
  });
  checks.push({ name: "Inbound webhook reachable", ...inbound });

  return checks;
}
