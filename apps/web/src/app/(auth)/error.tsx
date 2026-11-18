"use client";

import { ErrorScreen } from "@/components/shared/error-screen";

/** `COM-06` on the screens before sign-in, which render outside the shell. */
export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen digest={error.digest} onRetry={reset} />;
}
