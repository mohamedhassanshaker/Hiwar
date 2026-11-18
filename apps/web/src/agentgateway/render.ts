import type { KubernetesObject } from "@kubernetes/client-node";

import { DECISIONS_PATH } from "@/db/schema/enums";
import { env } from "@/lib/env";
import { aiNamespace } from "@/lib/kubernetes";

/**
 * A route from Models & routes, as agentgateway resources (stack specification 6.1).
 *
 * "Each **route (alias)** from Models & routes becomes an agentgateway LLM backend/route.
 * The harness calls one OpenAI-compatible endpoint and selects the alias. Failover follows
 * the route's fallback chain."
 *
 * That is two kinds of resource:
 *
 * - one `AgentgatewayModel` per step of the chain — a concrete model at one provider,
 *   authenticated by the Secret that provider's credentials live in, and **internal**, so
 *   an agent cannot ask for it directly and bypass the alias;
 * - one `AgentgatewayModel` for the alias itself, whose `virtualModel.failover` lists
 *   those steps in priority order. Priority 0 is the primary; each fallback is the next.
 *
 * Nothing here holds a credential. The provider keys are Kubernetes Secrets the gateway
 * reads; the console only names them.
 */

/** `[provider id, connection id, model]`, as Models & routes stores a step. */
export type RenderStep = {
  /**
   * What agentgateway calls this provider, taken from `ai.model_provider.gateway_provider`.
   * One of `GATEWAY_PROVIDERS`; `Custom` for every on-prem engine.
   */
  provider: string;
  /** For a custom provider: the OpenAI-compatible base URL to call. */
  baseUrl?: string;
  /**
   * The connection's endpoint, which some providers need as an identity rather than a URL.
   * Azure derives its host from a resource name, so `tahseel-uaen.openai.azure.com` is the
   * resource `tahseel-uaen`.
   */
  endpoint?: string;
  /** The model name at that provider. */
  model: string;
  /** The Secret the provider's credentials are in, and the key inside it. */
  secretName: string;
  secretKey: string;
  /**
   * How the connection authenticates. Only a credential carried in a header renders an auth
   * policy; a workload identity (`IamRole`, `EntraId`) and `None` render none.
   */
  authType?: string;
};

export type RenderableRoute = {
  /** The alias agents reference. */
  alias: string;
  /** A Decision route, whose steps answer at the provider's decisions endpoint (D290). */
  decision?: boolean;
  steps: RenderStep[];
};

/** A Kubernetes name: lower case, no underscores, no leading or trailing dash. */
export function resourceName(...parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 253);
}

/**
 * The common shell of every `AgentgatewayModel`: kind, name, the AI namespace, and the labels
 * that mark it as the console's and tie it to its route alias.
 */
function base(name: string, alias: string): KubernetesObject {
  return {
    apiVersion: "agentgateway.dev/v1alpha1",
    kind: "AgentgatewayModel",
    metadata: {
      name,
      namespace: aiNamespace(),
      labels: {
        "app.kubernetes.io/managed-by": "awp-console",
        "awp/route": resourceName(alias),
      },
    },
  };
}

function parentRef() {
  return [{ group: "gateway.networking.k8s.io", kind: "Gateway", name: env().AI_GATEWAY_NAME }];
}

/**
 * Whether a connection's credential is a header the gateway must set.
 *
 * `IamRole` and `EntraId` authenticate as the workload, with no header for us to build.
 * `None` is an engine that needs no credential at all, such as one inside the cluster.
 */
export function carriesHeaderCredential(authType: string | undefined): boolean {
  return authType === undefined || ["ApiKey", "BearerToken", "OAuth"].includes(authType);
}

/**
 * The provider-specific block a step needs, or nothing for a provider that takes none.
 *
 * The CRD validates each as "set if and only if the provider is this one", so this returns
 * exactly one block and the caller merges it.
 */
