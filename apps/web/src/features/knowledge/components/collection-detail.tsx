"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useModals } from "@/components/shared/modal-host";
import {
  addSource,
  collectionCounts,
  deleteCollection,
  ingestionProgress,
  loadCollection,
  reindex,
  recordIngestionOutcome,
  reindexCollection,
  removeSource,
  saveCollectionConfig,
} from "@/features/knowledge/actions";
import { ingestionFinished } from "@/features/knowledge/ingestion-poll";
import { type Collection, type KnowledgeSource, type RetrievalResult, type RouteChoices } from "@/features/knowledge/types";
import type { CollectionConfig } from "@/features/knowledge/types";
import { srcAr, srcTone } from "@/i18n/vocabulary";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Seg, Tabs } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { orThrow, Refused } from "@/lib/outcome";
import { useToast } from "@/components/shared/toast";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import type { ServerPage } from "@/lib/paging";
import { useAgo } from "@/hooks/use-client-now";
import { useGo } from "@/lib/routes";
import { DataTable, KpiRow } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { RetrievalTest } from "./retrieval-test";

/** The stored reasons of a failed run, one per line, as the repository joined them. */
const reasonsOf = (stored: string | null): string[] => (stored ?? "").split("\n").filter((one) => one !== "");

/**
 * `UC-56.2-04`: an indexing run that did not start is reported as a refusal with its reason,
 * not as progress, so the toast is a danger toast in the console's language.
 */
const notStarted = (outcome: { reason: string | null; reasonAr: string | null }, en: string, ar: string) =>
  new Refused({
    reason: [en, outcome.reason].filter(Boolean).join(" "),
    reasonAr: [ar, outcome.reasonAr ?? outcome.reason].filter(Boolean).join(" "),
  });

/**
 * S-57: one knowledge collection — its sources and its configuration.
 *
 * Every control writes the collection's own configuration, which is what the ingestion run
 * is then given. A screen that drew options the ingestion does not read would be describing
 * a system that does not exist.
 */
