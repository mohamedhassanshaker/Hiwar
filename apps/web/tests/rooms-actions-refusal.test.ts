import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a room's composer and close dialog are told when a typed value is over its limit (S-23).
 *
 * The actions used to parse their input outside `attempt`, so a message of 8001 characters threw, and the
 * browser answered with a 500 and no reason. These cases hold that each returns the rule instead and that
 * nothing reaches the service.
 */

const service = vi.hoisted(() => ({
  postMessage: vi.fn(),
  closeRoom: vi.fn(),
  createWorkItemFromMessage: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/rooms/service", () => service);

const actions = await import("@/features/rooms/actions");

const longer = (length: number) => "x".repeat(length);

beforeEach(() => vi.clearAllMocks());

describe("room actions refusing a typed value", () => {
  const cases: [string, () => Promise<unknown>, RegExp][] = [
    ["UC-23.1-01 a message of 8001 characters", () => actions.postMessage({ roomKey: "SES-1", text: longer(8001) }), /<=8000 characters/],
    ["UC-23.3-06 a close goal of 2001 characters", () => actions.closeRoom({ roomKey: "SES-1", goal: longer(2001) }), /<=2000 characters/],
    [
      "UC-23.4-03 a work item title of 201 characters",
      () =>
        actions.createWorkItemFromMessage({
          roomKey: "SES-1",
          messageId: crypto.randomUUID(),
          titleEn: longer(201),
          titleAr: longer(201),
        }),
      /<=200 characters/,
    ],
  ];

  it.each(cases)("returns the rule for %s", async (_label, run, rule) => {
    const result = (await run()) as { ok: boolean; reason: string };

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(rule);
    expect(service.postMessage).not.toHaveBeenCalled();
    expect(service.closeRoom).not.toHaveBeenCalled();
    expect(service.createWorkItemFromMessage).not.toHaveBeenCalled();
  });

  it("UC-23.1-01 still posts a message of exactly 8000 characters", async () => {
    service.postMessage.mockResolvedValue({ started: false, note: null });

    expect(await actions.postMessage({ roomKey: "SES-1", text: longer(8000) })).toMatchObject({ ok: true });
    expect(service.postMessage).toHaveBeenCalledOnce();
  });
});
