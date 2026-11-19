import type { KubernetesObject } from "@kubernetes/client-node";

import { aiNamespace, apply, renderingConfigured } from "@/lib/kubernetes";
import { resourceName } from "./render";

/**
 * The real Kubernetes Secret a provider connection's rendered `AgentgatewayModel` points at.
 *
 * `render.ts` only ever names a Secret in a step's `secretRef` — it never carries the
 * credential itself. This is the one place that credential actually reaches the cluster,
 * keyed by the connection's own id rather than by the provider's display name: a name is
 * bilingual and editable, and deriving the Secret from it would mean renaming a provider
 * silently stops the gateway from finding the credential at all.
 */

const SECRET_KEY = "credential";

/** The Secret's name for a connection, derived from its id so a rename does not move it. */
export function connectionSecretName(connectionId: string): string {
  return resourceName("provider-conn", connectionId);
}

/** The key inside every connection Secret that holds the credential. */
export function connectionSecretKey(): string {
  return SECRET_KEY;
}

/**
 * Put a connection's credential in the Secret its rendered steps reference.
 *
 * Does nothing where there is no service account to apply with, and nothing when no secret
 * was given: an edit that does not change the credential must not blank out the one already
 * there, the same rule `saveConnection` already holds for the database row.
 */
export async function publishConnectionSecret(
  connectionId: string,
  plaintext: string | null | undefined,
): Promise<void> {
  if (!plaintext || !renderingConfigured()) return;
  await apply({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: connectionSecretName(connectionId),
      namespace: aiNamespace(),
      labels: { "app.kubernetes.io/managed-by": "awp-console" },
    },
    type: "Opaque",
    stringData: { [SECRET_KEY]: plaintext },
  } as KubernetesObject);
}
