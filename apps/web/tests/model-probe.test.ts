import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { probeModels, untestableReason } from "@/lib/model-probe";

/**
 * `UC-59.1-03`, `UC-59.1-06` and `UC-59.1-08`: what a connection test reports.
 *
 * Against a real HTTP server rather than a stubbed function, because what matters is the
 * request the platform actually sends and the verdict it draws from a real response —
 * including the case an admin hits most, a credential that is wrong.
 */

// No proxy: the provider under test is on this machine.
delete process.env.EGRESS_PROXY_URL;
// `env()` validates the whole environment, so a module that reads one optional value from
// it still needs the rest to be present.
process.env.DATABASE_URL ??= "postgresql://unused@localhost:5432/unused";

type Seen = { authorization?: string; body: string; url?: string; contentType?: string };

let server: Server;
let base = "";
let seen: Seen[] = [];
/** What the next request is answered with, in order. */
let replies: { status: number; body: string }[] = [];

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push({ authorization: request.headers.authorization, body, url: request.url, contentType: request.headers["content-type"] });
      const reply = replies.shift() ?? { status: 200, body: JSON.stringify({ choices: [] }) };
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const connection = () => ({
  provider: "OpenAI",
  baseUrl: base,
  authType: "ApiKey",
  secret: "sk-test",
});

const chat = (name: string) => ({ name, kind: "Chat" });
const embed = (name: string) => ({ name, kind: "Embedding" });
const decide = (name: string) => ({ name, kind: "Decision" });
const image = (name: string) => ({ name, kind: "Image" });
const speech = (name: string) => ({ name, kind: "Speech" });
const transcribe = (name: string) => ({ name, kind: "Transcription" });
const rerank = (name: string) => ({ name, kind: "Rerank" });
const kind = (name: string, k: string) => ({ name, kind: k });

