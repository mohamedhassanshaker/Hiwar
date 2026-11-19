import { describe, expect, it } from "vitest";

import { credentialInput, credentialSummary, mergeCredential, readCredential, type StoredCredential } from "@/features/connectors/credential";

describe("D296 a connector's credential", () => {
  it("reads a credential saved before D296 in its old form", () => {
    expect(readCredential("Bearer", "t-1")).toEqual({ type: "Bearer", token: "t-1" });
    expect(readCredential("ApiKey", "X-Tenant-Key: k-1")).toEqual({ type: "ApiKey", in: "header", name: "X-Tenant-Key", value: "k-1" });
    expect(readCredential("ApiKey", "k-2")).toEqual({ type: "ApiKey", in: "header", name: "X-API-Key", value: "k-2" });
    expect(readCredential("ClientCredentials", '{"tokenUrl":"https://a.test/t","clientId":"c","clientSecret":"s"}')).toMatchObject({
      type: "ClientCredentials",
      clientId: "c",
      clientSecret: "s",
    });
  });

  it("does not read a credential of another type, so a changed authentication cannot use it", () => {
    expect(readCredential("Basic", JSON.stringify({ type: "Bearer", token: "t" }))).toBeNull();
    expect(readCredential("None", "anything")).toBeNull();
  });

  it("keeps a stored secret an edit left empty, and refuses a new one without it", () => {
    const stored: StoredCredential = { type: "ApiKey", in: "header", name: "X-API-Key", value: "kept" };
    const edit = credentialInput.parse({ type: "ApiKey", in: "query", name: "apikey" });
    expect(mergeCredential(edit, stored)).toEqual({ type: "ApiKey", in: "query", name: "apikey", value: "kept" });
    expect(mergeCredential(edit, null)).toBe("missing");
    expect(mergeCredential(credentialInput.parse({ type: "Bearer" }), stored)).toBe("missing");
    expect(mergeCredential({ type: "None" }, stored)).toBeNull();
  });

  it("keeps an OAuth connector's tokens while its client is the same, and drops them when it changes", () => {
    const stored: StoredCredential = { type: "OAuth", clientId: "a", oauth: { tokens: { access_token: "at" }, connectedAt: "2026-10-26" } };
    expect(mergeCredential({ type: "OAuth", clientId: "a" }, stored)).toMatchObject({ oauth: { tokens: { access_token: "at" } } });
    expect(mergeCredential({ type: "OAuth", clientId: "b" }, stored)).not.toHaveProperty("oauth");
  });

  it("shows back everything but its secrets and tokens", () => {
    const summary = credentialSummary("ClientCredentials", {
      type: "ClientCredentials",
      tokenUrl: "https://a.test/t",
      clientId: "c",
      clientSecret: "never-shown",
      scope: "read",
    });
    expect(summary).toEqual({ type: "ClientCredentials", tokenUrl: "https://a.test/t", clientId: "c", scope: "read", hasSecret: true });
    const oauth = credentialSummary("OAuth", { type: "OAuth", oauth: { tokens: { access_token: "never-shown" }, connectedAt: "2026-10-26" } });
    expect(JSON.stringify(oauth)).not.toContain("never-shown");
    expect(oauth).toMatchObject({ connected: true, connectedAt: "2026-10-26" });
  });
});
