import { describe, expect, it } from "vitest";

/**
 * `POST /api/maintenance/schedules/[id]/fire` on an installation with no maintenance token.
 *
 * The bearer token is the only credential this route has, so without one it must refuse to
 * fire anything rather than accept any caller. The cases with a token configured are in
 * `tests/db/routes-schedules.test.ts`, because those reach the schedule rows.
 */

process.env.DATABASE_URL ??= "postgresql://awp:awp@127.0.0.1:5432/awp";
delete process.env.MAINTENANCE_API_TOKEN;

describe("POST /api/maintenance/schedules/[id]/fire with no token configured", () => {
  it("answers 503 and fires nothing, whatever bearer the caller sends", async () => {
    const { POST } = await import("@/app/api/maintenance/schedules/[id]/fire/route");

    const response = await POST(
      new Request("http://web.awp-app.svc:3000/api/maintenance/schedules/x/fire", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
      }),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Scheduled firing is not configured." });
  });
});
