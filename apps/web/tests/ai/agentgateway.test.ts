import { beforeAll, describe, expect, it } from "vitest";

import {
  renderAlias,
  renderRoute,
  renderStep,
  resourceName,
  type RenderableRoute,
} from "@/agentgateway/render";

/**
 * What a route from Models & routes becomes in the cluster (stack specification 6.1).
 *
 * The three properties that matter are structural, so they are checked here rather than
 * against a cluster: the chain's order is the failover order, a step is never reachable
 * on its own, and no credential is ever in the rendered resource.
 */

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgresql://awp:awp@127.0.0.1:5432/awp";
  process.env.AUTH_SECRET ??= "test";
});

const ROUTE: RenderableRoute = {
  alias: "reasoning-default",
  steps: [
    {
      provider: "Anthropic",
      model: "claude-sonnet-5",
      secretName: "agentgateway-providers",
      secretKey: "ANTHROPIC_API_KEY",
    },
    {
      provider: "OpenAI",
      model: "gpt-5",
      secretName: "agentgateway-providers",
      secretKey: "OPENAI_API_KEY",
    },
  ],
};

describe("a rendered route", () => {
  it("D290 sends a Decision route's steps to the provider's decisions endpoint, keeping the credential and the failover", () => {
    const route: RenderableRoute = {
      alias: "agent-choice",
      decision: true,
      steps: [
        {
          provider: "Custom",
          baseUrl: "https://openrouter.ai/api/v1",
          endpoint: "https://openrouter.ai/api/v1",
          model: "cloudflare/clef-flash",
          secretName: "provider-conn-1",
          secretKey: "credential",
        },
      ],
    };
    const [step, alias] = renderRoute(route) as unknown as [
      { spec: Record<string, unknown> & { policies: { auth: { credentials: unknown[] } } } },
      { spec: { match: { model: string } } },
    ];
    expect(step.spec).toMatchObject({
      provider: "Custom",
      baseURL: "https://openrouter.ai",
      custom: { formats: [{ type: "Completions", path: "/api/alpha/decisions" }] },
      match: { model: "cloudflare/clef-flash" },
      visibility: "Internal",
    });
    expect(step.spec.policies.auth.credentials).toHaveLength(1);
    expect(alias.spec.match.model).toBe("agent-choice");
  });

  it("UC-60.1-02 puts the chain in failover order, the primary first", () => {
    const alias = renderAlias(ROUTE) as unknown as {
      spec: { virtualModel: { failover: { targets: Array<{ priority: number; model: string }> } } };
    };
    const targets = alias.spec.virtualModel.failover.targets;
    expect(targets.map((target) => target.model)).toEqual(["claude-sonnet-5", "gpt-5"]);
    // Lower is preferred, so the primary has to be the lowest.
    expect(targets.map((target) => target.priority)).toEqual([0, 1]);
  });

  it("matches on the alias, which is the only name an agent uses", () => {
    const alias = renderAlias(ROUTE) as unknown as { spec: { match: { model: string } } };
    expect(alias.spec.match.model).toBe("reasoning-default");
  });

  it("keeps every step internal, so a fallback cannot be called directly", () => {
    for (const [index, step] of ROUTE.steps.entries()) {
      const rendered = renderStep(ROUTE.alias, index, step) as unknown as {
        spec: { visibility: string };
      };
      expect(rendered.spec.visibility).toBe("Internal");
    }
  });

  it("names the credential's Secret and never carries the credential itself", () => {
    const rendered = renderStep(ROUTE.alias, 0, ROUTE.steps[0]);
    const serialised = JSON.stringify(rendered);
    expect(serialised).toContain("agentgateway-providers");
    expect(serialised).toContain("ANTHROPIC_API_KEY");
    // The value of a provider key lives in the Secret and nowhere else (§6.1).
    expect(serialised).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("renders the steps before the alias, so the alias never points at nothing", () => {
    const resources = renderRoute(ROUTE);
    expect(resources).toHaveLength(ROUTE.steps.length + 1);
    expect(resources.at(-1)?.metadata?.name).toBe("reasoning-default");
  });

  it("turns an alias into a name Kubernetes accepts", () => {
    expect(resourceName("Classifier_Typed")).toBe("classifier-typed");
    expect(resourceName("-- odd  name --")).toBe("odd-name");
  });
});

/**
 * The CRD validates each provider-specific block as "set if and only if the provider is
 * this one". A missing block is a 422 at apply time, which is how routes through Azure,
 * Bedrock, Vertex AI and every on-prem engine were silently unappliable: the renderer keyed
 * its provider off the display name, so "Azure OpenAI" fell through to Custom, and Custom
 * carried no block either.
 */
describe("the provider block a step renders", () => {
  it("gives a custom engine the formats it speaks, and nothing else", async () => {
    const { providerBlock } = await import("@/agentgateway/render");
    const block = providerBlock({
      provider: "Custom",
      model: "hiwar-local-fast",
      endpoint: "http://model-engine.awp-app.svc.cluster.local:8080/v1",
      secretName: "s",
      secretKey: "k",
    });
    expect(Object.keys(block)).toEqual(["custom"]);
    expect(block.custom).toEqual({ formats: [{ type: "Completions" }, { type: "Embeddings" }] });
  });

  it("derives the Azure resource name from the connection's host", async () => {
    const { providerBlock } = await import("@/agentgateway/render");
    const block = providerBlock({
      provider: "Azure",
      model: "gpt-4.1",
      endpoint: "tahseel-uaen.openai.azure.com",
      secretName: "s",
      secretKey: "k",
    });
    expect(block).toEqual({ azure: { resourceName: "tahseel-uaen", resourceType: "OpenAI" } });
  });

  it("derives the Bedrock region from the connection's host", async () => {
    const { providerBlock } = await import("@/agentgateway/render");
    const block = providerBlock({
      provider: "Bedrock",
      model: "claude-sonnet-4.5",
      endpoint: "bedrock-runtime.me-central-1",
      secretName: "s",
      secretKey: "k",
    });
    expect(block).toEqual({ bedrock: { region: "me-central-1" } });
  });

  it("gives a provider that takes no block nothing at all", async () => {
    const { providerBlock } = await import("@/agentgateway/render");
    for (const provider of ["Anthropic", "OpenAI", "Gemini", "Mistral", "Groq"]) {
      expect(
        providerBlock({ provider, model: "m", endpoint: "api.example.com", secretName: "s", secretKey: "k" }),
        `${provider} must render no provider block`,
      ).toEqual({});
    }
  });

  it("renders exactly one provider block per step, never two", async () => {
    const { renderStep } = await import("@/agentgateway/render");
    const blocks = ["custom", "azure", "bedrock", "vertexai"];
    for (const provider of ["Custom", "Azure", "Bedrock", "VertexAI", "OpenAI"]) {
      const resource = renderStep("alias", 0, {
        provider,
        model: "m",
        endpoint: "host.example.com",
        secretName: "s",
        secretKey: "k",
      }) as { spec: Record<string, unknown> };
      const present = blocks.filter((name) => resource.spec[name] !== undefined);
      expect(present.length, `${provider} rendered ${present.join(" and ")}`).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * A step renders an auth policy only when the connection's credential is a header. A policy
 * naming a key the Secret has not got makes the backend unusable: the gateway refuses the
 * call before it dials, so the route's failover never runs and the whole chain is dead.
 */
describe("the auth policy a step renders", () => {
  const step = (authType: string | undefined) => ({
    provider: "OpenAI",
    model: "gpt-4.1",
    endpoint: "api.openai.com",
    secretName: "agentgateway-providers",
    secretKey: "OPENAI_API_KEY",
    authType,
  });

  it("sets one for a credential that travels in a header", async () => {
    const { renderStep } = await import("@/agentgateway/render");
    for (const authType of ["ApiKey", "BearerToken", "OAuth"]) {
      const resource = renderStep("alias", 0, step(authType)) as { spec: Record<string, unknown> };
      expect(resource.spec.policies, `${authType} must carry an auth policy`).toBeDefined();
    }
  });

  it("sets none for a workload identity or an engine that needs no credential", async () => {
    const { renderStep } = await import("@/agentgateway/render");
    for (const authType of ["IamRole", "EntraId", "None"]) {
      const resource = renderStep("alias", 0, step(authType)) as { spec: Record<string, unknown> };
      expect(resource.spec.policies, `${authType} must carry no auth policy`).toBeUndefined();
    }
  });

  it("defaults to a header credential when the connection does not say", async () => {
    const { renderStep } = await import("@/agentgateway/render");
    const resource = renderStep("alias", 0, step(undefined)) as { spec: Record<string, unknown> };
    expect(resource.spec.policies).toBeDefined();
  });
});

/**
 * The seeded chain order follows what the install can reach. A cloud step with no key
 * answers 401, which is a client error and correctly not a reason to fail over, so a chain
 * led by unreachable providers is dead end to end.
 */
describe("the seeded route chain order", () => {
  const chain: [string, string, string][] = [
    ["anthropic", "anth-prod", "claude-sonnet-4.5"],
    ["azure", "az-uaen", "gpt-4.1"],
    ["hiwar-local", "hiwar-local-cluster", "hiwar-local-reasoning"],
  ];

  const withEnv = async (vars: Record<string, string | undefined>, body: () => void) => {
    const saved = { ...process.env };
    Object.assign(process.env, vars);
    try {
      body();
    } finally {
      process.env = saved;
    }
  };

  it("leads with the providers whose credentials this install actually holds", async () => {
    const { orderedChain } = await import("@/db/ai-seed/models");
    // Only Anthropic is reachable here. Azure would answer 401, which is a client error and
    // correctly not a reason to fail over, so it must not sit in front of the engine that
    // always answers.
    await withEnv({ ANTHROPIC_API_KEY: "sk-real", AZURE_API_KEY: "" }, () => {
      expect(orderedChain(chain).map(([provider]) => provider)).toEqual(["anthropic", "hiwar-local", "azure"]);
    });

    await withEnv({ ANTHROPIC_API_KEY: "sk-real", AZURE_API_KEY: "az-real" }, () => {
      expect(orderedChain(chain).map(([provider]) => provider)).toEqual(["anthropic", "azure", "hiwar-local"]);
    });
  });

  it("puts the local engine first when the install has no provider key", async () => {
    const { orderedChain } = await import("@/db/ai-seed/models");
    await withEnv(
      {
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
        AZURE_API_KEY: "",
        GEMINI_API_KEY: "",
        OPENROUTER_API_KEY: "",
      },
      () => {
        expect(orderedChain(chain).map(([provider]) => provider)).toEqual(["hiwar-local", "anthropic", "azure"]);
      },
    );
  });

  it("leaves a chain with no local step alone either way", async () => {
    const { orderedChain } = await import("@/db/ai-seed/models");
    const cloudOnly: [string, string, string][] = [["azure", "az-uaen", "gpt-realtime"]];
    await withEnv({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", AZURE_API_KEY: "", GEMINI_API_KEY: "" }, () => {
      expect(orderedChain(cloudOnly)).toEqual(cloudOnly);
    });
  });
});
