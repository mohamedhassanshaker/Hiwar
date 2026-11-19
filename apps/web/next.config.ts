import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The image copies `.next/standalone`, so it carries only the files the server needs.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Knowledge files of up to 25 MB arrive through route handlers, not server actions.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  serverExternalPackages: ["pg"],
  // The dev indicator would sit over the widget launcher inside its small frame.
  devIndicators: false,
  // The repository root also has a lockfile (Playwright); the app is this folder.
  turbopack: { root: path.join(import.meta.dirname, "../..") },
};

export default nextConfig;
