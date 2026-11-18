import { answer, sessionOf } from "@/features/engage/widget-http";
import { resendOtp } from "@/features/engage/widget-session";

/** `POST /embed/v1/sessions/{id}/otp/send`: a new code for the current verify step. */

export const instant = false;

/** Issues a new code while a verify step waits, refused after 3 resends; answers with the view. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => resendOtp(await sessionOf(request, id)));
}
