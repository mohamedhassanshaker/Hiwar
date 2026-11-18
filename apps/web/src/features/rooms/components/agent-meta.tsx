"use client";

import { useState, useTransition } from "react";

import { Lnk } from "@/components/ui/button";
import { recordFeedback } from "@/features/rooms/actions";
import { orThrow } from "@/lib/outcome";
import { useAwp } from "@/hooks/use-awp";
import { useGo } from "@/lib/routes";

/** The line under an agent's message: the agent's version, its trace, and feedback. */
export function AgentMeta({
  messageId,
  ver,
  runKey,
  given,
}: {
  messageId: string;
  ver: string;
  runKey: string | null;
  given: string | null;
}) {
  const { t } = useAwp();
  const go = useGo();
  const [fb, setFb] = useState<string | null>(given);
  const [, start] = useTransition();

  /** `UC-23.1-05`: the choice toggles, is stored, and feeds the agent's evaluation. */
  const mark = (value: "Helpful" | "NotHelpful") =>
    start(async () => {
      const next = fb === value ? null : value;
      setFb(next);
      if (next) orThrow(await recordFeedback({ messageId, value: next }));
    });
  return (
    <div className="awp-row awp-small awp-muted" style={{ flexWrap: "wrap", gap: 10, marginTop: 8 }}>
      <span>{ver}</span>
      {runKey && <Lnk onClick={() => go("run", { id: runKey })}>{t("Open trace", "فتح التتبع")}</Lnk>}
      <span style={{ flex: 1 }} />
      <button className="awp-chip" style={{ height: 28 }} onClick={() => mark("Helpful")} aria-pressed={fb === "Helpful"}>{fb === "Helpful" ? t("Helpful ✓", "مفيد ✓") : t("Helpful", "مفيد")}</button>
      <button className="awp-chip" style={{ height: 28 }} onClick={() => mark("NotHelpful")} aria-pressed={fb === "NotHelpful"}>{fb === "NotHelpful" ? t("Not helpful ✓", "غير مفيد ✓") : t("Not helpful", "غير مفيد")}</button>
    </div>
  );
}
