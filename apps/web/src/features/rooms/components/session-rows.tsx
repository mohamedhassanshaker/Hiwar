"use client";

import { type Session } from "@/features/rooms/types";
import { sesAr, sesTone } from "@/i18n/vocabulary";
import { useGo } from "@/lib/routes";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { useAwp } from "@/hooks/use-awp";
import { useAgo } from "@/hooks/use-client-now";

/** Translates a room status, type or source token into the console's language, falling back to the token. */
export function useSesAr() {
  const { t } = useAwp();
  return (k: string) => t(k, sesAr[k] || k);
}

/** The rooms as a table; a row opens its room. */
export function SessionRows({ rows }: { rows: Session[] }) {
  const { t, aed } = useAwp();
  const { ago } = useAgo();
  const ar = useSesAr();
  const go = useGo();
  return (
    <>
    <table className="awp-tbl">
      <thead>
        <tr>
          <th>{t("Discussion room", "اجتماع العمل")}</th>
          <th>{t("Project", "المشروع")}</th>
          <th>{t("Type", "النوع")}</th>
          <th>{t("Source", "المصدر")}</th>
          <th>{t("Participants", "المشاركون")}</th>
          <th>{t("Status", "الحالة")}</th>
          <th style={{ textAlign: "end" }}>{t("Messages", "الرسائل")}</th>
          <th style={{ textAlign: "end" }}>{t("Estimated cost", "التكلفة التقديرية")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.key} className="click" onClick={() => go("session", { key: s.key })}>
            <td>
              <div style={{ fontWeight: 500 }}>{t(s.t, s.tAr)}</div>
              <div className="awp-small awp-muted">
                <span className="awp-mono">{s.key}</span> · {ago(s.lastActivityAt)}
              </div>
            </td>
            <td>
              <span className="awp-mono">{s.p}</span>
            </td>
            <td>{ar(s.type)}</td>
            <td className="awp-muted">{ar(s.src)}</td>
            <td>
              <div className="awp-row" style={{ gap: 0 }}>
                {s.who.map((w, i) => (
                  <span key={w} style={{ marginInlineStart: i ? -8 : 0, borderRadius: 10, boxShadow: "0 0 0 2px var(--surface-raised)", display: "inline-flex" }}>
                    <Who id={w} s={28} />
                  </span>
                ))}
              </div>
            </td>
            <td>
              <Tg tone={sesTone[s.st]} dot label={ar(s.st)} />
            </td>
            <td style={{ textAlign: "end" }}>{s.msgs}</td>
            <td className="awp-muted" style={{ textAlign: "end", whiteSpace: "nowrap" }}>
              {aed(s.cost)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}
