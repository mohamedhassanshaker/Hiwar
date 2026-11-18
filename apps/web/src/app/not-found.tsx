import { NotFound } from "@/components/shared/error-screen";

/**
 * An address that belongs to no screen. Bilingual, with the way back to the dashboard.
 *
 * Rendered per request rather than prerendered: the root layout reads the nonce the proxy
 * minted for this response, and a page baked at build time would carry somebody else's.
 */
export const instant = false;

/** Renders the shared bilingual not-found screen. */
export default function Page() {
  return <NotFound />;
}
