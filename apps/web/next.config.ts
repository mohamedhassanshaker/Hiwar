import path from "node:path";

import type { NextConfig } from "next";

/** What the largest upload (25 MB as a data URL) needs, for the action and for the proxy that buffers its body. */
const UPLOAD_BODY_LIMIT = "34mb";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The image copies `.next/standalone`, so it carries only the files the server needs.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  experimental: {
    // An upload reaches its server action as a data URL: the 25 MB of `MAX_UPLOAD_BYTES`
    // in base64, with room for the rest of the call. The default is 1 MB.
    serverActions: { bodySizeLimit: UPLOAD_BODY_LIMIT },
    // `proxy.ts` runs on every request, and Next.js buffers the body for it up to this size
    // (10 MB by default) and hands the action only that much, so a body above it, such as a
    // 12 MB upload, failed with a 500 although the action allows it.
    proxyClientMaxBodySize: UPLOAD_BODY_LIMIT,
    // The image's root filesystem is read-only, so the prerender cache stays in memory instead
    // of `.next/server/route-cache`, where every write failed.
    isrFlushToDisk: false,
  },
  turbopack: {
    // The handoff ships the design system's payment, rating, keypad and Figma bitmap
    // stylesheets without their image files; the prototype 404s on them too. The folder
    // is vendored unmodified, so the unresolved url() references are ignored here.
    ignoreIssue: [{ path: /vendor[\/\\]tahseel-ds/ }],
  },
};

export default nextConfig;
