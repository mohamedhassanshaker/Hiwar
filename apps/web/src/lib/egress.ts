import { ProxyAgent, fetch as proxiedFetch, type Dispatcher, type RequestInit as ProxiedInit } from "undici";

import { env } from "./env";

/**
 * Requests to the internet. In the cluster the egress proxy is the web pod's only way out
 * (default-deny network policy), and it admits only the domains the chart allows; with no
 * proxy configured, as in local development, the request goes direct.
 */

let agent: ProxyAgent | null = null;

/** The proxy's dispatcher, or none when no proxy is configured. */
export function egressDispatcher(): Dispatcher | undefined {
  const proxy = env().EGRESS_PROXY_URL;
  if (!proxy) return undefined;
  agent ??= new ProxyAgent(proxy);
  return agent;
}

/** `fetch` to a host outside the platform. */
export async function egressFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const dispatcher = egressDispatcher();
  if (!dispatcher) return fetch(url, init);
  // undici's own fetch, because a dispatcher from this undici is not one Node's bundled
  // fetch accepts. Its Response is the same Fetch standard type.
  return (await proxiedFetch(url, { ...(init as ProxiedInit), dispatcher })) as unknown as Response;
}

/** The reason a request failed, with the network error under undici's "fetch failed". */
export function egressProblem(problem: unknown): string {
  if (!(problem instanceof Error)) return String(problem);
  const cause = problem.cause instanceof Error ? problem.cause.message : null;
  return cause ? `${problem.message}: ${cause}` : problem.message;
}
