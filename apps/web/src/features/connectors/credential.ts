import { z } from "zod";

/**
 * D296: one connector's credential, a typed object stored encrypted as JSON in
 * `ai.connector.secret_ref`, whose `type` is the connector's `auth_type`. Secret fields are
 * write-only; the rest is what `credentialSummary` shows back.
 */

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** What the drawer sends. A secret field left empty on an edit keeps the stored value. */
export const credentialInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("None") }),
  z.object({
    type: z.literal("ApiKey"),
    in: z.enum(["header", "query"]).default("header"),
    name: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/, "Use letters, digits, '-', '_' or '.'."),
    value: optionalText(4000),
  }),
  z.object({ type: z.literal("Bearer"), token: optionalText(8000) }),
  z.object({ type: z.literal("Basic"), username: z.string().trim().min(1).max(500), password: optionalText(1000) }),
  z.object({
    type: z.literal("ClientCredentials"),
    /** A REST API's token endpoint. An MCP server's is discovered from the server when left empty. */
    tokenUrl: z.union([z.url(), z.literal("")]).optional(),
    /** The authorization server the client is registered with, for an MCP server's discovery. */
    issuer: z.union([z.url(), z.literal("")]).optional(),
    clientId: z.string().trim().min(1).max(500),
    clientSecret: optionalText(2000),
    scope: optionalText(1000),
  }),
  z.object({
    type: z.literal("OAuth"),
    /** Empty registers the platform with the server's authorization server (RFC 7591). */
    clientId: optionalText(500),
    clientSecret: optionalText(2000),
    scope: optionalText(1000),
  }),
]);

export type CredentialInput = z.infer<typeof credentialInput>;
export type AuthType = CredentialInput["type"];

/** OAuth state the platform keeps for an authorization-code connector, never shown. */
export type OAuthState = {
  /** As the MCP SDK hands them over, `issuer` included. */
  clientInformation?: Record<string, unknown>;
  tokens?: Record<string, unknown> & { access_token: string; refresh_token?: string; issuer?: string };
  /** When `tokens.access_token` stops working, in epoch ms. */
  expiresAt?: number;
  discovery?: Record<string, unknown>;
  pending?: { state: string; codeVerifier: string; startedBy: string; until: number };
  connectedAt?: string;
};

export type StoredCredential = Exclude<CredentialInput, { type: "None" }> & { oauth?: OAuthState };

/** The secret field each type carries, which an edit may leave empty to keep. */
const SECRET_FIELD: Record<Exclude<AuthType, "None">, string[]> = {
  ApiKey: ["value"],
  Bearer: ["token"],
  Basic: ["password"],
  ClientCredentials: ["clientSecret"],
  OAuth: ["clientSecret"],
};

/** The secret a type cannot work without; a Basic password may be empty, an OAuth client public. */
const REQUIRED_SECRET: Partial<Record<Exclude<AuthType, "None">, string>> = {
  ApiKey: "value",
  Bearer: "token",
  ClientCredentials: "clientSecret",
};

/**
 * A stored credential, read from its plaintext.
 *
 * Credentials saved before D296 are bare strings: a bearer token, an API key as `Header: value`
 * or a bare value, or the client-credentials JSON. They are read in their old form until saved again.
 */
export function readCredential(authType: string, plaintext: string): StoredCredential | null {
  if (authType === "None") return null;
  try {
    const parsed = JSON.parse(plaintext) as { type?: string };
    if (parsed && typeof parsed === "object" && parsed.type) {
      // A credential of another type no longer fits the connector's authorisation.
      return parsed.type === authType ? (parsed as StoredCredential) : null;
    }
    if (authType === "ClientCredentials" && parsed && typeof parsed === "object") {
      return { type: "ClientCredentials", ...(parsed as object) } as StoredCredential;
    }
  } catch {
    // Not JSON: an older bare string.
  }
  if (authType === "Bearer") return { type: "Bearer", token: plaintext };
  if (authType === "ApiKey") {
    const split = plaintext.indexOf(":");
    if (split > 0 && !plaintext.slice(0, split).includes(" ")) {
      return { type: "ApiKey", in: "header", name: plaintext.slice(0, split).trim(), value: plaintext.slice(split + 1).trim() };
    }
    return { type: "ApiKey", in: "header", name: "X-API-Key", value: plaintext };
  }
  if (authType === "OAuth") return { type: "OAuth" };
  return null;
}

/**
 * The credential to store: what was sent, with each secret field left empty taken from the
 * stored one of the same type. An OAuth connector keeps its tokens unless its client changed.
 *
 * @returns `null` for no authentication, `"missing"` when the type needs a secret neither carries.
 */
export function mergeCredential(input: CredentialInput, stored: StoredCredential | null): StoredCredential | null | "missing" {
  if (input.type === "None") return null;
  const merged: Record<string, unknown> = { ...input };
  const same = stored?.type === input.type ? (stored as Record<string, unknown>) : null;
  for (const field of SECRET_FIELD[input.type]) {
    if (!merged[field] && same?.[field]) merged[field] = same[field];
  }
  if (input.type === "OAuth" && same) {
    const sameClient = (same.clientId ?? "") === (input.clientId ?? "") && (same.scope ?? "") === (input.scope ?? "");
    if (sameClient && stored?.oauth) merged.oauth = stored.oauth;
  }
  if (REQUIRED_SECRET[input.type] && !merged[REQUIRED_SECRET[input.type]!]) return "missing";
  return merged as StoredCredential;
}

/** What the drawer may show of a stored credential: everything but its secrets and tokens. */
export type CredentialSummary =
  | { type: "None" }
  | ({ type: Exclude<AuthType, "None">; hasSecret: boolean; connected?: boolean; connectedAt?: string } & Record<string, unknown>);

/**
 * The stored credential with its secret fields removed, `hasSecret` saying whether any was
 * stored, and for OAuth whether an access token is held and since when. With nothing stored it
 * is the auth type alone.
 */
export function credentialSummary(authType: string, stored: StoredCredential | null): CredentialSummary {
  if (authType === "None" || !stored) return { type: (authType || "None") as "None" };
  const { oauth, ...rest } = stored as StoredCredential & Record<string, unknown>;
  const shown: Record<string, unknown> = { ...rest };
  let hasSecret = false;
  for (const field of SECRET_FIELD[stored.type]) {
    if (shown[field]) hasSecret = true;
    delete shown[field];
  }
  return {
    ...(shown as { type: Exclude<AuthType, "None"> }),
    hasSecret,
    ...(stored.type === "OAuth" ? { connected: Boolean(oauth?.tokens?.access_token), connectedAt: oauth?.connectedAt } : {}),
  };
}
