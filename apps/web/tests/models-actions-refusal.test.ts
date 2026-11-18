import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the Models and routes forms are told when a typed value is out of range (S-59, S-60).
 *
 * The actions used to parse their input outside the `try`, so a name that was too long or a
 * retry count of 11 threw, and the browser replaced the whole screen with "Something went
 * wrong". These cases hold that each action returns a message in both languages instead, and
 * that nothing reaches the service.
 */

const service = vi.hoisted(() => ({
  ModelsRejected: class ModelsRejected extends Error {},
  saveRoute: vi.fn(),
  addCloudProvider: vi.fn(),
  addCustomProvider: vi.fn(),
  discoverEngineModels: vi.fn(),
  testConnectionDraft: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/outcome.server", () => ({ attempt: vi.fn() }));
vi.mock("@/features/models/service", () => service);

const actions = await import("@/features/models/actions");

const chain = [{ providerId: crypto.randomUUID(), connectionId: crypto.randomUUID(), modelName: "m" }];
const route = { alias: "reasoning-x", kind: "Standard", chain };

beforeEach(() => vi.clearAllMocks());

describe("saveRoute refusing a typed value", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["an alias with a capital letter or underscore", { alias: "Bad_Alias" }, /lowercase letters, digits and hyphens/],
    ["an alias of 61 characters", { alias: "a".repeat(61) }, /at most 60 characters/],
    ["a confidence threshold of 1.1", { kind: "Typesafe", confidenceThreshold: 1.1 }, /confidence threshold must be at most 1\./],
    ["11 retries", { kind: "Typesafe", maxRetries: 11 }, /retries must be at most 10\./],
    ["a call length of 0 minutes", { kind: "Voice", maxCallMinutes: 0 }, /must be at least 1\./],
    ["a call length of 601 minutes", { kind: "Voice", maxCallMinutes: 601 }, /must be at most 600\./],
    ["a one-character language", { kind: "Voice", languages: ["ar-AE", "a"] }, /language code must be at least 2 characters/],
    ["21 languages", { kind: "Voice", languages: Array.from({ length: 21 }, (_, i) => `l${i}`) }, /at most 20 entries/],
  ];

  it.each(cases)("returns the rule, in both languages, for %s", async (_label, changes, rule) => {
    const result = await actions.saveRoute({ ...route, ...changes });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(rule) });
    expect(result.ok === false && /[؀-ۿ]/.test(result.messageAr)).toBe(true);
    expect(service.saveRoute).not.toHaveBeenCalled();
  });

  it("still saves a valid route", async () => {
    expect(await actions.saveRoute(route)).toEqual({ ok: true });
    expect(service.saveRoute).toHaveBeenCalledOnce();
  });
});

describe("the provider forms refusing a typed value", () => {
  const custom = { name: "Local engine", engine: "ollama", baseUrl: "http://engine:11434", models: ["m"] };

  it("refuses a one-character custom provider name with the minimum length", async () => {
    const result = await actions.addCustomProvider({ ...custom, name: "x" });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/at least 2 characters/) });
  });

  it("refuses a custom provider name of 81 characters with the maximum length", async () => {
    const result = await actions.addCustomProvider({ ...custom, name: "x".repeat(81) });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/at most 80 characters/) });
  });

  it("refuses a base URL that is not a URL", async () => {
    const result = await actions.addCustomProvider({ ...custom, baseUrl: "not a url" });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/base URL must be a web address/) });
    expect(service.addCustomProvider).not.toHaveBeenCalled();
  });

  it("refuses a cloud provider with no model", async () => {
    const result = await actions.addCloudProvider({ name: "Cloud", gatewayProvider: "OpenAI", models: [] });
    expect(result.ok).toBe(false);
    expect(service.addCloudProvider).not.toHaveBeenCalled();
  });

  it("refuses an engine address that is not a URL when asking for its models", async () => {
    const result = await actions.discoverModels({ baseUrl: "engine" });
    expect(result.ok).toBe(false);
    expect(service.discoverEngineModels).not.toHaveBeenCalled();
  });

  it("refuses a draft connection test with no base URL", async () => {
    const result = await actions.testConnectionDraft({
      provider: "Custom",
      baseUrl: "",
      authType: "None",
      models: [{ name: "m", kind: "Chat" }],
    });
    expect(result.ok).toBe(false);
    expect(service.testConnectionDraft).not.toHaveBeenCalled();
  });
});
