import { type WidgetError } from "./protocol";
import { logRefusal, verifySession, WidgetRefused, type SessionClaims } from "./widget-session";

/**
 * The `/embed/v1` routes' shared edges (widget specification section 14, D231): the session
 * token from the request, JSON in and out, and every refusal in the protocol's error shape.
 *
 * The routes are called by the widget's frame, which is served from the platform's own
 * origin, so there is no cross-origin call to allow; the host page reaches the frame only
 * through `postMessage`.
 */

const NO_STORE = { "cache-control": "no-store" };

/** A JSON response that no cache keeps. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** A refusal as the widget reads it. Anything unexpected is logged and said plainly. */
export function refusal(problem: unknown): Response {
  if (problem instanceof WidgetRefused) {
    const body: WidgetError = { error: { code: problem.code, message: problem.message, messageAr: problem.messageAr, retryAfter: problem.retryAfter } };
    const headers: Record<string, string> = { ...NO_STORE };
    if (problem.retryAfter) headers["retry-after"] = String(problem.retryAfter);
    return Response.json(body, { status: problem.status, headers });
  }
  logRefusal(problem);
  const body: WidgetError = {
    error: { code: "TOOL_UNAVAILABLE", message: "The assistant is not responding. Please try again.", messageAr: "المساعد لا يستجيب. حاول مرة أخرى.", retryAfter: null },
  };
  return Response.json(body, { status: 503, headers: NO_STORE });
}

/** The session the request presents: `Authorization: Bearer`, or `?token=` for the stream. */
export async function sessionOf(request: Request, conversationId: string): Promise<SessionClaims> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : new URL(request.url).searchParams.get("token");
  return verifySession(token, conversationId);
}

/** The JSON body, or a refusal saying it could not be read. */
export async function bodyOf<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new WidgetRefused("BAD_REQUEST", "The request could not be read.", "تعذّرت قراءة الطلب.", 400);
  }
}

/** Runs one route's work and answers in the protocol's terms. */
export async function answer(work: () => Promise<unknown>, status = 200): Promise<Response> {
  try {
    const result = await work();
    return result instanceof Response ? result : json(result, status);
  } catch (problem) {
    return refusal(problem);
  }
}
