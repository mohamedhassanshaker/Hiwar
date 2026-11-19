"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Keeps a screen's filters in the URL so the server applies them.
 *
 * A list that fetches the newest N rows and then filters them in the browser answers the
 * wrong question: "which of the newest 200 entries match" rather than "the newest 200
 * entries that match". On the audit log and the service log that difference is the
 * difference between seeing an agent's history and concluding it has none
 * (`UC-73.1-02`, `UC-74.1-02`).
 *
 * Putting the filter in the query string also makes a filtered view shareable and
 * survivable across a reload, which is what an auditor comparing two periods needs.
 */
export type FilterQuery = {
  /** Replaces one filter. `all` and the empty string clear it. */
  set: (key: string, value: string) => void;
  /** Replaces several filters in one navigation, as `set` does each, and returns to the first page. */
  assign: (values: Record<string, string>) => void;
  /** Clears every filter on the screen. */
  clear: () => void;
  /** True while the server is answering, so a control can show it is busy. */
  pending: boolean;
};

/**
 * The current screen's filter controls. Each change replaces the URL in a transition, without
 * scrolling or adding a history entry, so the server components re-read with the new query.
 */
export function useFilterQuery(): FilterQuery {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const push = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [pathname, router],
  );

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      // `all` is how the chips spell "no filter", and an empty box means the same.
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
      // A changed filter starts again at its first page.
      if (key !== "page") next.delete("page");
      push(next);
    },
    [params, push],
  );

  const assign = useCallback(
    (values: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(values)) {
        if (!value || value === "all") next.delete(key);
        else next.set(key, value);
      }
      next.delete("page");
      push(next);
    },
    [params, push],
  );

  const clear = useCallback(() => push(new URLSearchParams()), [push]);

  return { set, assign, clear, pending };
}

/**
 * Opens one record of a server-paged list by putting its key in `?open=` (or closes it with
 * null), keeping the list's filters and page. It adds a history entry, so Back returns to the list.
 */
export function useOpenQuery(): (key: string | null) => void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (key: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (key) next.set("open", key);
      else next.delete("open");
      const query = next.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
}
