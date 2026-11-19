"use client";

import { type Run } from "@/features/agents/types";
import { runStatus, runWaitingOn } from "@/i18n/vocabulary";
import { Tg } from "@/components/ui/tag";
import { useAwp } from "@/hooks/use-awp";

/**
 * A run's status, and for a waiting one what it is actually waiting on.
 *
 * `Waiting` is set both for an approval and for a question put to a person, so the tag
 * reads the run's own `waitingOn` rather than asserting "approval" off the status —
 * which is what left an answer-blocked run looking like an approval nobody could find.
 */
export function RunTag({ s, waitingOn }: { s: string; waitingOn?: Run["waitingOn"] }) {
  const { t } = useAwp();
  const [tone, en, ar] = runStatus[s] ?? ["neutral", s, s];
  const waiting = waitingOn ? runWaitingOn[waitingOn] : undefined;
  return <Tg tone={tone} dot label={waiting ? t(waiting[0], waiting[1]) : t(en, ar)} />;
}
