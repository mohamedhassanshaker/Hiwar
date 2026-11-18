import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the New Work Item dialog and the drawer are told when a typed value is over its limit (S-24, S-25).
 *
 * The actions used to parse their input outside the `try`, so a 201-character title or a 4001-character comment
 * threw, and the browser showed the form "Minified React error #441" instead of the rule. These cases hold that
 * each action returns the rule in both languages and that nothing reaches the service.
 */

const service = vi.hoisted(() => ({
  WorkItemRejected: class WorkItemRejected extends Error {},
  createWorkItem: vi.fn(),
  comment: vi.fn(),
  requestChanges: vi.fn(),
  reopen: vi.fn(),
  approve: vi.fn(),
  addSubItem: vi.fn(),
  searchWorkItems: vi.fn(),
  similarOpenItems: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/work-items/service", () => service);

const actions = await import("@/features/work-items/actions");

const longer = (length: number) => "x".repeat(length);
const newItem = { projectKey: "FIN", titleEn: "A title", titleAr: "A title" };

beforeEach(() => vi.clearAllMocks());

describe("work item actions refusing a typed value", () => {
  const cases: [string, () => Promise<unknown>, RegExp][] = [
    ["UC-24.3-01 a title of 201 characters", () => actions.createWorkItem({ ...newItem, titleEn: longer(201), titleAr: longer(201) }), /title must be at most 200 characters/],
    ["UC-24.3-01 a description of 4001 characters", () => actions.createWorkItem({ ...newItem, descriptionEn: longer(4001) }), /description must be at most 4000 characters/],
    ["UC-25.4-02 a comment of 4001 characters", () => actions.comment({ key: "FIN-1", text: longer(4001) }), /text must be at most 4000 characters/],
    ["UC-25.2-07 a reopen reason of 501 characters", () => actions.reopen({ key: "FIN-1", reason: longer(501) }), /reason must be at most 500 characters/],
    ["UC-25.2-08 an approval reason of 501 characters", () => actions.approve({ key: "FIN-1", override: longer(501) }), /reason must be at most 500 characters/],
    ["UC-25.3-01 a sub item title of 201 characters", () => actions.addSubItem({ parentKey: "FIN-1", titleEn: longer(201) }), /title must be at most 200 characters/],
    ["UC-24.2-01 a keyword of 201 characters", () => actions.searchWorkItems({ keyword: longer(201) }), /keyword must be at most 200 characters/],
  ];

  it.each(cases)("returns the rule, in both languages, for %s", async (_label, run, rule) => {
    const result = (await run()) as { ok: boolean; message: string; messageAr: string };

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(rule);
    expect(result.messageAr).toMatch(/[؀-ۿ]/);
    expect(service.createWorkItem).not.toHaveBeenCalled();
    expect(service.comment).not.toHaveBeenCalled();
    expect(service.reopen).not.toHaveBeenCalled();
    expect(service.approve).not.toHaveBeenCalled();
    expect(service.addSubItem).not.toHaveBeenCalled();
    expect(service.searchWorkItems).not.toHaveBeenCalled();
  });

  it("UC-24.3-05 looks for nothing, and does not throw, for a title past the limit", async () => {
    expect(await actions.similarOpenItems({ projectKey: "FIN", title: longer(201) })).toEqual([]);
    expect(service.similarOpenItems).not.toHaveBeenCalled();
  });

  it("UC-25.4-02 still posts a comment of exactly 4000 characters", async () => {
    service.comment.mockResolvedValue({ mentioned: [] });

    expect(await actions.comment({ key: "FIN-1", text: longer(4000) })).toEqual({ ok: true, mentioned: [] });
    expect(service.comment).toHaveBeenCalledOnce();
  });
});
