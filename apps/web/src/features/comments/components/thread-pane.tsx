"use client";

import { useEffect, useState } from "react";

import { Tg } from "@/components/ui/tag";
import { postComment } from "@/features/comments/actions";
import { CARD_LABEL, type CommentCard } from "@/features/comments/types";
import { useAwp } from "@/hooks/use-awp";
import { useComments, useThread } from "./comment-store";
import { Composer, mentionsIn } from "./composer";
import { Conversation } from "./conversation";

/**
 * A quick-request thread in the Inbox (handoff v2 section 6).
 *
 * The same conversation the dashboard popover shows, in the pane beside the Inbox list,
 * so a comment that was raised on a card can be answered from the place a person works
 * through everything else that is waiting for them.
 */
export function ThreadPane({ card, mayRaiseTasks }: { card: CommentCard; mayRaiseTasks: boolean }) {
  const { t } = useAwp();
  const { people, refresh, show } = useComments();
  const thread = useThread(card);
  const [problem, setProblem] = useState<string | null>(null);

  // Opening the thread here reads it, exactly as opening it on the dashboard does.
  useEffect(() => {
    show(card);
    // `show` also opens the popover, which is not wanted here; closing it leaves the
    // read it performed, which is the half this pane needs.
    show(null);
  }, [card, show]);

  const send = async (text: string) => {
    setProblem(null);
    try {
      await postComment({ card, body: text, mentions: mentionsIn(text, people).map((person) => person.id) });
      await refresh(card);
    } catch {
      setProblem(t("The reply was not sent.", "لم يُرسل الرد."));
    }
  };

  return (
    <div className="qr-pane">
      <div className="awp-row" style={{ flexWrap: "wrap" }}>
        <Tg tone="brand" size="md" label={t("Quick request", "طلب سريع")} />
      </div>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{t(...(CARD_LABEL[card] ?? [card, card]))}</h2>
      <Conversation thread={thread} people={people} mayRaiseTasks={mayRaiseTasks} onChanged={() => void refresh(card)} />
      {problem && (
        <p className="awp-small" role="alert" style={{ margin: 0, color: "var(--text-danger)" }}>
          {problem}
        </p>
      )}
      <Composer inbox people={people} onSend={(text) => void send(text)} />
    </div>
  );
}
