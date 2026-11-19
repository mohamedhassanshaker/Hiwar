import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./hiwar.css";
import "./board.css";
import "./app.css";

export const metadata: Metadata = {
  title: { default: "Hiwar", template: "%s · Hiwar" },
  description: "AI agents on your website, with your team one click away.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* App Router root layout: this stylesheet loads on every page, which is what the rule wants. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap"
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
