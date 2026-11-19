"use client";

import { useAwp } from "@/hooks/use-awp";
import { agentStatus, stAr, stTone } from "@/i18n/vocabulary";
import { Tg } from "@/components/ui/tag";

/** `tr()` in the prototype: the shared status vocabulary. */
export function useTr(): (k: string) => string {
  const { t } = useAwp();
  return (k) => t(k, stAr[k] || k);
}

/** A status as a tag, in the shared vocabulary's tone and label; an unknown status is neutral. */
export function StTag({ s, dot = true }: { s: string; dot?: boolean }) {
  const tr = useTr();
  return <Tg tone={stTone[s] || "neutral"} dot={dot} label={tr(s)} />;
}

/** An agent's status as a tag, with the tone and label `agentStatus` gives it. */
export function AgentTag({ s }: { s: string }) {
  const { t } = useAwp();
  const m = agentStatus(s);
  return <Tg tone={m.tone} dot label={t(m.en, m.ar)} />;
}
