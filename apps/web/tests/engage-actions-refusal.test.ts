import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the storyline and room-mirror forms are told when a typed value is refused (S-64).
 *
 * `createStoryline` and `mirrorRoom` used to parse their input outside `attempt`, so a storyline
 * code of `has-dash` or a name of 121 characters threw and the action answered 500 instead of
 * returning the rule for the form to show.
 */

const service = vi.hoisted(() => ({ createStoryline: vi.fn(), mirrorRoom: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ NotPermitted: class NotPermitted extends Error {} }));
vi.mock("@/features/engage/service", () => service);
vi.mock("@/features/engage/conversations-service", () => ({}));

const actions = await import("@/features/engage/actions");

beforeEach(() => vi.clearAllMocks());

describe("createStoryline refusing a typed value", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["a code of one character", { code: "x" }, /lowercase letters, digits and underscores\./],
    ["a code with a dash", { code: "has-dash" }, /lowercase letters, digits and underscores\./],
    ["a code with a space", { code: "has space" }, /lowercase letters, digits and underscores\./],
    ["a code of 49 characters", { code: "a".repeat(49) }, /lowercase letters, digits and underscores\./],
    ["a name of 121 characters", { nameEn: "n".repeat(121) }, /<=120 characters/],
  ];

  it.each(cases)("returns the rule instead of throwing for %s", async (_label, changes, rule) => {
    const storyline = { code: "valid_code", nameEn: "A name", ...changes };
    const result = await actions.createStoryline({ code: "deployment", storyline });
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(rule) });
    expect(service.createStoryline).not.toHaveBeenCalled();
  });

  it("passes a valid storyline to the service", async () => {
    service.createStoryline.mockResolvedValue(undefined);
    const result = await actions.createStoryline({ code: "deployment", storyline: { code: "valid_code", nameEn: "A name" } });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(service.createStoryline).toHaveBeenCalledWith("deployment", { code: "valid_code", nameEn: "A name", nameAr: "" });
  });
});

describe("mirrorRoom refusing a typed value", () => {
  it("returns a refusal instead of throwing when the input is not an object", async () => {
    const result = await actions.mirrorRoom(null);
    expect(result.ok).toBe(false);
    expect(service.mirrorRoom).not.toHaveBeenCalled();
  });
});
