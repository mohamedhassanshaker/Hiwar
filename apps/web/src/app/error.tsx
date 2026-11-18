"use client";

import { ErrorScreen } from "@/components/shared/error-screen";

/** The last boundary before the browser's own: a layout that failed lands here. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen digest={error.digest} onRetry={reset} />;
}
