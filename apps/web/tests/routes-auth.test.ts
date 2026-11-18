import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * `/api/auth/[...nextauth]`, where Auth.js v5 mounts its own routes (requirement 26).
 *
 * The route is a re-export, so what matters is that it exports the handlers Auth.js built
 * from the platform's configuration, and that those answer without contacting anything.
 * D387: Auth.js has no provider of its own; the console signs people in itself.
 */

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgresql://awp:awp@127.0.0.1:5432/awp";
  process.env.AUTH_SECRET = "a-secret-for-the-tests-only";
  // An origin override would rewrite the request URL; these cases use the request's own.
  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;
});

const realFetch = globalThis.fetch;
/** Every outbound call the handlers make; there must be none. */
let outbound: string[] = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  outbound = [];
});

function recordOutbound(): void {
  globalThis.fetch = (async (url: string | URL | Request) => {
    outbound.push(String(url instanceof Request ? url.url : url));
    throw new Error("no outbound call is expected");
  }) as typeof fetch;
}

describe("/api/auth/[...nextauth]", () => {
  it("exports the GET and POST handlers Auth.js produced", async () => {
    const route = await import("@/app/api/auth/[...nextauth]/route");
    const { handlers } = await import("@/lib/auth");

    expect(route.GET).toBe(handlers.GET);
    expect(route.POST).toBe(handlers.POST);
  });

  it("lists no sign-in provider, since the console signs people in itself (D387)", async () => {
    const { GET } = await import("@/app/api/auth/[...nextauth]/route");
    recordOutbound();

    const response = await GET(new NextRequest("http://console.awp.test/api/auth/providers"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({});
    expect(outbound).toEqual([]);
  });

  it("answers an unknown auth action with 400, without any outbound call", async () => {
    const { GET, POST } = await import("@/app/api/auth/[...nextauth]/route");
    recordOutbound();

    const asGet = await GET(new NextRequest("http://console.awp.test/api/auth/not-an-action"));
    const asPost = await POST(new NextRequest("http://console.awp.test/api/auth/not-an-action", { method: "POST" }));

    expect(asGet.status).toBe(400);
    expect(await asGet.json()).toBe("Bad request.");
    expect(asPost.status).toBe(400);
    expect(outbound).toEqual([]);
  });
});
