import { z } from "zod";

import { answer, bodyOf } from "@/features/engage/widget-http";
import { startSession, WidgetRefused } from "@/features/engage/widget-session";
import { getSession, NotPermitted, requirePermission } from "@/lib/session";

/**
 * `POST /embed/v1/sessions` (widget specification 14): start a session, or pick the
 * visitor's earlier one back up. `preview` is a designer in the console, signed in.
 */

export const instant = false;

const startInput = z.object({
  deployment: z.string().trim().min(1).max(64),
  lang: z.enum(["en", "ar"]).default("en"),
  context: z.object({ page: z.string().trim().max(64).optional() }).partial().default({}),
  /** The host page's origin, which must be one the deployment allows. */
  host: z.string().trim().max(512).nullable().default(null),
  visitorKey: z.string().trim().max(128).nullable().default(null),
  preview: z.boolean().default(false),
});

/** A preview is for a designer; anyone else, signed in or not, is refused the same way. */
function notADesigner(): WidgetRefused {
  return new WidgetRefused("ORIGIN_NOT_ALLOWED", "Only a designer may preview the assistant.", "لا يعاين المساعد إلا المصمم.", 403);
}

/**
 * The id of the signed-in person who may preview. An anonymous caller is checked first because
 * `requirePermission` would redirect it to the sign-in page, which a protocol route cannot
 * follow and which surfaced as a 503.
 */
async function previewDesigner(): Promise<string> {
  if (!(await getSession())) throw notADesigner();
  try {
    return (await requirePermission("channels:write")).personId;
  } catch (problem) {
    if (problem instanceof NotPermitted) throw notADesigner();
    throw problem;
  }
}

/**
 * Starts or resumes a session and answers 201 with its view and token. 400 for a body that does
 * not parse; a `preview` session needs a signed-in person holding `channels:write` and is refused
 * 403 otherwise. The deployment and host origin are checked by `startSession`.
 */
export async function POST(request: Request) {
  return answer(async () => {
    const parsed = startInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("BAD_REQUEST", "The request could not be read.", "تعذّرت قراءة الطلب.", 400);
    const previewBy = parsed.data.preview ? await previewDesigner() : null;
    return startSession({
      deploymentCode: parsed.data.deployment,
      lang: parsed.data.lang,
      page: parsed.data.context.page ?? null,
      host: parsed.data.host,
      visitorKey: parsed.data.visitorKey,
      previewBy,
    });
  }, 201);
}
