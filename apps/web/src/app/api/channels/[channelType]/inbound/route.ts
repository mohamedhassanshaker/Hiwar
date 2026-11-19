import { channelWebhook, handleInbound, signatureMatches } from "@/features/engage/gateway";
import { logger } from "@/lib/logger";

/**
 * A channel's inbound webhook (S-61).
 *
 * The provider posts here. GET is the reachability check the Test channel screen runs, and
 * says only whether the channel exists — it is a public URL, so it carries no configuration.
 * POST is verified against the channel's inbound secret before anything is read from it.
 */

export const instant = false;

/** Public reachability check: whether the channel exists and is enabled, 404 when it does not. */
export async function GET(_request: Request, context: { params: Promise<{ channelType: string }> }): Promise<Response> {
  const { channelType } = await context.params;
  const channel = await channelWebhook(channelType);
  if (!channel) return Response.json({ reason: "No such channel." }, { status: 404 });
  return Response.json({ channel: channelType, enabled: channel.isEnabled });
}

/**
 * Takes one inbound message from the provider. Refused 401 when the channel has no inbound secret
 * or `x-awp-signature` does not match the raw body, 400 when the body is not JSON or lacks `from`
 * or `text`; otherwise answers with what `handleInbound` decided for the message.
 */
export async function POST(request: Request, context: { params: Promise<{ channelType: string }> }): Promise<Response> {
  const { channelType } = await context.params;
  const channel = await channelWebhook(channelType);
  if (!channel) return Response.json({ reason: "No such channel." }, { status: 404 });

  const raw = await request.text();
  // A channel with no inbound secret accepts nothing: an unverified webhook would let
  // anyone put words in a visitor's mouth.
  if (!channel.inboundSecret) {
    return Response.json({ reason: "This channel has no inbound secret configured." }, { status: 401 });
  }
  if (!signatureMatches(channel.inboundSecret, raw, request.headers.get("x-awp-signature"))) {
    logger().warn({ channelType }, "an inbound webhook arrived with no valid signature");
    return Response.json({ reason: "The signature does not match." }, { status: 401 });
  }

  let body: { from?: string; name?: string; text?: string; conversation?: string };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ reason: "The body is not JSON." }, { status: 400 });
  }
  if (!body.from || !body.text) return Response.json({ reason: "A message needs a sender and text." }, { status: 400 });

  const outcome = await handleInbound({
    channelType,
    senderKey: body.from,
    senderName: body.name ?? body.from,
    text: body.text,
    externalRef: body.conversation ?? null,
  });
  return Response.json(outcome);
}
