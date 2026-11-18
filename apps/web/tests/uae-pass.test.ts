import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authorizeUrl, exchangeCode, logoutUrl, UaePassFailed, userInfo } from "@/features/auth/uae-pass";
import { resetEnvCache } from "@/lib/env";

/**
 * D387: what the console sends UAE PASS and what it reads back, against a real HTTP server
 * standing in for `stg-id.uaepass.ae`, because the requests' exact shape is what UAE PASS checks.
 */

type Seen = { method?: string; url?: string; authorization?: string; contentType?: string; body: string };

let server: Server;
let seen: Seen[] = [];
let replies: { status: number; body: string }[] = [];

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization, contentType: request.headers["content-type"], body });
      const reply = replies.shift() ?? { status: 500, body: "{}" };
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  delete process.env.EGRESS_PROXY_URL;
  process.env.DATABASE_URL ??= "postgresql://unused@localhost:5432/unused";
  process.env.APP_URL = "https://awp.localtest.me:8443";
  process.env.UAEPASS_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.UAEPASS_CLIENT_ID = "sandbox_stage";
  process.env.UAEPASS_CLIENT_SECRET = "sandbox_stage";
  resetEnvCache();
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  seen = [];
  replies = [];
});

describe("authorizeUrl and logoutUrl", () => {
  it("should_ask_for_a_code_with_the_profile_scope_state_callback_and_language", () => {
    const url = new URL(authorizeUrl("state-123", "ar"));

    expect(url.pathname).toBe("/idshub/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "sandbox_stage",
      scope: "urn:uae:digitalid:profile:general",
      state: "state-123",
      redirect_uri: "https://awp.localtest.me:8443/api/uaepass/callback",
      acr_values: "urn:safelayer:tws:policies:authentication:level:low",
      ui_locales: "ar",
    });
  });

  it("should_end_the_uae_pass_session_and_return_to_the_sign_in_page", () => {
    const url = new URL(logoutUrl());

    expect(url.pathname).toBe("/idshub/logout");
    expect(url.searchParams.get("redirect_uri")).toBe("https://awp.localtest.me:8443/sign-in");
  });
});

describe("exchangeCode", () => {
  it("should_post_the_code_as_multipart_with_basic_client_credentials_and_query_parameters", async () => {
    replies.push({ status: 200, body: JSON.stringify({ access_token: "67f2536e-token", token_type: "Bearer", expires_in: 3600 }) });

    expect(await exchangeCode("the-code")).toBe("67f2536e-token");

    const [call] = seen;
    expect(call.method).toBe("POST");
    expect(call.authorization).toBe(`Basic ${Buffer.from("sandbox_stage:sandbox_stage").toString("base64")}`);
    expect(call.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const query = new URL(call.url ?? "", "http://x").searchParams;
    expect(query.get("grant_type")).toBe("authorization_code");
    expect(query.get("code")).toBe("the-code");
    expect(query.get("redirect_uri")).toBe("https://awp.localtest.me:8443/api/uaepass/callback");
    expect(call.body).toContain('name="code"\r\n\r\nthe-code');
  });

  it("should_fail_when_uae_pass_refuses_the_code", async () => {
    replies.push({ status: 400, body: JSON.stringify({ error: "invalid_grant" }) });

    await expect(exchangeCode("expired")).rejects.toBeInstanceOf(UaePassFailed);
  });
});

describe("userInfo", () => {
  it("should_read_the_uuid_user_type_emirates_id_and_names_without_the_comma_padding", async () => {
    replies.push({
      status: 200,
      body: JSON.stringify({
        sub: "UAEPASS/7a05992e-3244-49d3-bcbc-7894c8fca25e",
        uuid: "7a05992e-3244-49d3-bcbc-7894c8fca25e",
        userType: "SOP3",
        idn: "784189014978983",
        fullnameEN: "Ram,,,,ABC,,",
        fullnameAR: "ساوميا,,,,شارما,,",
      }),
    });

    expect(await userInfo("token")).toEqual({
      uuid: "7a05992e-3244-49d3-bcbc-7894c8fca25e",
      userType: "SOP3",
      idn: "784189014978983",
      nameEn: "Ram ABC",
      nameAr: "ساوميا شارما",
    });
    expect(seen[0].authorization).toBe("Bearer token");
  });

  it("should_have_no_emirates_id_for_an_unverified_or_visitor_account", async () => {
    replies.push({ status: 200, body: JSON.stringify({ uuid: "u-1", userType: "SOP1", firstnameEN: "Amar", lastnameEN: "Khan" }) });

    expect(await userInfo("token")).toMatchObject({ uuid: "u-1", userType: "SOP1", idn: null, nameEn: "Amar Khan" });
  });
});