export function CollectionDetail({
  c,
  sources,
  page,
  query,
  last,
  back,
  graphRetrieval,
  mayReadLogs,
  logService,
}: {
  c: Collection;
  /** One page of the collection's sources (D349). */
  sources: KnowledgeSource[];
  page: ServerPage;
  /** The source search the address holds. */
  query: string;
  last: RetrievalResult | null;
  back: () => void;
  graphRetrieval: boolean;
  mayReadLogs: boolean;
  logService: string;
}) {
  const { t, why } = useAwp();
  const { ago } = useAgo();
  const { act } = useModals();
  const { say } = useToast();
  const go = useGo();
  const [tab, setTab] = useState("details");
  // The sources are the server's, re-read by the `revalidatePath` every mutation runs, so
  // an added or removed one appears without the page being reloaded.
  const src = sources;
  const filter = useFilterQuery();
  const [search, setSearch] = useState(query);
  const [test, setTest] = useState(false);
  const [add, setAdd] = useState(false);
  const [kind, setKind] = useState("Upload");
  const [sourceName, setSourceName] = useState("");
  const [files, setFiles] = useState<{ name: string; dataUrl: string }[]>([]);

  /** Reads the chosen files, so the source carries them rather than naming them. */
  const chooseFiles = async (chosen: FileList | null) => {
    const read = await Promise.all(
      Array.from(chosen ?? []).map(
        (file) =>
          new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result) });
            reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
            reader.readAsDataURL(file);
          }),
      ),
    );
    setFiles(read);
    // The source's name follows the first file unless somebody has typed one.
    if (read.length > 0 && sourceName.trim() === "") setSourceName(read[0].name);
  };
  const [config, setConfig] = useState<CollectionConfig | null>(null);
  const [routes, setRoutes] = useState<RouteChoices>({ embedding: [], chat: [] });
  const [mayWrite, setMayWrite] = useState(false);
  const router = useRouter();
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [run, pending] = useAction();

  useEffect(() => {
    void loadCollection(c.id).then((loaded) => {
      if (!loaded) return;
      setConfig(loaded.config);
      setRoutes(loaded.routes);
      setMayWrite(loaded.mayWrite);
    });
  }, [c.id]);

  // `UC-56.2-03`: while a run is going the progress comes from the run itself.
  //
  // `UC-56.2-04` and `UC-57.1-01`: when the run stops, what it produced is recorded —
  // the collection leaves Ingesting, its documents say Indexed, and the totals are the
  // run's. The screen is what notices the run ended, because the progress it polls is the
  // only thing that knows.
  useEffect(() => {
    if (c.st !== "Ingesting") return;
    let live = true;
    const poll = async () => {
      const found = await ingestionProgress(c.id);
      if (!live) return;
      setProgress(found);
      if (!ingestionFinished(found.stage)) return;
      // Nobody pressed anything for this, so a refusal here is said once and the poll
      // stops rather than being thrown out of an effect nothing is catching.
      const outcome = await recordIngestionOutcome(c.id);
      if (!live) return;
      if (!outcome.ok) {
        say(why(outcome), "bad");
        return;
      }
      if (!outcome.value) return;
      const recorded = outcome.value;
      say(
        recorded.failures.length > 0
          ? t(
              `The ingestion of ${c.n} failed: ${recorded.failures[0]}`,
              `فشلت فهرسة ${c.nAr}: ${recorded.failures[0]}`,
            )
          : t(
              `${c.n} finished indexing ${recorded.documents} documents.`,
              `انتهت فهرسة ${recorded.documents} مستنداً في ${c.nAr}.`,
            ),
        recorded.failures.length > 0 ? "bad" : "ok",
      );
      router.refresh();
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [c.id, c.n, c.nAr, c.st, router, say, t, why]);

  const save = () =>
    run(async () => {
      if (!config) return null;
      const outcome = orThrow(await saveCollectionConfig({
        collectionId: c.id,
        visibility: config.visibility,
        indexType: config.indexType,
        chunking: config.chunking,
        preprocessing: config.preprocessing,
        embeddingRoute: config.embeddingRoute,
        extractionRoute: config.extractionRoute,
        retrieval: config.retrieval,
        syncSchedule: config.syncSchedule,
        maximumSizeMb: config.maximumSizeMb,
      }));
      // `UC-57.2-02`: vectors from two models cannot be compared, so the collection is
      // re-indexed rather than left half on one model and half on the other.
      if (outcome.reindexNeeded) {
        const started = orThrow(await reindexCollection(c.id));
        if (!started.started) throw notStarted(started, "Saved, but re-indexing did not start.", "تم الحفظ، لكن إعادة الفهرسة لم تبدأ.");
        return t("Saved. The collection is being re-indexed.", "تم الحفظ. تُعاد فهرسة المجموعة.");
      }
      return t("Saved.", "تم الحفظ.");
    });

  const field = <K extends keyof CollectionConfig>(key: K, value: CollectionConfig[K]) =>
    setConfig(config ? { ...config, [key]: value } : config);

  return (
    <div className="awp-page">
      <PageHead
        crumb={<Lnk onClick={back}>{t("AI Capabilities / Knowledge", "قدرات الذكاء الاصطناعي / قاعدة المعرفة")}</Lnk>}
        title={t(c.n, c.nAr)}
        sub={<span className="awp-mono">{c.id} · {c.store}</span>}
      >
        <StTag s={c.st === "Ingesting" ? "In Progress" : c.st === "Ready" ? "Healthy" : "Degraded"} />
        <Btn type="secondary" label={t("Test retrieval", "اختبار الاسترجاع")} onClick={() => setTest(true)} />
        {/* `UC-57.2-06`: somebody who may not configure the collection reads it. */}
        {mayWrite && <Btn label={t("Save changes", "حفظ التغييرات")} disabled={pending || config === null} onClick={save} />}
        {mayWrite && (
          <Btn
            type="danger"
            label={t("Delete collection", "حذف المجموعة")}
            disabled={pending}
            onClick={async () => {
              const counts = await collectionCounts(c.id);
              act({
                title: t("Delete collection", "حذف المجموعة"),
                desc: t(
                  `Deleting removes ${counts.sources} sources and ${counts.documents} documents, and any agent granted access to it loses that access.`,
                  `الحذف يزيل ${counts.sources} مصادر و${counts.documents} مستندات، ويفقد أي وكيل مُنح الوصول إليها هذا الوصول.`,
                ),
                confirm: t("Delete", "حذف"),
                onDone: () =>
                  run(async () => {
                    orThrow(await deleteCollection({ collectionId: c.id }));
                    back();
                    return t("Collection deleted.", "حُذفت المجموعة.");
                  }),
              });
            }}
          />
        )}
      </PageHead>
      {/* `UC-56.2-03` and `-04`: what the run is doing, or why it stopped. */}
      {c.st === "Ingesting" && progress && (
        <Card>
          <p style={{ margin: 0 }} role="status">
            {t(
              `Ingesting ${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}% · ${progress.stage}`,
              `الفهرسة ${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}٪ · ${progress.stage}`,
            )}
          </p>
        </Card>
      )}
      {/* `UC-56.2-04`: a failed run says what it could not read and where the rest of it
          was written, rather than leaving somebody to guess which log to open. */}
      {c.st === "Error" && (
        <Card>
          <div className="awp-row" style={{ gap: 12 }}>
            <div className="awp-col" style={{ gap: 4, flex: 1 }}>
              <p style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
                {t("The last ingestion failed.", "فشلت آخر عملية فهرسة.")}
              </p>
              {reasonsOf(c.why).map((reason) => (
                <span key={reason} className="awp-small" style={{ color: "var(--text-danger)" }}>
                  {reason}
                </span>
              ))}
              {mayReadLogs && (
                <Lnk onClick={() => go("logs", { service: logService, run: c.id })}>
                  {t("Open the run's log", "فتح سجل العملية")}
                </Lnk>
              )}
            </div>
            {mayWrite && (
              <Btn
                type="secondary"
                label={t("Re-index", "إعادة فهرسة")}
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const outcome = orThrow(await reindexCollection(c.id));
                    if (!outcome.started) throw notStarted(outcome, "Re-indexing did not start.", "لم تبدأ إعادة الفهرسة.");
                    return t("Re-indexing.", "جارٍ إعادة الفهرسة.");
                  })
                }
              />
            )}
          </div>
        </Card>
      )}
      <KpiRow
        items={[
          { label: t("Documents", "المستندات"), value: c.docs.toLocaleString() },
          { label: t("Chunks", "المقاطع"), value: c.chunks.toLocaleString() },
          { label: t("Entities", "الكيانات"), value: c.ents.toLocaleString() },
          {
            label: t("Last sync", "آخر مزامنة"),
            value: c.syncedAt ? ago(c.syncedAt) : "—",
          },
        ]}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "details", label: t("Details — document sources", "التفاصيل — مصادر المستندات"), count: page.total },
          { id: "config", label: t("Configuration", "الإعدادات") },
        ]}
      />
      {tab === "details" && (
        <Card
          pad={false}
          title={t("Document sources", "مصادر المستندات")}
          actions={
            mayWrite ? (
              <>
                {/* `UC-57.1-06`: the whole collection, with the progress it then reports. */}
                <Btn
                  type="secondary"
                  label={t("Re-index all", "إعادة الفهرسة للكل")}
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const outcome = orThrow(await reindexCollection(c.id));
                      if (!outcome.started) throw notStarted(outcome, "Re-indexing did not start.", "لم تبدأ إعادة الفهرسة.");
                      return t("Re-indexing the collection.", "تُعاد فهرسة المجموعة.");
                    })
                  }
                />
                <Btn label={t("Add source", "إضافة مصدر")} icon="AddCircle" onClick={() => setAdd(true)} />
              </>
            ) : undefined
          }
        >
          <div className="awp-row" style={{ padding: "12px 16px" }}>
            <input
              className="awp-input"
              style={{ maxWidth: 320 }}
              value={search}
              placeholder={t("Search sources by name", "ابحث في المصادر بالاسم")}
              aria-label={t("Search sources", "ابحث في المصادر")}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") filter.set("q", search.trim());
              }}
              onBlur={() => filter.set("q", search.trim())}
            />
          </div>
          <DataTable
            rows={src}
            server={{ ...page, onPage: (next) => filter.set("page", String(next)) }}
            cols={[
              { h: t("Source", "المصدر"), r: (s) => (<div className="awp-row"><Ic n="File01" s={18} /><b style={{ wordBreak: "break-all" }}>{s.n}</b></div>) },
              { h: t("Type", "النوع"), r: (s) => s.kind },
              { h: t("Documents", "المستندات"), end: true, r: (s) => s.docs },
              {
                h: t("Status", "الحالة"),
                // `UC-57.1-08`: a source that could not be read says why, beside its status.
                r: (s) => (
                  <div className="awp-col" style={{ gap: 4 }}>
                    <Tg tone={srcTone[s.st]} dot label={t(s.st, srcAr[s.st])} />
                    {s.st === "Error" && s.why && (
                      <span className="awp-small" style={{ color: "var(--text-danger)" }}>{s.why}</span>
                    )}
                  </div>
                ),
              },
              { h: t("Updated", "التحديث"), end: true, r: (s) => ago(s.at) },
              {
                h: "",
                end: true,
                r: (s) =>
                  mayWrite ? (
                    <div className="awp-row" style={{ justifyContent: "flex-end", gap: 12 }}>
                      {/* `UC-57.1-04`: unchanged documents are not indexed twice. */}
                      <Lnk
                        onClick={() =>
                          run(async () => {
                            const outcome = orThrow(await reindex({ sourceId: s.id }));
                            if (!outcome.started) {
                              throw notStarted(outcome, `Re-indexing ${s.n} did not start.`, `لم تبدأ إعادة فهرسة ${s.n}.`);
                            }
                            return t(`${s.n} is being re-indexed.`, `تُعاد فهرسة ${s.n}.`);
                          })
                        }
                      >
                        {t("Re-index", "إعادة فهرسة")}
                      </Lnk>
                      {/* `UC-57.1-05`: its documents, chunks and entities go with it. */}
                      <Lnk
                        danger
                        onClick={() =>
                          act({
                            title: t("Remove source", "إزالة المصدر"),
                            desc: t(
                              "Its documents, chunks and graph entities are removed from every store.",
                              "تُزال مستنداته ومقاطعه وكياناته من كل المخازن.",
                            ),
                            confirm: t("Remove", "إزالة"),
                            danger: true,
                            onDone: () =>
                              run(async () => {
                                orThrow(await removeSource(s.id));
                                return t(`${s.n} was removed.`, `أُزيل ${s.n}.`);
                              }),
                          })
                        }
                      >
                        {t("Remove", "إزالة")}
                      </Lnk>
                    </div>
                  ) : null,
              },
            ]}
          />
          {src.length === 0 && (
            <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }} role="status">
              {t("No sources yet.", "لا توجد مصادر بعد.")}
            </p>
          )}
        </Card>
      )}
      {tab === "config" && config && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }} className="awp-two">
          <Card title={t("Index", "الفهرس")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Index type", "نوع الفهرس")}>
                <PopSelect className="awp-input" value={config.indexType} disabled={!mayWrite} onChange={(e) => field("indexType", e.target.value)}>
                  <option value="Vector">{t("Vector", "متجهي")}</option>
                  <option value="Graph">{t("Graph", "رسومي")}</option>
                  <option value="Hybrid">{t("Hybrid", "هجين")}</option>
                </PopSelect>
              </Field>
              <Field label={t("Visibility", "الظهور")}>
                <PopSelect className="awp-input" value={config.visibility} disabled={!mayWrite} onChange={(e) => field("visibility", e.target.value)}>
                  {["Public", "Internal", "Confidential", "Restricted"].map((one) => (
                    <option key={one} value={one}>
                      {one}
                    </option>
                  ))}
                </PopSelect>
              </Field>
              <Field
                label={t("Maximum size (MB)", "الحجم الأقصى (ميغابايت)")}
                hint={t(`Currently ${config.currentSizeMb} MB.`, `الحالي ${config.currentSizeMb} ميغابايت.`)}
              >
                <input
                  className="awp-input"
                  type="number"
                  value={config.maximumSizeMb}
                  disabled={!mayWrite}
                  onChange={(e) => field("maximumSizeMb", Number(e.target.value))}
                />
              </Field>
            </div>
          </Card>
          <Card title={t("Chunking", "التقطيع")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Chunking technique", "أسلوب التقطيع")}>
                <PopSelect
                  className="awp-input"
                  value={config.chunking.technique}
                  disabled={!mayWrite}
                  onChange={(e) => field("chunking", { ...config.chunking, technique: e.target.value })}
                >
                  {["Fixed", "Recursive", "Semantic", "SentenceWindow", "TableAware"].map((one) => (
                    <option key={one} value={one}>
                      {one}
                    </option>
                  ))}
                </PopSelect>
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label={t("Chunk size (tokens)", "حجم المقطع (رموز)")}>
                  <input
                    className="awp-input"
                    type="number"
                    value={config.chunking.size}
                    disabled={!mayWrite}
                    onChange={(e) => field("chunking", { ...config.chunking, size: Number(e.target.value) })}
                  />
                </Field>
                <Field label={t("Overlap (tokens)", "التداخل (رموز)")}>
                  <input
                    className="awp-input"
                    type="number"
                    value={config.chunking.overlap}
                    disabled={!mayWrite}
                    onChange={(e) => field("chunking", { ...config.chunking, overlap: Number(e.target.value) })}
                  />
                </Field>
              </div>
              {/* `UC-57.2-04`: every chunk would contain the whole of the one before it. */}
              {config.chunking.overlap >= config.chunking.size && (
                <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
                  {t("The overlap has to be smaller than the chunk size.", "يجب أن يكون التداخل أصغر من حجم المقطع.")}
                </p>
              )}
              <Field label={t("Pre-processing", "المعالجة المسبقة")}>
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {(
                    [
                      ["ocr", t("OCR scanned PDFs", "التعرف الضوئي لملفات PDF الممسوحة")],
                      ["arabicNormalisation", t("Arabic normalisation", "توحيد النص العربي")],
                      ["stripHeadersFooters", t("Strip headers/footers", "إزالة الترويسات والتذييلات")],
                      ["maskPii", t("PII masking", "إخفاء البيانات الشخصية")],
                    ] as [keyof CollectionConfig["preprocessing"], string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      className={"awp-chip" + (config.preprocessing[key] ? " on" : "")}
                      disabled={!mayWrite}
                      onClick={() => field("preprocessing", { ...config.preprocessing, [key]: !config.preprocessing[key] })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              {/* `UC-57.1-09`: without OCR a scanned PDF yields no text at all. */}
              {!config.preprocessing.ocr && (
                <p className="awp-small awp-muted" style={{ margin: 0 }} role="note">
                  {t(
                    "With OCR off, a scanned PDF is indexed with no text.",
                    "مع تعطيل التعرف الضوئي، تُفهرس ملفات PDF الممسوحة بلا نص.",
                  )}
                </p>
              )}
            </div>
          </Card>
          <Card title={t("Models", "النماذج")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <Field
                label={t("Embedding route", "مسار التضمين")}
                hint={t(
                  "Changing the embedding route re-indexes the whole collection.",
                  "تغيير مسار التضمين يعيد فهرسة المجموعة كاملة.",
                )}
              >
                <PopSelect className="awp-input" value={config.embeddingRoute} disabled={!mayWrite} onChange={(e) => field("embeddingRoute", e.target.value)}>
                  <option value="">{t("Choose a route…", "اختر مساراً…")}</option>
                  {routes.embedding.map((alias) => (
                    <option key={alias} value={alias}>
                      {alias}
                    </option>
                  ))}
                </PopSelect>
              </Field>
              <Field label={t("Entity extraction route (graph)", "مسار استخراج الكيانات (الرسم)")}>
                <PopSelect className="awp-input" value={config.extractionRoute} disabled={!mayWrite} onChange={(e) => field("extractionRoute", e.target.value)}>
                  {routes.chat.map((alias) => (
                    <option key={alias} value={alias}>
                      {alias}
                    </option>
                  ))}
                </PopSelect>
              </Field>
              <Field label={t("Re-ranker", "إعادة الترتيب")}>
                <div className="awp-row" style={{ gap: 10 }}>
                  <Toggle
                    on={config.retrieval.rerank}
                    onChange={(value) => field("retrieval", { ...config.retrieval, rerank: value })}
                  />
                  <span className="awp-small awp-muted">
                    {t("Re-rank the passages before they are returned.", "إعادة ترتيب المقاطع قبل إرجاعها.")}
                  </span>
                </div>
              </Field>
            </div>
          </Card>
          <Card title={t("Retrieval & sync", "الاسترجاع والمزامنة")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="top-k">
                  <input
                    className="awp-input"
                    type="number"
                    value={config.retrieval.topK}
                    disabled={!mayWrite}
                    onChange={(e) => field("retrieval", { ...config.retrieval, topK: Number(e.target.value) })}
                  />
                </Field>
                <Field label={t("Min score", "أدنى درجة")}>
                  <input
                    className="awp-input"
                    type="number"
                    step="0.05"
                    value={config.retrieval.minimumScore}
                    disabled={!mayWrite}
                    onChange={(e) => field("retrieval", { ...config.retrieval, minimumScore: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <Field label={t("Sync schedule", "جدول المزامنة")}>
                <PopSelect className="awp-input" value={config.syncSchedule} disabled={!mayWrite} onChange={(e) => field("syncSchedule", e.target.value)}>
                  <option value="Manual">{t("Manual", "يدوي")}</option>
                  <option value="Daily">{t("Daily", "يومي")}</option>
                  <option value="Weekly">{t("Weekly", "أسبوعي")}</option>
                </PopSelect>
              </Field>
            </div>
          </Card>
        </div>
      )}
      {test && (
        <Modal w={760} title={t("Retrieval test", "اختبار الاسترجاع")} onClose={() => setTest(false)}>
          <RetrievalTest c={c} last={last} graphRetrieval={graphRetrieval} />
        </Modal>
      )}
      {add && (
        <Modal
          title={t("Add source", "إضافة مصدر")}
          onClose={() => setAdd(false)}
          footer={
            <>
              <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={() => setAdd(false)} />
              <Btn
                label={t("Add and index", "إضافة وفهرسة")}
                disabled={pending || sourceName.trim() === ""}
                onClick={() =>
                  run(async () => {
                    const outcome = orThrow(
                      await addSource({ collectionCode: c.id, type: kind, name: sourceName, documents: files }),
                    );
                    // `UC-57.1-07` and `UC-57.2-05`: a source the platform cannot take is
                    // refused with the reason rather than listed as Indexing for ever.
                    if (!outcome.added) throw new Refused({ reason: outcome.reason ?? "", reasonAr: outcome.reasonAr ?? undefined });
                    setAdd(false);
                    setSourceName("");
                    setFiles([]);
                    if (!outcome.indexing) {
                      throw notStarted(outcome, `${sourceName} was added, but indexing did not start.`, `أُضيف ${sourceName}، لكن الفهرسة لم تبدأ.`);
                    }
                    return t(`${sourceName} was added and is indexing.`, `أُضيف ${sourceName} وتجري فهرسته.`);
                  })
                }
              />
            </>
          }
        >
          <Field label={t("Source type", "نوع المصدر")}>
            <Seg
              value={kind}
              onChange={(value) => {
                setKind(value);
                setSourceName("");
              }}
              items={[
                { id: "Upload", label: t("Upload", "رفع") },
                { id: "UrlCrawl", label: t("URL crawl", "زحف رابط") },
                { id: "McpResource", label: t("MCP resource", "مورد MCP") },
              ]}
            />
          </Field>
          <Field
            label={
              kind === "Upload"
                ? t("File name", "اسم الملف")
                : kind === "UrlCrawl"
                  ? t("Start URL", "رابط البدء")
                  : t("Resource path", "مسار المورد")
            }
            hint={
              kind === "Upload"
                ? t("PDF, DOCX, XLSX, HTML or MD.", "PDF أو DOCX أو XLSX أو HTML أو MD.")
                : kind === "UrlCrawl"
                  ? t("An http or https address.", "عنوان http أو https.")
                  : t("A path the connector exposes.", "مسار يوفره الموصل.")
            }
          >
            <input className="awp-input" value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
          </Field>
          {/* `UC-57.1-01`: an upload brings its files, which become the source's documents. */}
          {kind === "Upload" && (
            <Field
              label={t("Files", "الملفات")}
              hint={t(
                "Dropped here, these are what the run reads. Without them the source has nothing to index.",
                "الملفات التي تُسقط هنا هي ما تقرأه العملية. بدونها لا يوجد ما يُفهرس.",
              )}
            >
              <input
                type="file"
                multiple
                className="awp-input"
                aria-label={t("Files", "الملفات")}
                onChange={(event) => void chooseFiles(event.target.files)}
              />
              {files.length > 0 && (
                <p className="awp-small awp-muted" style={{ margin: "6px 0 0" }}>
                  {files.map((file) => file.name).join(", ")}
                </p>
              )}
            </Field>
          )}
        </Modal>
      )}
    </div>
  );
}
