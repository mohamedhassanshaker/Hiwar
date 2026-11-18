import { randomUUID } from "node:crypto";

import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import { ClientCredentialsProvider } from "@modelcontextprotocol/sdk/client/auth-extensions.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { decrypt } from "@/lib/crypto";
import { egressFetch } from "@/lib/egress";
import { env } from "@/lib/env";
import { Rejected } from "@/lib/rejection";
import { readCredential, type OAuthState, type StoredCredential } from "./credential";
import * as repository from "./repository";

/**
 * D296: what a request to a connector carries for its credential, built here for a REST API's
 * calls and for the headers the connector runtime opens an MCP session with. The OAuth flows
 * are the MCP SDK's own `auth()`; requests to an authorization server go through the egress
 * proxy as every other request out of the platform does.
 */

/** Why a connector's credential cannot be used, in words the person or the model acts on. */
export class CredentialUnavailable extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "CredentialUnavailable";
  }
}

/** One connector as building its request authentication needs it. */
export type CredentialTarget = { code: string; serverUrl: string; authType: string; secretRef: Buffer | null };

export type RequestAuth = {
  headers: Record<string, string>;
  /** An API key sent as a query parameter. */
  query: Record<string, string>;
  /** When a token in `headers` stops working, in epoch ms; null when it does not expire. */
  expiresAt: number | null;
};

const NONE: RequestAuth = { headers: {}, query: {}, expiresAt: null };

/** How long a token is reused when its grant says nothing about its lifetime. */
const DEFAULT_TOKEN_MS = 10 * 60 * 1000;
/** A token this close to expiry is treated as expired, so it does not lapse mid-request. */
const HEADROOM_MS = 60 * 1000;

/** Client-credentials tokens by connector code. */
const tokens = new Map<string, { value: string; until: number }>();
/** One refresh at a time per connector, so a rotating refresh token is not spent twice. */
const refreshing = new Map<string, Promise<string>>();

/** Drops a connector's cached token, after its credential changed. */
export function forgetToken(code: string): void {
  tokens.delete(code);
}

/**
 * The headers and query parameters a request to the connector carries for its stored credential,
 * with when a token among them expires. A connector at `None` carries nothing. Client-credentials
 * and OAuth tokens are fetched or refreshed as needed. Throws `CredentialUnavailable` when the
 * credential is missing, unreadable or its grant fails.
 */
export async function requestAuth(target: CredentialTarget): Promise<RequestAuth> {
  if (target.authType === "None") return NONE;
  if (!target.secretRef) {
    throw new CredentialUnavailable(
      `${target.code} needs a credential and has none stored.`,
      `يحتاج ${target.code} إلى بيانات اعتماد ولا يوجد مخزّن.`,
    );
  }
  const credential = readCredential(target.authType, decrypt(target.secretRef));
  if (!credential) {
    throw new CredentialUnavailable(`${target.code}'s credential cannot be read.`, `تعذّرت قراءة بيانات اعتماد ${target.code}.`);
  }

  switch (credential.type) {
    case "ApiKey":
      return credential.in === "query"
        ? { ...NONE, query: { [credential.name]: credential.value ?? "" } }
        : { ...NONE, headers: { [credential.name.toLowerCase()]: credential.value ?? "" } };
    case "Bearer":
      return { ...NONE, headers: { authorization: `Bearer ${credential.token}` } };
    case "Basic":
      return {
        ...NONE,
        headers: { authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password ?? ""}`).toString("base64")}` },
      };
    case "ClientCredentials": {
      const token = await clientCredentialsToken(target, credential);
      return { ...NONE, headers: { authorization: `Bearer ${token.value}` }, expiresAt: token.until };
    }
    case "OAuth": {
      const { value, until } = await oauthToken(target, credential);
      return { ...NONE, headers: { authorization: `Bearer ${value}` }, expiresAt: until };
    }
  }
}

/** Seconds of lifetime as a deadline with headroom, or the default when the grant gave none. */
function deadline(expiresIn: unknown): number {
  const ms = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn * 1000 : DEFAULT_TOKEN_MS;
  return Date.now() + Math.max(ms - HEADROOM_MS, 0);
}

/**
 * A client-credentials token. With a token URL the grant goes straight to it, as a REST API's
 * documentation names one; without, the MCP SDK discovers the authorization server from the
 * server (RFC 9728, RFC 8414) and runs the grant there.
 */
