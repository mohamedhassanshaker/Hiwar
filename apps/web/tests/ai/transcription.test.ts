import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptionFailed, transcribeAudio } from "@/lib/transcription";

/**
 * D386: what the console sends a provider's `/audio/transcriptions`, and what it makes of the
 * answer. Against a real HTTP server, as `model-probe.test.ts` does, because what matters is
 * the multipart request actually sent.
 */

delete process.env.EGRESS_PROXY_URL;
process.env.DATABASE_URL ??= "postgresql://unused@localhost:5432/unused";

const repository = vi.hoisted(() => ({ readTranscriptionModels: vi.fn() }));
vi.mock("@/features/models/repository", () => repository);

type Seen = { authorization?: string; body: string; url?: string; contentType?: string };

let server: Server;
let base = "";
let seen: Seen[] = [];
let replies: { status: number; body: string }[] = [];

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push({ authorization: request.headers.authorization, body, url: request.url, contentType: request.headers["content-type"] });
      const reply = replies.shift() ?? { status: 200, body: JSON.stringify({ text: "" }) };
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  seen = [];
  replies = [];
  repository.readTranscriptionModels.mockReset();
});

const audio = new Uint8Array([26, 69, 223, 163, 1, 2, 3]);

describe("transcribeAudio", () => {
  it("should_send_the_model_language_and_recording_as_multipart_and_return_the_text", async () => {
    replies.push({ status: 200, body: JSON.stringify({ text: "  أريد تجديد الرخصة  " }) });

    const text = await transcribeAudio({ baseUrl: `${base}/`, authType: "ApiKey", secret: "sk-test", model: "whisper-1", audio, mimeType: "audio/webm", language: "ar" });

    expect(text).toBe("أريد تجديد الرخصة");
    expect(seen[0].url).toBe("/v1/audio/transcriptions");
    expect(seen[0].authorization).toBe("Bearer sk-test");
    expect(seen[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen[0].body).toContain('name="model"\r\n\r\nwhisper-1');
    expect(seen[0].body).toContain('name="language"\r\n\r\nar');
    expect(seen[0].body).toContain('filename="speech.webm"');
  });

  it("should_fail_with_the_provider_status_when_the_credential_is_refused", async () => {
    replies.push({ status: 401, body: JSON.stringify({ error: "bad key" }) });

    const call = transcribeAudio({ baseUrl: base, authType: "ApiKey", secret: "wrong", model: "whisper-1", audio, mimeType: "audio/mp4", language: "en" });

    await expect(call).rejects.toBeInstanceOf(TranscriptionFailed);
    await expect(call).rejects.toMatchObject({ status: 401 });
  });

  it("should_fail_when_the_answer_carries_no_transcript", async () => {
    replies.push({ status: 200, body: "<html>proxy page</html>" });

    await expect(transcribeAudio({ baseUrl: base, authType: "None", secret: null, model: "m", audio, mimeType: "audio/ogg", language: "en" })).rejects.toThrow("without a transcript");
  });
});

describe("transcribe (the service)", () => {
  const callable = { provider: "Custom", baseUrl: "", authType: "BearerToken", secret: "token", model: "whisper-large-v3" };

  it("should_refuse_audio_of_another_type_or_empty_or_too_large_before_choosing_a_model", async () => {
    const { transcribe } = await import("@/features/models/transcription-service");

    await expect(transcribe({ audio, contentType: "video/mp4", language: "en" })).rejects.toMatchObject({ status: 400 });
    await expect(transcribe({ audio: new Uint8Array(), contentType: "audio/webm", language: "en" })).rejects.toMatchObject({ status: 400 });
    await expect(transcribe({ audio: new Uint8Array(5 * 1024 * 1024 + 1), contentType: "audio/webm", language: "en" })).rejects.toMatchObject({ status: 400 });
    expect(repository.readTranscriptionModels).not.toHaveBeenCalled();
  });

  it("should_say_voice_input_is_not_set_up_when_no_callable_transcription_model_exists", async () => {
    const { transcribe } = await import("@/features/models/transcription-service");
    // A workload identity and a provider without the OpenAI wire format are both skipped.
    repository.readTranscriptionModels.mockResolvedValue([
      { ...callable, provider: "Azure", authType: "EntraId" },
      { ...callable, provider: "Bedrock", authType: "IamRole" },
    ]);

    await expect(transcribe({ audio, contentType: "audio/webm;codecs=opus", language: "en" })).rejects.toMatchObject({ status: 503, message: expect.stringContaining("not set up") });
    expect(seen).toHaveLength(0);
  });

  it("should_use_the_first_model_the_console_can_call", async () => {
    const { transcribe } = await import("@/features/models/transcription-service");
    repository.readTranscriptionModels.mockResolvedValue([{ ...callable, provider: "Azure", authType: "EntraId", model: "skipped" }, { ...callable, baseUrl: base }]);
    replies.push({ status: 200, body: JSON.stringify({ text: "renew my permit" }) });

    expect(await transcribe({ audio, contentType: "audio/webm;codecs=opus", language: "en" })).toBe("renew my permit");
    expect(seen[0].body).toContain('name="model"\r\n\r\nwhisper-large-v3');
  });

  it("should_refuse_in_both_languages_when_the_provider_fails", async () => {
    const { transcribe } = await import("@/features/models/transcription-service");
    repository.readTranscriptionModels.mockResolvedValue([{ ...callable, baseUrl: base }]);
    replies.push({ status: 500, body: "boom" });

    await expect(transcribe({ audio, contentType: "audio/webm", language: "ar" })).rejects.toMatchObject({ status: 503, messageAr: expect.stringContaining("تعذّر") });
  });
});
