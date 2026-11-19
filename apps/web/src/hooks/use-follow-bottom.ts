import { useCallback, useEffect, useRef, type RefCallback } from "react";

/** How close to the end, in pixels, still counts as reading the end. */
const NEAR_END = 80;

/**
 * A scroll container that follows a conversation (D233, D288): it opens at its end, jumps
 * there whenever `jumpWhen` changes, and keeps up with text added at the end, a streamed
 * reply included, unless the reader has scrolled up to read something earlier.
 */
export function useFollowBottom<T extends HTMLElement>(jumpWhen: unknown): RefCallback<T> {
  const element = useRef<T | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const attach = useCallback((node: T | null) => {
    detach.current?.();
    detach.current = null;
    element.current = node;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    let atEnd = true;
    const onScroll = () => {
      atEnd = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_END;
    };
    const follow = new MutationObserver(() => {
      if (atEnd) node.scrollTop = node.scrollHeight;
    });
    node.addEventListener("scroll", onScroll);
    follow.observe(node, { childList: true, subtree: true, characterData: true });
    detach.current = () => {
      node.removeEventListener("scroll", onScroll);
      follow.disconnect();
    };
  }, []);

  useEffect(() => {
    const node = element.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [jumpWhen]);

  return attach;
}
