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
