"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { loadThread, loadThreads, mentionablePeople, markThreadRead } from "@/features/comments/actions";
import type { CommentCard, CommentThread, Mentionable } from "@/features/comments/types";

/**
 * The comment layer's shared state (handoff v2 section 5).
 *
 * Four cards each carry a comment button, one popover is open at a time, and a reply that
 * mentions you raises a toast wherever you are on the page. All three read the same
 * threads, so they sit in one provider rather than each fetching for itself.
 */

type Comments = {
  threads: CommentThread[];
  people: Mentionable[];
  /** The card whose conversation is open, or `null`. */
  openCard: CommentCard | null;
  show: (card: CommentCard | null) => void;
  /** Re-read one card after writing to it, or every card after a live update. */
  refresh: (card?: CommentCard) => Promise<void>;
};

const CommentsContext = createContext<Comments | null>(null);

/**
 * Holds the dashboard's comment threads, the mentionable people (read once after hydration) and
 * the open card. Opening a card marks its thread read and re-reads it; a thread left with no
 * comments is dropped from the list.
 */
export function CommentsProvider({ initial, children }: { initial: CommentThread[]; children: ReactNode }) {
  const [threads, setThreads] = useState(initial);
  const [people, setPeople] = useState<Mentionable[]>([]);
  const [openCard, setOpenCard] = useState<CommentCard | null>(null);

  // The threads come with the page; the mention list is only needed once somebody writes,
  // so it is read after hydration rather than sent with every dashboard render.
  useEffect(() => {
    void mentionablePeople().then(setPeople, () => {
      // Without it the `@` list is empty and a comment is still a comment.
    });
  }, []);

  const refresh = useCallback(async (card?: CommentCard) => {
    if (card) {
      const fresh = await loadThread({ card });
      setThreads((before) => {
        const rest = before.filter((thread) => thread.card !== card);
        return fresh.comments.length > 0 ? [...rest, fresh] : rest;
      });
      return;
    }
    setThreads(await loadThreads());
  }, []);

  // Opening a conversation reads it, which is what clears the unread dot on its button.
  const show = useCallback(
    (card: CommentCard | null) => {
      setOpenCard(card);
      if (!card) return;
      void markThreadRead({ card }).then(() => refresh(card), () => undefined);
    },
    [refresh],
  );

  const value = useMemo(() => ({ threads, people, openCard, show, refresh }), [threads, people, openCard, show, refresh]);
  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}

/** The comment layer's shared state; throws outside `CommentsProvider`. */
export function useComments(): Comments {
  const context = useContext(CommentsContext);
  if (!context) throw new Error("useComments must be used inside CommentsProvider");
  return context;
}

/** One card's thread, or an empty one when nobody has written on it yet. */
export function useThread(card: CommentCard): CommentThread {
  const { threads } = useComments();
  return (
    threads.find((thread) => thread.card === card) ?? {
      card,
      comments: [],
      unread: false,
      unreadCount: 0,
      lastMessageAt: null,
    }
  );
}
