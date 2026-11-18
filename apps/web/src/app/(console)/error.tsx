"use client";

import { ErrorScreen } from "@/components/shared/error-screen";

/**
 * `COM-06`, `COM-07` and `COM-10` inside the console shell: the sidebar and top bar stay,
 * and only the page slot is replaced. The error object is Next.js's sanitised one — the
 * digest is all that distinguishes a refusal from a stale write — and none of it is shown.
 */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen digest={error.digest} onRetry={reset} />;
}
