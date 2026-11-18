import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two public-ish routes that used to answer 500/503 for input that is the sender's mistake:
 * a comment id that is not a uuid (`GET /api/comments/capture`) and a request-widget body that
 * is valid JSON but not an object, plus an anonymous widget preview, which answered 503 because
 * the permission check redirected to the sign-in page. None needs a database: the services are
 * replaced, and the assertions are that the refusal happens before they are reached.
 */

process.env.DATABASE_URL ??= "postgresql://awp:awp@127.0.0.1:5432/awp";

const readCapture = vi.fn();
const createFromIntakeWidget = vi.fn();
const getSession = vi.fn();
const requirePermission = vi.fn();
const startSession = vi.fn();

vi.mock("@/features/comments/service", () => ({ readCapture }));
vi.mock("@/lib/objects", () => ({ getObject: vi.fn() }));
vi.mock("@/features/requests/service", () => ({ createFromIntakeWidget, intakeProfile: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getSession,
  requirePermission,
  NotPermitted: class NotPermitted extends Error {},
}));
vi.mock("@/features/engage/widget-session", () => ({
  startSession,
  logRefusal: vi.fn(),
  verifySession: vi.fn(),
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

beforeEach(() => {
  readCapture.mockReset();
  createFromIntakeWidget.mockReset();
  getSession.mockReset();
  requirePermission.mockReset();
  startSession.mockReset();
});

describe("GET /api/comments/capture", () => {
  it("answers 400 and reads nothing when the comment is not an id", async () => {
    const { GET } = await import("@/app/api/comments/capture/route");
    const response = await GET(new Request("http://web.awp-app.svc:3000/api/comments/capture?comment=not-an-id"));
    expect(response.status).toBe(400);
    expect(readCapture).not.toHaveBeenCalled();
  });

  it("answers 404 for an id that has no capture", async () => {
    readCapture.mockResolvedValue(null);
    const { GET } = await import("@/app/api/comments/capture/route");
    const id = "00000000-0000-4000-8000-000000000000";
    const response = await GET(new Request(`http://web.awp-app.svc:3000/api/comments/capture?comment=${id}`));
    expect(response.status).toBe(404);
    expect(readCapture).toHaveBeenCalledWith(id);
  });
});

describe("POST /api/request-widget/[requestTypeCode]", () => {
  const context = { params: Promise.resolve({ requestTypeCode: "x" }) };
  const post = async (body: string) => {
    const { POST } = await import("@/app/api/request-widget/[requestTypeCode]/route");
    return POST(
      new Request("http://web.awp-app.svc:3000/api/request-widget/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      context,
    );
  };

  it.each(["null", "[]", "42", '"text"', "{not json"])("answers 400 'not JSON' for the body %s", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ reason: "The body is not JSON." });
    expect(createFromIntakeWidget).not.toHaveBeenCalled();
  });

  it("still asks for the required fields when the body is an empty object", async () => {
    const response = await post("{}");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ reason: "A name, a valid email and a summary are required." });
  });
});

describe("POST /embed/v1/sessions with preview", () => {
  const start = async () => {
    const { POST } = await import("@/app/embed/v1/sessions/route");
    return POST(
      new Request("http://web.awp-app.svc:3000/embed/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deployment: "any", preview: true }),
      }),
    );
  };

  it("answers 403 ORIGIN_NOT_ALLOWED to an anonymous caller instead of redirecting to sign-in", async () => {
    getSession.mockResolvedValue(null);
    const response = await start();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(requirePermission).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("starts the preview under the signed-in designer's own id", async () => {
    getSession.mockResolvedValue({ personId: "p-1" });
    requirePermission.mockResolvedValue({ personId: "p-1" });
    startSession.mockResolvedValue({ ok: true });
    const response = await start();
    expect(response.status).toBe(201);
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ previewBy: "p-1" }));
  });
});
