import { describe, expect, it, vi } from "vitest";

/**
 * The Secret a provider connection's rendered `AgentgatewayModel` step actually points at
 * (stack specification 6.1). `render.ts` only ever names it; this is what puts the real
 * credential there.
 */

const applied: unknown[] = [];
let configured = true;

vi.mock("@/lib/kubernetes", () => ({
  apply: async (resource: unknown) => {
    applied.push(resource);
  },
  aiNamespace: () => "awp-ai",
  renderingConfigured: () => configured,
}));

describe("a connection's Secret", () => {
  it("is named deterministically from the connection id alone", async () => {
    const { connectionSecretName } = await import("@/agentgateway/secrets");
    expect(connectionSecretName("abc-123")).toBe(connectionSecretName("abc-123"));
    expect(connectionSecretName("abc-123")).not.toBe(connectionSecretName("def-456"));
  });

  it("carries the plaintext credential, under the one key readRouteForGateway expects", async () => {
    applied.length = 0;
    const { connectionSecretKey, connectionSecretName, publishConnectionSecret } = await import(
      "@/agentgateway/secrets"
    );

    await publishConnectionSecret("conn-1", "sk-real-key");

    expect(applied).toHaveLength(1);
    const secret = applied[0] as {
      kind: string;
      metadata: { name: string; namespace: string };
      stringData: Record<string, string>;
    };
    expect(secret.kind).toBe("Secret");
    expect(secret.metadata.name).toBe(connectionSecretName("conn-1"));
    expect(secret.metadata.namespace).toBe("awp-ai");
    expect(secret.stringData[connectionSecretKey()]).toBe("sk-real-key");
  });

  it("is left alone when no secret was given, so an edit cannot blank out the one already there", async () => {
    applied.length = 0;
    const { publishConnectionSecret } = await import("@/agentgateway/secrets");

    await publishConnectionSecret("conn-1", undefined);
    await publishConnectionSecret("conn-1", null);

    expect(applied).toHaveLength(0);
  });

  it("does nothing where there is no service account to apply with", async () => {
    applied.length = 0;
    configured = false;
    try {
      const { publishConnectionSecret } = await import("@/agentgateway/secrets");
      await publishConnectionSecret("conn-1", "sk-real-key");
      expect(applied).toHaveLength(0);
    } finally {
      configured = true;
    }
  });
});
