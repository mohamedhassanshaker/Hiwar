import { env } from "@/server/env";

/**
 * A mock customer page with the install snippet, for verifying an origin and trying the widget on a
 * developer machine. Served only where ALLOW_PRIVATE_EGRESS is set, which marks a deployment whose
 * customer page is served by the platform itself (development server, local kind cluster).
 */
export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
  if (process.env.ALLOW_PRIVATE_EGRESS !== "1") return new Response("Not found", { status: 404 });
  const { key } = await params;
  const safe = key.replace(/[^a-zA-Z0-9_]/g, "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gulf Bites</title>
<style>body{font-family:system-ui;margin:0;background:#fff}header{padding:16px 32px;border-bottom:1px solid #eee;font-weight:700}main{padding:48px 32px;max-width:720px}</style></head>
<body><header>Gulf Bites</header><main><h1>Fresh Levantine food, delivered across the UAE.</h1><p>Order online in minutes, or ask our assistant about the menu, allergens and delivery.</p></main>
<script src="${env().APP_URL}/widget.js" data-deployment="${safe}" async></script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
