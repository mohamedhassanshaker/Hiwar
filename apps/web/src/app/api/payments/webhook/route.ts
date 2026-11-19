import { NextResponse } from "next/server";

import { handle } from "@/server/api";
import { handleWebhook } from "@/server/payments";

/** Stripe's signed webhook: payment success and failure for invoices (BIL-001 FR-021). */
export const POST = handle(async (request: Request) => {
  const type = await handleWebhook(await request.text(), request.headers.get("stripe-signature"));
  return NextResponse.json({ received: type });
});
