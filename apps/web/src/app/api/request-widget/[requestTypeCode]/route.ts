import { createFromIntakeWidget, intakeProfile } from "@/features/requests/service";
import { logServerError } from "@/lib/logger";
import { Rejected } from "@/lib/rejection";

/**
 * The intake form an external site embeds for one request type (`UC-30.1-04`).
 *
 * A stranger reaches this without a console session, so it answers only for a request
 * type whose published version lists `Widget` as an intake channel and names a project to
 * raise into. Everything it accepts is checked by `requests` itself: the route neither
 * decides what a request type is nor what a valid submission looks like.
 *
 * The form lives on someone else's page, so the responses are open to any origin — the
 * published request type and its field labels are what a person fills in, and nothing
 * here reads or returns anything else.
 */

export const instant = false;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

/** CORS preflight: any origin may GET and POST with a JSON body. */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

/** The fields the form draws, which the embedded script asks for before it renders. */
export async function GET(_request: Request, context: { params: Promise<{ requestTypeCode: string }> }): Promise<Response> {
  const { requestTypeCode } = await context.params;
  const profile = await intakeProfile(requestTypeCode);
  if (!profile) return Response.json({ reason: "No such form." }, { status: 404, headers: CORS });
  return Response.json(
    {
      code: profile.code,
      nameEn: profile.nameEn,
      nameAr: profile.nameAr,
      fields: profile.attributes.map((attribute) => ({
        key: attribute.key,
        labelEn: attribute.labelEn,
        labelAr: attribute.labelAr,
        dataType: attribute.dataType,
        required: attribute.required,
        enumValues: attribute.enumValues,
      })),
    },
    { headers: { ...CORS, "cache-control": "no-store" } },
  );
}

type Submission = {
  name?: unknown;
  email?: unknown;
  summary?: unknown;
  attributes?: unknown;
};

/** An email good enough to key an external contact by and to answer on. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Raises a request from a website submission. The name, email and summary are trimmed and
 * capped, and each attribute key and value is cut to 60 and 2000 characters before
 * `createFromIntakeWidget` validates them. 400 for a body that is not JSON, a missing field or a
 * domain refusal; 503 for any other failure, logged.
 */
export async function POST(request: Request, context: { params: Promise<{ requestTypeCode: string }> }): Promise<Response> {
  const { requestTypeCode } = await context.params;

  let body: Submission;
  try {
    const parsed: unknown = await request.json();
    // `null`, a number or an array parses as JSON but has no fields to read; reading one would
    // throw below and answer 500 for what is the sender's mistake.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError("not an object");
    body = parsed as Submission;
  } catch {
    return Response.json({ reason: "The body is not JSON." }, { status: 400, headers: CORS });
  }

  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const summary = String(body.summary ?? "").trim().slice(0, 2000);
  if (!name || !EMAIL.test(email) || !summary) {
    return Response.json({ reason: "A name, a valid email and a summary are required." }, { status: 400, headers: CORS });
  }

  const attributes: Record<string, string> = {};
  const supplied = body.attributes;
  if (typeof supplied === "object" && supplied !== null && !Array.isArray(supplied)) {
    for (const [key, value] of Object.entries(supplied as Record<string, unknown>)) {
      attributes[key.slice(0, 60)] = String(value ?? "").slice(0, 2000);
    }
  }

  try {
    const key = await createFromIntakeWidget({ requestTypeCode, contactName: name, contactEmail: email, summary, attributes });
    return Response.json({ key }, { headers: CORS });
  } catch (problem) {
    // A refusal is the answer the form should show; anything else is this platform's own
    // failure and says nothing about what was submitted.
    if (problem instanceof Rejected) {
      return Response.json({ reason: problem.message }, { status: 400, headers: CORS });
    }
    logServerError("/api/request-widget", problem, { requestTypeCode });
    return Response.json({ reason: "The request could not be raised." }, { status: 503, headers: CORS });
  }
}
