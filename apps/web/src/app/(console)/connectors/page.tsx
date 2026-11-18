import { grantableCatalogue } from "@/features/agents/platform-catalogue";
import { Connectors } from "@/features/connectors/components/connectors";
import { oauthRedirectUrl } from "@/features/connectors/credential-auth";
import { loadConnectors } from "@/features/connectors/service";
import { PLATFORM_CONNECTOR_CODE } from "@/features/connectors/types";

/**
 * S-54: the MCP servers agents call tools through. The Platform connector's tools are the
 * platform's own catalogue, read from the code (D228).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; connect?: string; reason?: string }>;
}) {
  // D296: an OAuth Connect comes back here, on the connector it was for.
  const { open, connect, reason } = await searchParams;
  const { connectors } = await loadConnectors();
  const platformTools = grantableCatalogue().map((tool) => ({
    name: tool.name,
    tier: tool.tier ?? "",
    available: true,
    harness: tool.harness,
  }));
  return (
    <Connectors
      connectors={connectors.map((c) => (c.n === PLATFORM_CONNECTOR_CODE ? { ...c, tools: platformTools } : c))}
      oauthCallbackUrl={oauthRedirectUrl()}
      opened={open ? { code: open, connected: connect ? { ok: connect === "connected", reason } : undefined } : undefined}
    />
  );
}