export function providerBlock(step: RenderStep): Record<string, unknown> {
  switch (step.provider) {
    case "Custom":
      // Every engine the Models screen offers is OpenAI-compatible — that is what makes it
      // offerable — so it speaks chat completions and embeddings.
      return { custom: { formats: [{ type: "Completions" }, { type: "Embeddings" }] } };
    case "Azure": {
      // Azure builds its host from the resource name: `{resourceName}.openai.azure.com`.
      // The connection stores the whole host, so the resource is its first label.
      const resourceName = (step.endpoint ?? "").replace(/^https?:\/\//, "").split(".")[0];
      return { azure: { resourceName, resourceType: "OpenAI" } };
    }
    case "Bedrock":
      // The region is the connection's, e.g. `bedrock-runtime.me-central-1` is me-central-1.
      return { bedrock: { region: (step.endpoint ?? "").split(".").pop() ?? "us-east-1" } };
    case "VertexAI":
      return { vertexai: { projectId: step.endpoint ?? "" } };
    default:
      return {};
  }
}

/**
 * A decision step (D290). agentgateway has no decisions format, so the step is a custom
 * provider at the connection's origin whose chat format is sent to the decisions path: a
 * caller posts the decisions body, with an empty `messages` the gateway's parser requires, to
 * the alias at `/v1/chat/completions`, and the gateway sets the step's model and credential.
 */
function decisionBlock(step: RenderStep): Record<string, unknown> {
  return {
    provider: "Custom",
    custom: { formats: [{ type: "Completions", path: DECISIONS_PATH }] },
    baseURL: new URL(step.endpoint ?? step.baseUrl ?? "").origin,
  };
}

/** One step of the chain: a concrete model at one provider, reachable only through the alias. */
export function renderStep(alias: string, index: number, step: RenderStep, decision = false): KubernetesObject {
  const name = resourceName(alias, "step", String(index));
  const spec: Record<string, unknown> = {
    parentRefs: parentRef(),
    provider: step.provider,
    match: { model: step.model },
    // Internal: an agent asks for the alias, never for the step behind it, so a fallback
    // cannot be called directly and the chain cannot be skipped.
    visibility: "Internal",
  };

  // Only a connection whose credential travels in a header gets an auth policy. A policy
  // naming a key the Secret has not got makes the backend unusable — the gateway refuses
  // the call before it dials — so attaching one unconditionally breaks every connection
  // that authenticates by workload identity, and every engine that needs no credential.
  if (carriesHeaderCredential(step.authType)) {
    spec.policies = {
      auth: {
        credentials: [
          {
            location: { header: { name: "Authorization", prefix: "Bearer " } },
            secretRef: { name: step.secretName, key: step.secretKey },
          },
        ],
      },
    };
  }
  // Several providers take a block of their own, and the CRD enforces it "if and only if":
  // present for that provider, absent for every other. Omitting one is why a route through
  // Azure, Bedrock, Vertex AI or any on-prem engine could never be applied.
  if (decision) {
    Object.assign(spec, decisionBlock(step));
  } else {
    Object.assign(spec, providerBlock(step));
    if (step.baseUrl) spec.baseURL = step.baseUrl;
  }
  return { ...base(name, alias), spec } as KubernetesObject;
}

/** The alias itself: the chain in priority order, which is what failover follows. */
export function renderAlias(route: RenderableRoute): KubernetesObject {
  const spec = {
    parentRefs: parentRef(),
    match: { model: route.alias },
    virtualModel: {
      failover: {
        targets: route.steps.map((step, index) => ({
          modelRef: { name: resourceName(route.alias, "step", String(index)) },
          model: step.model,
          // Lower is preferred: the primary is 0, each fallback one further out.
          priority: index,
        })),
      },
    },
  };
  return { ...base(resourceName(route.alias), route.alias), spec } as KubernetesObject;
}

/** Everything one route renders to, the steps first so the alias never points at nothing. */
export function renderRoute(route: RenderableRoute): KubernetesObject[] {
  return [
    ...route.steps.map((step, index) => renderStep(route.alias, index, step, route.decision)),
    renderAlias(route),
  ];
}