async function clientCredentialsToken(
  target: CredentialTarget,
  credential: Extract<StoredCredential, { type: "ClientCredentials" }>,
): Promise<{ value: string; until: number }> {
  const cached = tokens.get(target.code);
  if (cached && cached.until > Date.now()) return cached;
  if (!credential.clientSecret) {
    throw new CredentialUnavailable(`${target.code}'s client secret is not stored.`, `لم يُخزَّن سر العميل لـ ${target.code}.`);
  }

  let granted: { access_token?: string; expires_in?: number } | undefined;
  try {
    if (credential.tokenUrl) {
      const response = await egressFetch(credential.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: credential.clientId,
          client_secret: credential.clientSecret,
          ...(credential.scope ? { scope: credential.scope } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`the token endpoint refused the grant (${response.status})`);
      granted = (await response.json()) as typeof granted;
    } else {
      const options = { clientId: credential.clientId, clientSecret: credential.clientSecret, scope: credential.scope || undefined };
      // Without an issuer the SDK sends the client to whichever authorization server the MCP server names.
      const provider = credential.issuer
        ? new ClientCredentialsProvider({ ...options, expectedIssuer: credential.issuer })
        : new ClientCredentialsProvider(options);
      await auth(provider, { serverUrl: target.serverUrl, scope: credential.scope || undefined, fetchFn: egressFetch });
      granted = provider.tokens();
    }
  } catch (problem) {
    const reason = problem instanceof Error ? problem.message : String(problem);
    throw new CredentialUnavailable(`${target.code}'s client-credentials grant failed: ${reason}`, `فشل منح بيانات اعتماد العميل لـ ${target.code}: ${reason}`);
  }
  if (!granted?.access_token) {
    throw new CredentialUnavailable(`${target.code}'s token endpoint returned no access token.`, `لم تُعِد نقطة الرموز لـ ${target.code} رمز وصول.`);
  }
  const token = { value: granted.access_token, until: deadline(granted.expires_in) };
  tokens.set(target.code, token);
  return token;
}

/** The redirect an authorization server sends a person back to after they connect a connector. */
export function oauthRedirectUrl(): string {
  return `${env().APP_URL.replace(/\/$/, "")}/api/connectors/oauth/callback`;
}

/**
 * The MCP SDK's `OAuthClientProvider` over a connector's stored credential: what the SDK
 * saves is written back, encrypted, to the connector. Outside a person's Connect it cannot
 * redirect anybody, so a flow that needs one is refused with what to do instead.
 */
class StoredOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  private verifier = "";

  constructor(
    private readonly code: string,
    private readonly credential: Extract<StoredCredential, { type: "OAuth" }>,
    private readonly interactive: { state: string } | null,
  ) {
    credential.oauth ??= {};
  }

  private get oauth(): OAuthState {
    return this.credential.oauth!;
  }

  get redirectUrl(): string {
    return oauthRedirectUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Juman Platform",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.credential.clientSecret ? "client_secret_post" : "none",
      ...(this.credential.scope ? { scope: this.credential.scope } : {}),
    };
  }

  state(): string {
    return this.interactive?.state ?? "";
  }

  /**
   * A configured client ID (with its secret) wins over a registration the SDK saved, keeping the
   * saved issuer only when that registration was for the same client; without one, the SDK's
   * dynamic registration (RFC 7591) is returned.
   */
  clientInformation(): OAuthClientInformationMixed | undefined {
    const saved = this.oauth.clientInformation as OAuthClientInformationMixed | undefined;
    if (!this.credential.clientId) return saved;
    return {
      client_id: this.credential.clientId,
      ...(this.credential.clientSecret ? { client_secret: this.credential.clientSecret } : {}),
      ...(saved?.client_id === this.credential.clientId && "issuer" in saved ? { issuer: saved.issuer } : {}),
    } as OAuthClientInformationMixed;
  }

  async saveClientInformation(information: OAuthClientInformationMixed): Promise<void> {
    this.oauth.clientInformation = information as Record<string, unknown>;
    await this.persist();
  }

  tokens(): OAuthTokens | undefined {
    return this.oauth.tokens as OAuthTokens | undefined;
  }

  /** Stores the SDK's tokens with their deadline, the first connection time, and writes them back encrypted. */
  async saveTokens(saved: OAuthTokens): Promise<void> {
    this.oauth.tokens = saved as OAuthState["tokens"];
    this.oauth.expiresAt = deadline(saved.expires_in);
    this.oauth.connectedAt ??= new Date().toISOString();
    await this.persist();
  }

  /**
   * Keeps the authorization URL for an administrator's Connect to send them to. Outside Connect
   * nobody can be redirected, so it refuses with `CredentialUnavailable` saying to connect again.
   */
  redirectToAuthorization(authorizationUrl: URL): void {
    if (!this.interactive) {
      throw new CredentialUnavailable(
        `${this.code} needs to be connected again: an administrator opens it in Connectors and chooses Connect.`,
        `يجب ربط ${this.code} مجدداً: يفتحه مسؤول في التكامل ويختار ربط.`,
      );
    }
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    return this.verifier || this.oauth.pending?.codeVerifier || "";
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.oauth.discovery as OAuthDiscoveryState | undefined;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.oauth.discovery = state as unknown as Record<string, unknown>;
  }

  async persist(): Promise<void> {
    await repository.writeCredential(this.code, this.credential);
  }
}

