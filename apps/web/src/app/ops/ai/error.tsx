"use client";

import { ErrorScreen } from "@/components/shared/error-screen";

/** A refusal or failure on an AI capabilities screen replaces only the page; the portal stays. */
export default function AiError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen digest={error.digest} onRetry={reset} />;
}
