import { egressFetch, egressProblem } from "@/lib/egress";
import { env } from "@/lib/env";

/**
 * D387: UAE PASS web authentication, as its integration guide describes it
 * (docs.uaepass.ae, Web Integration): an OAuth 2.0 authorization code, exchanged at the token
 * endpoint with the client's Basic credentials, then the profile from the user-info endpoint.
 * UAE PASS publishes no OpenID discovery document, so the four endpoints are named here under
 * `UAEPASS_BASE_URL` (staging `stg-id.uaepass.ae`, production `id.uaepass.ae`).
 */

/** The scope of a citizen or resident profile (Web Integration, step 1). */
const SCOPE = "urn:uae:digitalid:profile:general";

/** The `error` values UAE PASS returns when the person cancels (Design guidelines, Error messages). */
export const CANCELLED = new Set(["access_denied", "cancelledOnApp", "login_required", "invalid_request"]);

/** What the user-info endpoint returns that sign-in reads. `idn` is absent for SOP1 and for visitors. */
export type UaePassProfile = {
  uuid: string;
  userType: string;
  idn: string | null;
  nameEn: string;
  nameAr: string;
};

/** Thrown when UAE PASS cannot be reached or answers with something that is not a sign-in. */
export class UaePassFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UaePassFailed";
  }
}

/** Whether UAE PASS sign-in is set up: a client id and secret from UAE PASS onboarding. */
export function uaePassConfigured(): boolean {
  const { UAEPASS_CLIENT_ID, UAEPASS_CLIENT_SECRET } = env();
  return Boolean(UAEPASS_CLIENT_ID && UAEPASS_CLIENT_SECRET);
}

/** Where UAE PASS sends the browser back to; the same value goes in the token request. */
export function callbackUrl(): string {
  return new URL("/api/uaepass/callback", env().APP_URL).toString();
}

/** One of the four endpoints under the configured UAE PASS host. */
function endpoint(name: "authorize" | "token" | "userinfo" | "logout"): URL {
  return new URL(`/idshub/${name}`, env().UAEPASS_BASE_URL);
}

/** The address that starts a UAE PASS sign-in, with the login page in the person's language. */
export function authorizeUrl(state: string, lang: "en" | "ar"): string {
  const url = endpoint("authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: env().UAEPASS_CLIENT_ID ?? "",
    scope: SCOPE,
    state,
    redirect_uri: callbackUrl(),
    acr_values: env().UAEPASS_ACR_VALUES,
    ui_locales: lang,
  }).toString();
  return url.toString();
}

/**
 * UAE PASS's logout, which the guide requires after the console's own Log out, returning to
 * the sign-in page.
 */
export function logoutUrl(): string {
  const url = endpoint("logout");
  url.search = new URLSearchParams({ redirect_uri: new URL("/sign-in", env().APP_URL).toString() }).toString();
  return url.toString();
}

/** A JSON answer from UAE PASS, or `UaePassFailed` naming the step and status. */
async function call(step: string, url: URL, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await egressFetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (problem) {
    throw new UaePassFailed(`${step}: ${egressProblem(problem)}`);
  }
  const text = await response.text();
  if (!response.ok) throw new UaePassFailed(`${step}: HTTP ${response.status}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new UaePassFailed(`${step}: the answer is not JSON`);
  }
}

/**
 * The access token for an authorization code. The guide's request: POST, `multipart/form-data`,
 * Basic client credentials, and `grant_type`, `redirect_uri` and `code` as query parameters; they
 * are sent in the form as well, which the token endpoint also reads. A code works for 10 seconds.
 */
export async function exchangeCode(code: string): Promise<string> {
  const { UAEPASS_CLIENT_ID, UAEPASS_CLIENT_SECRET } = env();
  const fields = { grant_type: "authorization_code", redirect_uri: callbackUrl(), code };
  const url = endpoint("token");
  url.search = new URLSearchParams(fields).toString();
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  // Encoded to bytes first: the proxy's fetch is undici's own and does not recognise the
  // runtime's FormData, which it would send as the text "[object FormData]".
  const encoded = new Request(url, { method: "POST", body: form });
  const answer = await call("token", url, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${UAEPASS_CLIENT_ID}:${UAEPASS_CLIENT_SECRET}`).toString("base64")}`,
      "content-type": encoded.headers.get("content-type") ?? "multipart/form-data",
    },
    body: await encoded.arrayBuffer(),
  });
  if (typeof answer.access_token !== "string" || answer.access_token === "") throw new UaePassFailed("token: no access_token");
  return answer.access_token;
}

/** UAE PASS pads full names with commas (`"Ram,,,,ABC,,"`); this is the name as it is read. */
function nameOf(full: unknown, first: unknown, last: unknown): string {
  const padded = typeof full === "string" ? full.split(",").map((part) => part.trim()).filter(Boolean).join(" ") : "";
  return padded || [first, last].filter((part) => typeof part === "string" && part.trim()).join(" ");
}

/** The signed-in person's UAE PASS profile. */
export async function userInfo(accessToken: string): Promise<UaePassProfile> {
  const answer = await call("userinfo", endpoint("userinfo"), { headers: { authorization: `Bearer ${accessToken}` } });
  const uuid = typeof answer.uuid === "string" && answer.uuid ? answer.uuid : typeof answer.sub === "string" ? answer.sub : "";
  if (!uuid) throw new UaePassFailed("userinfo: no uuid");
  return {
    uuid,
    userType: typeof answer.userType === "string" ? answer.userType : "",
    idn: typeof answer.idn === "string" && answer.idn ? answer.idn : null,
    nameEn: nameOf(answer.fullnameEN, answer.firstnameEN, answer.lastnameEN),
    nameAr: nameOf(answer.fullnameAR, answer.firstnameAR, answer.lastnameAR),
  };
}
