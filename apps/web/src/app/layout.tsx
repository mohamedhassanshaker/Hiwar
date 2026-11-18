import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

// The design system's own stylesheets, as `vendor/tahseel-ds/styles.css` lists them, without
// its first line: an @import of Google Fonts the console's CSP refuses (D153), for families
// the console's `--font` token overrides anyway. `tests/design-system.test.ts` holds the two
// lists together.
import "../../vendor/tahseel-ds/tokens/fonts.css";
import "../../vendor/tahseel-ds/components/fig-tokens.css";
import "../../vendor/tahseel-ds/tokens/colors.css";
import "../../vendor/tahseel-ds/components/fig-assets.css";
import "../../vendor/tahseel-ds/tokens/fig-typography.css";
import "../../vendor/tahseel-ds/assets/logo.css";
import "../../vendor/tahseel-ds/assets/payment-channels/channels.css";
import "../../vendor/tahseel-ds/assets/rating/rating.css";
import "../../vendor/tahseel-ds/assets/keypad/keypad.css";
import "../../vendor/tahseel-ds/tokens/rtl.css";
import "./globals.css";
import "./dash3.css";
import "./console.css";

import { faviconUrl } from "@/features/governance/service";
import { Providers } from "./providers";

/** `UC-75.2-01`: an uploaded favicon replaces the design system's own, in every tab. */
export async function generateMetadata(): Promise<Metadata> {
  const favicon = await faviconUrl();
  return {
    title: "Juman Console",
    description: "Juman, the Tahseel Agentic Work Platform console",
    icons: favicon ? { icon: favicon } : undefined,
  };
}

/**
 * Re-applies the stored theme and language to <html> before the first paint. The React
 * tree hydrates with the defaults, so the document stays hidden until the providers have
 * applied the stored values; that avoids both a flash of the other state and a mismatch.
 */
const BOOT = `(function(){try{var d=document.documentElement;var th=localStorage.getItem('awp.theme')==='dark'?'dark':'light';var lg=localStorage.getItem('awp.lang')==='ar'?'ar':'en';d.dataset.theme=th;d.lang=lg;d.dir=lg==='ar'?'rtl':'ltr';if(th!=='light'||lg!=='en')d.style.visibility='hidden';}catch(e){}})();`;

/**
 * The document every page renders in: light English defaults on <html>, the boot script with
 * this request's CSP nonce, and the app's providers around the page.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // The nonce the proxy minted for this request: without it the boot script is blocked by
  // the policy the same proxy set.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" dir="ltr" data-theme="light" suppressHydrationWarning>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: BOOT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
