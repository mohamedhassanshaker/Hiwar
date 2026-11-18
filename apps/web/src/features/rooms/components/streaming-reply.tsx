"use client";

import { TurnParts } from "@/features/assistant/components/assistant-activity";
import { useRunParts } from "@/features/assistant/components/use-run-parts";
import { useAwp } from "@/hooks/use-awp";

/** A question is the room's own card, as in the panel (D252), so the stream's `ask_person` call is not drawn here. */
const DRAWN_ELSEWHERE = ["ask_person"] as const;

/**
 * An agent's reply in a room while it is still being written (D161, D352).
 *
 * Reads the run's AG-UI stream from its start and draws it as the assistant panel does: the
 * text as it arrives and each tool call as a step, Running until its result comes back. Each
 * model turn of the mission starts a new paragraph. The finished reply replaces this once the
 * run has posted it to the room.
 */
export function StreamingReply({ runId, agentName }: { runId: string; agentName: string }) {
  const { t } = useAwp();
  const parts = useRunParts(runId, DRAWN_ELSEWHERE);

  return parts.length ? (
    <TurnParts parts={parts} t={t} />
  ) : (
    <p className="awp-muted" style={{ margin: 0, fontStyle: "italic" }}>
      {t(`${agentName} is working…`, `${agentName} يعمل…`)}
    </p>
  );
}
