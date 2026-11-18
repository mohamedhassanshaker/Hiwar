import { describe, expect, it, vi } from "vitest";

import { orThrow, Refused, type Outcome } from "@/lib/outcome";

/**
 * What a screen is told when the server refuses.
 *
 * A server action that throws reaches the browser with its message replaced by a digest, so
 * a refusal the person has to read is returned instead. These are the two halves of that:
 * the server turning a refusal into a value, and the screen turning it back into one error
 * carrying the reason.
 */

vi.mock("@/lib/session", () => ({
  NotPermitted: class NotPermitted extends Error {
    readonly reason: string;
    constructor(permission: string, reason: string) {
      super(`not permitted: ${permission}`);
      this.reason = reason;
    }
  },
}));

const { attempt } = await import("@/lib/outcome.server");
const { NotPermitted } = await import("@/lib/session");

describe("a refusal on its way to the screen", () => {
  it("returns the value when nothing refused", async () => {
    expect(await attempt(async () => "REQ-9000")).toEqual({ ok: true, value: "REQ-9000" });
  });

  it("carries the reason, the suggestion and the problems a refusal had", async () => {
    const refusal = Object.assign(new Error("A web widget cannot be enabled with no allowed origins."), {
      suggestion: "#0f4c3a",
      problems: [{ step: "greet", reason: "NotConfigured" }],
    });

    const outcome = await attempt(async () => {
      throw refusal;
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: "A web widget cannot be enabled with no allowed origins.",
      suggestion: "#0f4c3a",
      problems: [{ step: "greet", reason: "NotConfigured" }],
    });
  });

  it("reads a refused input as the schema's own messages, not as their JSON", async () => {
    const { z } = await import("zod");
    const outcome = await attempt(async () => z.object({ key: z.string().regex(/^[a-z]+$/, "Use lower case.") }).parse({ key: "A B" }));
    expect(outcome).toEqual({ ok: false, reason: "Use lower case." });
  });

  it("still throws a permission refusal, which the console answers in one place", async () => {
    await expect(
      attempt(async () => {
        throw new NotPermitted("projects:write" as never, "no-grant");
      }),
    ).rejects.toBeInstanceOf(NotPermitted);
  });

  it("gives the screen one error with the reason on it", () => {
    const refused: Outcome<string> = { ok: false, reason: "The last owner cannot be removed.", suggestion: "#000000" };
    try {
      orThrow(refused);
      expect.unreachable("orThrow must raise a refusal");
    } catch (problem) {
      expect(problem).toBeInstanceOf(Refused);
      expect((problem as Error).message).toBe("The last owner cannot be removed.");
      expect((problem as Refused).suggestion).toBe("#000000");
    }
    expect(orThrow({ ok: true, value: "PRJ-1" } as Outcome<string>)).toBe("PRJ-1");
  });
});
