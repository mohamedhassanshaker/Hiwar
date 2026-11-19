"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { hrefOf, NAV_OF, ROUTES, screenOfPath, type Go, type GoParams, type ScreenId, type ScreenParams } from "./route-table";

export { hrefOf, NAV_OF, ROUTES, screenOfPath };
export type { Go, GoParams, ScreenId, ScreenParams };

/** Keeps the prototype's `go(screen, params)` call signature. */
export function useGo(): Go {
  const router = useRouter();
  return useCallback<Go>((screen, params) => router.push(hrefOf(screen, params)), [router]);
}

/**
 * One step back in the history, so the screen left is reopened as it was left: a list keeps its filters in its
 * address (`useFilterQuery`), and the history entry holds that address. With no earlier entry to return to,
 * a deep link opened in a new tab, it opens `fallback` instead of leaving the console.
 */
export function useBack(fallback: ScreenId): () => void {
  const router = useRouter();
  return useCallback(() => (window.history.length > 1 ? router.back() : router.push(hrefOf(fallback))), [router, fallback]);
}

/** The prototype's `p` bag, read from the query string. */
export function useScreenParams(): ScreenParams {
  const search = useSearchParams();
  return useMemo(() => Object.fromEntries(search.entries()), [search]);
}
