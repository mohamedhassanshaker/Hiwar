"use client";

import { useEffect, useState, useTransition } from "react";

import { createCollection, routeAliases, saveCollectionConfig } from "@/features/knowledge/actions";
import { type Collection, type KnowledgeSource, type RetrievalResult, type RouteChoices } from "@/features/knowledge/types";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { orThrow } from "@/lib/outcome";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import type { ServerPage } from "@/lib/paging";
import { CodeField, ProjectSelect } from "@/components/shared/forms";
import { useProjects } from "@/components/shared/directory";
import { DataTable, KpiRow } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { RetrievalTest } from "./retrieval-test";
import { CollectionDetail } from "./collection-detail";

/**
 * S-56: the Knowledge screen. Lists the collections with their totals and opens one's detail
 * (named by `?open=`, so the server reads that collection's sources a page at a time and the
 * detail reads the latest server props, D349), a retrieval test for one collection or
 * all, and the New collection dialog. Creating calls `createCollection`, then
 * `saveCollectionConfig` with the chosen embedding route and the first chat route for
 * extraction (D257); a refusal stays in the dialog.
 */
export function Knowledge({
  collections,
  opened,
  sources,
  sourcePage,
  sourceQuery,
  lastTest,
  graphRetrieval,
  mayReadLogs,
  logService,
}: {
  collections: Collection[];
  /** The collection the address opens, by id. */
  opened: string | null;
  /** One page of the opened collection's sources, under its id. */
  sources: Record<string, KnowledgeSource[]>;
  sourcePage: ServerPage;
  sourceQuery: string;
  graphRetrieval: boolean;
  lastTest: RetrievalResult | null;
  mayReadLogs: boolean;
  logService: string;
}) {
  const { t, why } = useAwp();
  const { say } = useToast();
  const filter = useFilterQuery();
  // The chosen collection is held by id, in the address: the counters and the status come
  // from the server render, so a copy taken when the row was clicked would still say
  // Ingesting after the run that was ingesting had finished.
  const select = (one: Collection | null) => (one ? filter.set("open", one.id) : filter.clear());
  const sel = opened === null ? null : (collections.find((one) => one.id === opened) ?? null);
  const [test, setTest] = useState<Collection | 'all' | null>(null);
  const cols = collections;
  const [nw, setNw] = useState(false);
  const [nn, setNn] = useState('');
  const [newId, setNewId] = useState('');
  const [newProject, setNewProject] = useState('');
  const [newIndexType, setNewIndexType] = useState('Hybrid');
  const [newChunking, setNewChunking] = useState('Semantic');
  const [newEmbedding, setNewEmbedding] = useState('');
  const [newVisibility, setNewVisibility] = useState('Internal');
  const [routeOptions, setRouteOptions] = useState<RouteChoices>({ embedding: [], chat: [] });
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const projects = useProjects();
  // `ProjectSelect` has no blank option, so a never-touched `''` renders as if the first
  // project were chosen while the form still holds nothing — this is what actually fills
  // the gap, both in what the picker shows and in what gets submitted.
  const effectiveProject = newProject || (projects[0]?.k ?? '');

  // The routes a collection may embed with come from the model catalogue, so the picker
  // offers what the platform actually has rather than a list written here — independent of
  // any collection already existing, since the first one an install creates has none to ask.
  useEffect(() => {
    if (!nw) return;
    void routeAliases().then(setRouteOptions);
  }, [nw]);

  if (sel)
    return (
      <CollectionDetail
        c={sel}
        sources={sources[sel.id] ?? []}
        page={sourcePage}
        query={sourceQuery}
        last={lastTest}
        back={() => select(null)}
        graphRetrieval={graphRetrieval}
        mayReadLogs={mayReadLogs}
        logService={logService}
      />
    );
  return (
    <div className="awp-page">
      <PageHead
        crumb={t('AI Capabilities', 'قدرات الذكاء الاصطناعي')}
        title={t('Knowledge', 'قاعدة المعرفة')}
        sub={t('Collections ingested into vector and graph stores for cited retrieval. Each collection has its own configuration and document sources.', 'مجموعات مُدخلة في مخازن المتجهات والرسوم للاسترجاع مع الإسناد. لكل مجموعة إعداداتها ومصادر مستنداتها.')}
      >
        <Btn type="secondary" label={t('Test knowledge retrieval', 'اختبار استرجاع المعرفة')} onClick={() => setTest('all')} />
        <Btn label={t('New collection', 'مجموعة جديدة')} icon="AddCircle" onClick={() => setNw(true)} />
      </PageHead>
      <KpiRow
        items={[
          { label: t('Collections', 'المجموعات'), value: cols.length },
          { label: t('Documents', 'المستندات'), value: cols.reduce((n, c) => n + c.docs, 0).toLocaleString() },
          { label: t('Chunks', 'المقاطع'), value: (cols.reduce((n, c) => n + c.chunks, 0) / 1000).toFixed(1) + 'k' },
          { label: t('Entities', 'الكيانات'), value: cols.reduce((n, c) => n + c.ents, 0).toLocaleString() },
        ]}
      />
      <Card pad={false} title={t('Collections', 'المجموعات')}>
        <DataTable
          onRow={select}
          rows={cols}
          cols={[
            { h: t('Collection', 'المجموعة'), r: (c) => (<div><button className="awp-lnk-t" onClick={(e) => { e.stopPropagation(); select(c); }}>{t(c.n, c.nAr)}</button><div className="awp-small awp-muted awp-mono">{c.p} · {c.vis}</div></div>) },
            { h: t('Index type', 'نوع الفهرس'), r: (c) => <span className="awp-small">{c.idx}</span> },
            { h: t('Chunking', 'التقطيع'), r: (c) => <span className="awp-small">{c.chunk} · {c.size}/{c.overlap}</span> },
            { h: t('Embedding route', 'مسار التضمين'), r: (c) => <span className="awp-mono awp-small">{c.emb}</span> },
            { h: t('Documents', 'المستندات'), end: true, r: (c) => c.docs },
            { h: t('Status', 'الحالة'), r: (c) => (c.st === 'Ingesting' ? <Tg tone="info" dot label={t(`Ingesting ${c.progress ?? 0}%`, `جارٍ الإدخال ${c.progress ?? 0}٪`)} /> : <StTag s={c.st === 'Ready' ? 'Healthy' : 'Degraded'} />) },
            { h: '', end: true, r: (c) => (<div className="awp-row" style={{ justifyContent: 'flex-end', gap: 12 }} onClick={(e) => e.stopPropagation()}><Lnk onClick={() => setTest(c)}>{t('Test retrieval', 'اختبار الاسترجاع')}</Lnk><Lnk onClick={() => select(c)}>{t('Configure', 'إعداد')}</Lnk></div>) },
          ]}
        />
      </Card>
      {test && (
        <Modal w={760} title={t('Retrieval test', 'اختبار الاسترجاع')} onClose={() => setTest(null)}>
          <RetrievalTest c={test === 'all' ? null : test} last={lastTest} graphRetrieval={graphRetrieval} />
        </Modal>
      )}
      {nw && (
        <Modal
          title={t('New collection', 'مجموعة جديدة')}
          onClose={() => setNw(false)}
          footer={
            <>
              <Btn type="secondary" label={t('Cancel', 'إلغاء')} onClick={() => setNw(false)} />
              {/* `UC-56.2-02`: an id that is already taken, or no embedding route, is refused. */}
              <Btn
                label={t('Create and configure', 'إنشاء وإعداد')}
                disabled={creating || nn.trim() === '' || newId === '' || newEmbedding === ''}
                onClick={() =>
                  startCreate(async () => {
                    setCreateError(null);
                    try {
                      orThrow(await createCollection({
                        collectionId: newId,
                        nameEn: nn,
                        nameAr: nn,
                        // Hiwar has no projects; a collection belongs to the platform.
                        projectKey: effectiveProject || undefined,
                        visibility: newVisibility,
                      }));
                      orThrow(await saveCollectionConfig({
                        collectionId: newId,
                        visibility: newVisibility,
                        indexType: newIndexType,
                        chunking: { technique: newChunking, size: 800, overlap: 80 },
                        preprocessing: { ocr: true, arabicNormalisation: true, stripHeadersFooters: true, maskPii: true },
                        embeddingRoute: newEmbedding,
                        // The graph's entities are extracted by a chat model, not the embedding one (D257).
                        extractionRoute: routeOptions.chat[0] ?? '',
                        retrieval: { topK: 8, minimumScore: 0.35, rerank: true },
                        syncSchedule: 'Manual',
                        maximumSizeMb: 1024,
                      }));
                      setNw(false);
                      say(t(`${nn} was created.`, `أُنشئت ${nn}.`));
                    } catch (problem) {
                      // The refusal stays in the dialog it belongs to: the id that is
                      // already taken is typed two fields above it.
                      setCreateError(why(problem));
                    }
                  })
                }
              />
            </>
          }
        >
          <Field label={t('Name', 'الاسم')}>
            <input className="awp-input" value={nn} onChange={(e) => setNn(e.target.value)} placeholder={t('e.g. HR policies', 'مثال: سياسات الموارد البشرية')} />
          </Field>
          {projects.length > 0 && (
            <Field label={t('Project', 'المشروع')}>
              <ProjectSelect value={effectiveProject} onChange={setNewProject} />
            </Field>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label={t('Index type', 'نوع الفهرس')}>
              <PopSelect className="awp-input" value={newIndexType} onChange={(e) => setNewIndexType(e.target.value)}>
                <option value="Hybrid">{t('Hybrid', 'هجين')}</option>
                <option value="Vector">{t('Vector', 'متجهي')}</option>
                <option value="Graph">{t('Graph', 'رسومي')}</option>
              </PopSelect>
            </Field>
            <Field label={t('Chunking technique', 'أسلوب التقطيع')}>
              <PopSelect className="awp-input" value={newChunking} onChange={(e) => setNewChunking(e.target.value)}>
                {['Semantic', 'Recursive', 'Fixed', 'SentenceWindow', 'TableAware'].map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </PopSelect>
            </Field>
            <Field label={t('Embedding route', 'مسار التضمين')}>
              <PopSelect className="awp-input" value={newEmbedding} onChange={(e) => setNewEmbedding(e.target.value)}>
                <option value="">{t('Choose a route…', 'اختر مساراً…')}</option>
                {routeOptions.embedding.map((alias) => (
                  <option key={alias} value={alias}>
                    {alias}
                  </option>
                ))}
              </PopSelect>
            </Field>
            <Field label={t('Visibility', 'الظهور')}>
              <PopSelect className="awp-input" value={newVisibility} onChange={(e) => setNewVisibility(e.target.value)}>
                {['Public', 'Internal', 'Confidential', 'Restricted'].map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </PopSelect>
            </Field>
          </div>
          <CodeField label={t('Collection ID', 'معرّف المجموعة')} from={nn} onChange={setNewId} />
          {createError && (
            <p className="awp-small" style={{ margin: 0, color: 'var(--text-danger)' }} role="alert">
              {createError}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
