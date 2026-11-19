import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "@/components/brand";
import { getSession } from "@/server/session";

/** The public site header and footer (WEB-001 FR-015). */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const signedIn = Boolean(session?.org);
  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid #dfe2f0" }}>
        <div className="wrap row between" style={{ height: 68 }}>
          <div className="row gap-24">
            <Brand href="/" />
            <nav aria-label="Main" className="row gap-16 sm">
              <Link href="/">Home</Link>
              <Link href="/pricing">Pricing</Link>
            </nav>
          </div>
          <div className="row gap-8">
            {signedIn ? (
              <Link className="btn" href="/conversations">Control panel</Link>
            ) : (
              <>
                <Link className="btn ghost" href="/sign-in">Sign in</Link>
                <Link className="btn" href="/sign-up">Start free</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer style={{ borderTop: "1px solid #dfe2f0", marginTop: 72 }}>
        <div className="wrap row between" style={{ padding: "28px 24px" }}>
          <div className="col gap-4">
            <b>Hiwar</b>
            <span className="sm muted">AI assistants for your website, with your team one click away.</span>
          </div>
          <nav aria-label="Footer" className="row gap-16 sm">
            <Link href="/pricing">Pricing</Link>
            <Link href="/conversations">Control panel</Link>
            <Link href="/brand">Brand</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
