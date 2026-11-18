import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /embed/v1/sessions/{id}/messages` (TC-WGT-040, widget specification 14): a message that is
 * too long is a refused value (`VALIDATION_FAILED`, "That message is too long.", decided by
 * `sendMessage`), not an unreadable request (`BAD_REQUEST`), so the route must hand the text on
 * instead of capping its length itself. No database: the session service is replaced.
 */

process.env.DATABASE_URL ??= "postgresql://awp:awp@127.0.0.1:5432/awp";

const sendMessage = vi.fn();

vi.mock("@/features/engage/widget-session", () => ({
  sendMessage,
  logRefusal: vi.fn(),
  verifySession: vi.fn().mockResolvedValue({ conversationId: "c1" }),
  WidgetRefused: class WidgetRefused extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly messageAr: string,
      readonly status: number,
      readonly retryAfter: number | null = null,
    ) {
      super(message);
    }
  },
}));

beforeEach(() => sendMessage.mockReset());

function post(body: unknown): Promise<Response> {
  return import("@/app/embed/v1/sessions/[id]/messages/route").then(({ POST }) =>
    POST(new Request("http://web.awp-app.svc:3000/embed/v1/sessions/c1/messages", { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: "c1" }),
    }),
  );
}

describe("POST /embed/v1/sessions/{id}/messages", () => {
  it("hands a text of 4001 characters to the service, whose rule answers VALIDATION_FAILED", async () => {
    sendMessage.mockResolvedValue({ ok: true });
    const text = "a".repeat(4001);
    const response = await post({ text });
    expect(response.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(expect.anything(), text, null);
  });

  it("still answers BAD_REQUEST, without calling the service, when text is not a string", async () => {
    const response = await post({ text: 42 });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BAD_REQUEST");
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