describe("testing a model connection", () => {
  it("UC-59.1-03 reports each model on its own", async () => {
    seen = [];
    replies = [];

    const results = await probeModels({ ...connection(), models: [chat("gpt-5"), chat("gpt-5-mini")] });
    expect(results.map((one) => [one.model, one.ok])).toEqual([
      ["gpt-5", true],
      ["gpt-5-mini", true],
    ]);
  });

  it("UC-59.1-08 a wrong secret is an authentication failure, named as one", async () => {
    seen = [];
    replies = [{ status: 401, body: JSON.stringify({ error: { message: "Incorrect API key" } }) }];

    const [result] = await probeModels({ ...connection(), models: [chat("gpt-5")] });
    expect(result.ok).toBe(false);
    // The status, not the provider's prose: an admin needs to know it is the key.
    expect(result.detail).toMatch(/Authentication failed \(401\)/);
  });

  it("one model failing does not decide the others", async () => {
    seen = [];
    // One request at a time, so the order of the replies is the order of the models.
    const first = await probeModels({ ...connection(), models: [chat("retired-model")] });
    replies = [{ status: 404, body: "no such model" }];
    const failed = await probeModels({ ...connection(), models: [chat("retired-model")] });
    const passed = await probeModels({ ...connection(), models: [chat("gpt-5")] });

    expect(first[0].ok).toBe(true);
    expect(failed[0].ok).toBe(false);
    expect(failed[0].detail).toContain("404");
    expect(passed[0].ok).toBe(true);
  });

  it("carries the credential as a bearer token and asks for one token", async () => {
    seen = [];
    replies = [];

    await probeModels({ ...connection(), models: [chat("gpt-5")] });
    expect(seen).toHaveLength(1);
    expect(seen[0].authorization).toBe("Bearer sk-test");
    // One token is all it takes to prove the credential, the model and the way out.
    expect(JSON.parse(seen[0].body)).toMatchObject({ model: "gpt-5", max_tokens: 1 });
  });

  it("an embedding model is called at /embeddings with input, not /chat/completions", async () => {
    seen = [];
    replies = [];

    const [result] = await probeModels({ ...connection(), models: [embed("text-embedding-3-small")] });
    expect(result.ok).toBe(true);
    expect(seen[0].url).toBe("/v1/embeddings");
    expect(JSON.parse(seen[0].body)).toEqual({ model: "text-embedding-3-small", input: "ping" });
  });

  it("a decision model is called at the origin's /api/alpha/decisions, off the base path", async () => {
    seen = [];
    replies = [];

    const [result] = await probeModels({ ...connection(), models: [decide("mercury-decide")] });
    expect(result.ok).toBe(true);
    // The base URL carries a path (`/v1`); the decisions endpoint is not under it.
    expect(seen[0].url).toBe("/api/alpha/decisions");
    expect(JSON.parse(seen[0].body)).toEqual({
      model: "mercury-decide",
      state: { ping: true },
      questions: { ping: { type: "noul", instructions: "ping" } },
    });
  });

  it("an image model is called at /images/generations with a prompt", async () => {
    seen = [];
    replies = [];

    const [result] = await probeModels({ ...connection(), models: [image("dall-e-3")] });
    expect(result.ok).toBe(true);
    expect(seen[0].url).toBe("/v1/images/generations");
    expect(JSON.parse(seen[0].body)).toEqual({ model: "dall-e-3", prompt: "ping", n: 1 });
  });

  it("a speech model is called at /audio/speech with a voice", async () => {
    seen = [];
    replies = [];

    const [result] = await probeModels({ ...connection(), models: [speech("tts-1")] });
    expect(result.ok).toBe(true);
    expect(seen[0].url).toBe("/v1/audio/speech");
    expect(JSON.parse(seen[0].body)).toEqual({ model: "tts-1", input: "ping", voice: "alloy" });
  });

  it("a rerank model is called at /rerank with a query and documents", async () => {
    seen = [];
    replies = [];

    const [result] = await probeModels({ ...connection(), models: [rerank("rerank-english-v3")] });
    expect(result.ok).toBe(true);
    expect(seen[0].url).toBe("/v1/rerank");
    expect(JSON.parse(seen[0].body)).toEqual({ model: "rerank-english-v3", query: "ping", documents: ["ping"] });
  });

  it("a transcription model is sent a real audio file as multipart, not JSON", async () => {
    seen = [];
    replies = [];

    const [result] = await probeModels({ ...connection(), models: [transcribe("whisper-1")] });
    expect(result.ok).toBe(true);
    expect(seen[0].url).toBe("/v1/audio/transcriptions");
    expect(seen[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen[0].body).toContain('name="model"');
    expect(seen[0].body).toContain("whisper-1");
    expect(seen[0].body).toContain('filename="ping.wav"');
  });

  it("Audio and Video kinds are reported untestable, not called at a guessed endpoint", async () => {
    seen = [];
    replies = [];

    const results = await probeModels({ ...connection(), models: [kind("some-video-model", "Video"), kind("some-audio-model", "Audio")] });
    expect(seen).toHaveLength(0);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0].detail).toMatch(/no wire format/i);
    expect(results[1].detail).toMatch(/no wire format/i);
  });

  it("a connection with no credential sends no authorization header", async () => {
    seen = [];
    replies = [];

    await probeModels({ ...connection(), authType: "None", secret: null, models: [chat("local-model")] });
    expect(seen[0].authorization).toBeUndefined();
  });

  it("a provider that cannot be reached is a failure with its reason, not a silent pass", async () => {
    const results = await probeModels({
      ...connection(),
      // Reserved by RFC 6761 to resolve nowhere.
      baseUrl: "https://nothing.listening.invalid/v1",
      models: [chat("gpt-5")],
    });
    expect(results[0].ok).toBe(false);
    expect(results[0].detail.length).toBeGreaterThan(0);
  });

  it("UC-59.1-03 says which connections the console cannot test at all", () => {
    expect(untestableReason("OpenAI", "ApiKey")).toBeNull();
    expect(untestableReason("Azure", "EntraId")).toMatch(/workload identity/);
    expect(untestableReason("VertexAI", "ApiKey")).toMatch(/OpenAI wire format/);
  });
});
