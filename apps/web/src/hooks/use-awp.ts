"use client";

import { useMemo } from "react";

import { useDirectory } from "@/components/shared/directory";
import { formatMoney } from "@/i18n";
import { STALE_WRITE_MESSAGE } from "@/lib/concurrency";
import { NOT_PERMITTED_DIGEST, STALE_WRITE_DIGEST } from "@/lib/digests";
import { usePreferences } from "@/lib/preferences";

/**
 * The language-aware helpers the prototype published on `window`: `T`, `nm`, `aName` and
 * `AED`. Every component takes them from here instead of from globals; the names they
 * resolve come from the directory the server loaded, not from a sample-data module.
 */
export function useAwp() {
  const { lang, setLang, theme, setTheme, t } = usePreferences();
  const { agents, people } = useDirectory();
  return useMemo(() => {
    const nm = (o: { name: string; nameAr?: string }) => (lang === "ar" ? o.nameAr || o.name : o.name);
    const aName = (id: string) => {
      const a = agents.find((x) => x.id === id);
      if (a) return nm(a);
      const p = people.find((x) => x.id === id);
      return p ? nm(p) : id;
    };
    const aed = (v: number) => formatMoney(lang, v);
    /**
     * What a refused action said, in the language the console is in.
     *
     * A refusal reaches a screen either as a `Refused` thrown by `orThrow` or as the
     * `{ ok: false }` an action returned; both carry the Arabic half when the service
     * raised one. A refusal from somewhere that has no Arabic half falls back to English
     * rather than showing nothing. A permission refusal and a stale write (`COM-10`) reach the
     * browser as their digest only, since a production server action never sends the message.
     */
    const why = (problem: unknown): string => {
      const refusal = problem as { reason?: string; reasonAr?: string; message?: string; messageAr?: string; digest?: string };
      if (refusal?.digest === NOT_PERMITTED_DIGEST) {
        return lang === "ar" ? "ليست لديك صلاحية لهذا الإجراء." : "You do not have permission to do this.";
      }
      if (refusal?.digest === STALE_WRITE_DIGEST) {
        return lang === "ar" ? STALE_WRITE_MESSAGE[1] : STALE_WRITE_MESSAGE[0];
      }
      const en = refusal?.reason ?? refusal?.message ?? String(problem);
      const ar = refusal?.reasonAr ?? refusal?.messageAr;
      return lang === "ar" && ar ? ar : en;
    };
    return { lang, setLang, theme, setTheme, t, nm, aName, aed, why };
  }, [lang, setLang, theme, setTheme, t, agents, people]);
}
