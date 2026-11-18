"use client";

import { useState, useTransition } from "react";

import { testRetrieval } from "@/features/knowledge/actions";
import { type Collection, type RetrievalResult } from "@/features/knowledge/types";
import { Btn } from "@/components/ui/button";
import { Seg } from "@/components/ui/tabs";
import { useAwp } from "@/hooks/use-awp";

/**
 * S-58: the retrieval test for one collection, or every collection when `c` is null. It runs
 * the query in Vector, Graph or Hybrid mode through `testRetrieval` and lists the passages
 * and graph facts, or the reason it failed. Graph and Hybrid are disabled while graph
 * retrieval is off, and the form starts from the last stored test.
 */
export function RetrievalTest({
  c,
  last,
  graphRetrieval,
}: {
  c: Collection | null;
  last: RetrievalResult | null;
  graphRetrieval: boolean;
}) {
  const { t } = useAwp();
  // `UC-75.3-03`: with graph retrieval off the platform is vector-only, so a stored test
  // that used Graph or Hybrid does not come back as a mode that cannot run.
  const [mode, setMode] = useState(graphRetrieval ? (last?.mode ?? "Hybrid") : "Vector");
  const [query, setQuery] = useState(last?.query ?? "");
  const [found, setFound] = useState<Awaited<ReturnType<typeof testRetrieval>> | null>(null);
  const [pending, start] = useTransition();
  const offBecauseFlag = t(
    "Graph retrieval is turned off in Settings.",
    "الاسترجاع الرسومي مُعطَّل في الإعدادات.",
  );

  /** `UC-58.1-01` … `-04`: the query is run, and what came back is what is shown. */
  const runTest = () =>
    start(async () => {
      setFound(await testRetrieval({ query, collectionId: c?.id, mode, limit: c?.k ?? 8 }));
    });

  const passages = found?.ok ? found.passages : [];
  const facts = found?.ok ? found.facts : [];
  const minimumScore = 0;

  return (
    <div className="awp-col" style={{ gap: 14 }}>
      <div className="awp-row" style={{ gap: 10, flexWrap: "wrap" }}>
        <input
          className="awp-input"
          style={{ flex: 1, minWidth: 220 }}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && runTest()}
          aria-label={t("Query", "الاستعلام")}
          placeholder={t("Ask the collection a question", "اسأل المجموعة سؤالاً")}
        />
        <Seg
          value={mode}
          onChange={setMode}
          items={[
            { id: "Vector", label: t("Vector", "متجهي") },
            { id: "Graph", label: t("Graph", "رسومي"), disabled: !graphRetrieval, title: graphRetrieval ? undefined : offBecauseFlag },
            { id: "Hybrid", label: t("Hybrid", "هجين"), disabled: !graphRetrieval, title: graphRetrieval ? undefined : offBecauseFlag },
          ]}
        />
        <Btn label={t("Run", "تشغيل")} disabled={pending || query.trim() === ""} onClick={runTest} />
      </div>
      <div className="awp-small awp-muted">
        {t("Collection", "المجموعة")}: <b>{c ? t(c.n, c.nAr) : t("All collections", "كل المجموعات")}</b> · top-k {c ? c.k : 8}
        {c && c.rr ? " · " + t("re-ranked", "مُعاد ترتيبه") : ""}
      </div>
      {/* `UC-58.1-06`: the reason, rather than a result set that looks empty. */}
      {found && !found.ok && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {found.reason}
        </p>
      )}
      {mode !== "Graph" &&
        passages.map((passage) => (
          <div key={passage.ref} className="awp-card" style={{ padding: 12, background: "var(--surface-card)" }}>
            <div className="awp-small awp-muted awp-mono">
              {passage.ref} · {passage.score.toFixed(2)}
              {c?.rr ? " · " + t("re-ranked", "مُعاد ترتيبه") : ""}
            </div>
            {passage.text}
          </div>
        ))}
      {mode !== "Vector" &&
        facts.map((fact) => (
          <div key={fact.subject + fact.predicate} className="awp-card" style={{ padding: 12, background: "var(--surface-card)" }}>
            <div className="awp-small awp-muted awp-mono">{t("graph fact", "حقيقة رسومية")}</div>
            ({fact.subject}) —[{fact.predicate}]→ ({fact.object})
          </div>
        ))}
      {/* `UC-58.1-04`: nothing scored high enough, which is an answer rather than a blank. */}
      {found?.ok && passages.length === 0 && facts.length === 0 && (
        <p className="awp-muted" style={{ margin: 0 }} role="status">
          {t("No passages above the minimum score.", "لا توجد مقاطع فوق الحد الأدنى للدرجة.")}
        </p>
      )}
      {!found && !last && (
        <p className="awp-muted" style={{ margin: 0 }}>
          {t("No retrieval has been tested yet.", "لم يُختبر الاسترجاع بعد.")}
        </p>
      )}
      {found?.ok && (
        <div className="awp-small awp-muted">
          {t(`Retrieved in ${found.durationMs} ms`, `استُرجع خلال ${found.durationMs} م.ث`)}
        </div>
      )}
      <span hidden>{minimumScore}</span>
    </div>
  );
}
