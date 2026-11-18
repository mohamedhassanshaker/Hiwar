import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the connector drawer is told when a typed value is past its limit (S-54, `UC-54.1-06`).
 *
 * `saveConnector` parsed its input outside the `try`, so a 65-character code or a 201-character name threw and the
 * browser replaced the screen with "Something went wrong" (TC-CON-200, TC-CON-201). It now returns the rule in both
 * languages and nothing reaches the service.
 */

const service = vi.hoisted(() => ({
  ConnectorRejected: class ConnectorRejected extends Error {},
  saveConnector: vi.fn(async () => ({ code: "e2e-ok" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/outcome.server", () => ({ attempt: vi.fn() }));
vi.mock("@/features/connectors/service", () => service);

const actions = await import("@/features/connectors/actions");

const connector = {
  code: "e2e-ok",
  transport: "StreamableHttp",
  url: "https://mcp.example.invalid/mcp",
  authType: "None",
  defaultTier: "T1",
  enabled: false,
};

beforeEach(() => vi.clearAllMocks());

describe("saveConnector refusing a typed value", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["a code of 65 characters", { code: "c".repeat(65) }, /The code must be at most 64 characters\./],
    ["an English name of 201 characters", { nameEn: "n".repeat(201) }, /English name must be at most 200 characters\./],
    ["a server URL of 2,001 characters", { url: `https://e.invalid/${"u".repeat(1983)}` }, /server URL must be at most 2000 characters\./],
  ];

  it.each(cases)("returns the rule, in both languages, for %s", async (_label, changes, rule) => {
    const result = await actions.saveConnector({ ...connector, ...changes });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(rule) });
    expect(result.ok === false && /[؀-ۿ]/.test(result.messageAr)).toBe(true);
    expect(service.saveConnector).not.toHaveBeenCalled();
  });

  it("still saves a code of exactly 64 characters", async () => {
    expect(await actions.saveConnector({ ...connector, code: "c".repeat(64) })).toEqual({ ok: true, code: "e2e-ok" });
    expect(service.saveConnector).toHaveBeenCalledOnce();
  });
});
