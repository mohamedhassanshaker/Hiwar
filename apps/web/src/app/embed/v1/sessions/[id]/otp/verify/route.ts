import { z } from "zod";

import { answer, bodyOf, sessionOf } from "@/features/engage/widget-http";
import { verifyOtp, WidgetRefused } from "@/features/engage/widget-session";

/**
 * `POST /embed/v1/sessions/{id}/otp/verify`: the code goes from the OTP control to the
 * identity check directly, never through a model and never into the transcript.
 */

export const instant = false;

const codeInput = z.object({ code: z.string().trim().max(12) });

/** Checks the code against the current verify step; 400 for an unreadable code. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    const parsed = codeInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("OTP_INVALID", "Enter the 6-digit code.", "أدخل الرمز المكوّن من 6 أرقام.", 400);
    return verifyOtp(claims, parsed.data.code);
  });
}