/** An authorization-code connector's access token, refreshed through the SDK when it is about to lapse. */
async function oauthToken(
  target: CredentialTarget,
  credential: Extract<StoredCredential, { type: "OAuth" }>,
): Promise<{ value: string; until: number }> {
  const current = credential.oauth?.tokens;
  if (!current?.access_token) {
    throw new CredentialUnavailable(
      `${target.code} is not connected: an administrator opens it in Connectors and chooses Connect.`,
      `${target.code} غير مربوط: يفتحه مسؤول في التكامل ويختار ربط.`,
    );
  }
  const until = credential.oauth?.expiresAt ?? Date.now() + DEFAULT_TOKEN_MS;
  if (until > Date.now()) return { value: current.access_token, until };

  const running = refreshing.get(target.code);
  if (running) return { value: await running, until: Date.now() + HEADROOM_MS };
  const refresh = (async () => {
    const provider = new StoredOAuthProvider(target.code, credential, null);
    try {
      await auth(provider, { serverUrl: target.serverUrl, fetchFn: egressFetch });
    } catch (problem) {
      if (problem instanceof CredentialUnavailable) throw problem;
      const reason = problem instanceof Error ? problem.message : String(problem);
      throw new CredentialUnavailable(`${target.code}'s token could not be refreshed: ${reason}`, `تعذّر تجديد رمز ${target.code}: ${reason}`);
    }
    return credential.oauth!.tokens!.access_token;
  })();
  refreshing.set(target.code, refresh);
  try {
    return { value: await refresh, until: credential.oauth?.expiresAt ?? Date.now() + DEFAULT_TOKEN_MS };
  } finally {
    refreshing.delete(target.code);
  }
}

/** How long a person has to finish signing in at the authorization server. */
const CONNECT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Starts an administrator's Connect: registers the platform with the authorization server when
 * no client id is configured, and returns where to send the person. The state names the
 * connector and is bound to the person, so only they can finish it.
 */
export async function beginConnect(target: CredentialTarget, personId: string): Promise<string> {
  const credential = target.secretRef ? readCredential("OAuth", decrypt(target.secretRef)) : { type: "OAuth" as const };
  if (credential?.type !== "OAuth") throw new CredentialUnavailable(`${target.code} does not use OAuth.`, `${target.code} لا يستخدم OAuth.`);
  // A new sign-in, so stored tokens are not refreshed in its place.
  credential.oauth = { ...credential.oauth, tokens: undefined, expiresAt: undefined };
  const state = `${target.code}.${randomUUID()}`;
  const provider = new StoredOAuthProvider(target.code, credential, { state });
  try {
    await auth(provider, { serverUrl: target.serverUrl, scope: credential.scope || undefined, fetchFn: egressFetch });
  } catch (problem) {
    const reason = problem instanceof Error ? problem.message : String(problem);
    throw new CredentialUnavailable(`${target.code} could not start signing in: ${reason}`, `تعذّر بدء تسجيل الدخول لـ ${target.code}: ${reason}`);
  }
  if (!provider.authorizationUrl) {
    throw new CredentialUnavailable(`${target.code}'s authorization server gave no sign-in address.`, `لم يُعطِ خادم التفويض لـ ${target.code} عنوان تسجيل دخول.`);
  }
  credential.oauth.pending = { state, codeVerifier: provider.codeVerifier(), startedBy: personId, until: Date.now() + CONNECT_WINDOW_MS };
  await provider.persist();
  return provider.authorizationUrl.toString();
}

/** The connector a Connect's state names. */
export function connectorOfState(state: string): string {
  return state.slice(0, state.lastIndexOf("."));
}

/**
 * Finishes a Connect: the state must be the one this person started and still open; the SDK
 * then exchanges the code for tokens, which are stored on the connector.
 */
export async function finishConnect(target: CredentialTarget, state: string, authorizationCode: string, personId: string): Promise<void> {
  const credential = target.secretRef ? readCredential("OAuth", decrypt(target.secretRef)) : null;
  const pending = credential?.type === "OAuth" ? credential.oauth?.pending : undefined;
  if (!credential || credential.type !== "OAuth" || !pending || pending.state !== state || pending.startedBy !== personId || pending.until < Date.now()) {
    throw new CredentialUnavailable(
      "This sign-in is not one you started, or it has expired. Choose Connect again.",
      "تسجيل الدخول هذا ليس مما بدأته أو انتهت مدته. اختر ربط مجدداً.",
    );
  }
  const provider = new StoredOAuthProvider(target.code, credential, { state });
  try {
    await auth(provider, { serverUrl: target.serverUrl, authorizationCode, fetchFn: egressFetch });
  } catch (problem) {
    const reason = problem instanceof Error ? problem.message : String(problem);
    throw new CredentialUnavailable(`${target.code} could not finish signing in: ${reason}`, `تعذّر إكمال تسجيل الدخول لـ ${target.code}: ${reason}`);
  }
  credential.oauth!.pending = undefined;
  credential.oauth!.connectedAt = new Date().toISOString();
  await provider.persist();
}
