import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, expect, it } from "vitest";

import { resetEnvCache } from "@/lib/env";
import { egressFetch } from "@/lib/egress";

/**
 * In the cluster the egress proxy is the web pod's only way out, so a call to a connector's
 * API that does not go through it never arrives (D227).
 */

const upstream = http.createServer((_request, response) => response.end("from the API"));
const hosts: string[] = [];
// A forward proxy that records the host each request names and answers it from `upstream`.
const proxy = http.createServer((request, response) => {
  hosts.push(new URL(request.url ?? "").host);
  const forwarded = http.request(
    { port: (upstream.address() as AddressInfo).port, host: "127.0.0.1", path: request.url, method: request.method },
    (answer) => answer.pipe(response),
  );
  request.pipe(forwarded);
});

const original = { url: process.env.EGRESS_PROXY_URL, db: process.env.DATABASE_URL };

beforeAll(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://unused/awp";
  process.env.EGRESS_PROXY_URL = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  resetEnvCache();
});

afterAll(() => {
  upstream.close();
  proxy.close();
  if (original.url === undefined) delete process.env.EGRESS_PROXY_URL;
  else process.env.EGRESS_PROXY_URL = original.url;
  if (original.db === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original.db;
  resetEnvCache();
});

it("sends a request to an outside host through the egress proxy", async () => {
  const response = await egressFetch("http://api.example.test/v1/quotes", { method: "GET" });
  expect(await response.text()).toBe("from the API");
  expect(hosts).toEqual(["api.example.test"]);
});
