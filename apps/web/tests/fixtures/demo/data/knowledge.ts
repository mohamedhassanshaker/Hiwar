import type { Translate } from "@/i18n";

/** The prototype's knowledge collections and the Policies document sources. */
type CollectionSeed = {
  id: string;
  n: string;
  nAr: string;
  st: string;
  docs: number;
  chunks: number;
  ents: number;
  sync: string;
  idx: string;
  chunk: string;
  size: number;
  overlap: number;
  emb: string;
  ext: string;
  rr: boolean;
  k: number;
  store: string;
  p: string;
  vis: string;
};

type KnowledgeSourceSeed = { n: string; kind: string; docs: number; st: string; at: string };

/** The prototype builds these with `T(...)` at load time; here the screen passes `t`. */
export const kcols = (t: Translate): CollectionSeed[] => [
  { id: 'pol', n: 'Policies', nAr: 'السياسات', st: 'Healthy', docs: 142, chunks: 9840, ents: 1210, sync: '2h', idx: 'Hybrid (vector + graph)', chunk: 'Semantic', size: 800, overlap: 120, emb: 'embedding-default', ext: 'classifier-typed', rr: true, k: 8, store: 'pgvector · Neo4j', p: 'FIN', vis: 'Organisation' },
  { id: 'svc', n: 'Service catalogue', nAr: 'دليل الخدمات', st: 'Healthy', docs: 386, chunks: 18220, ents: 3104, sync: '6h', idx: 'Vector (HNSW)', chunk: 'Recursive by headings', size: 600, overlap: 80, emb: 'embedding-default', ext: '—', rr: true, k: 6, store: 'pgvector', p: 'CS', vis: 'Organisation' },
  { id: 'faq', n: 'Customer FAQs', nAr: 'الأسئلة الشائعة', st: 'Healthy', docs: 64, chunks: 1120, ents: 0, sync: '1d', idx: 'Vector (HNSW)', chunk: 'Q&A pairs', size: 400, overlap: 0, emb: 'embedding-default', ext: '—', rr: false, k: 4, store: 'pgvector', p: 'CS', vis: 'Public (widget)' },
  { id: 'run', n: 'IT runbooks', nAr: 'أدلة تشغيل التقنية', st: 'Degraded', docs: 210, chunks: 7400, ents: 2080, sync: '3d', idx: 'Hybrid (vector + graph)', chunk: 'Fixed size', size: 1000, overlap: 150, emb: 'embedding-default', ext: 'reasoning-default', rr: true, k: 8, store: 'pgvector · Neo4j', p: 'IT', vis: 'Project' },
  { id: 'ven', n: 'Vendor contracts', nAr: 'عقود الموردين', st: 'Ingesting', docs: 482, chunks: 12400, ents: 1016, sync: t('now', 'الآن'), idx: 'Hybrid (vector + graph)', chunk: 'Semantic', size: 800, overlap: 120, emb: 'local-private', ext: 'local-private', rr: true, k: 10, store: 'pgvector · Neo4j', p: 'PRC', vis: 'Project' },
];

export const ksrc0 = (t: Translate): KnowledgeSourceSeed[] => [
  { n: 'FIN-POL-007 Travel & Expense Policy.pdf', kind: 'Upload', docs: 1, st: 'Indexed', at: '1 Oct' },
  { n: 'SharePoint · /sites/finance/policies', kind: 'MCP · m365', docs: 118, st: 'Indexed', at: '2h' },
  { n: 'https://tahseel.ae/en/policies', kind: 'URL crawl', docs: 21, st: 'Indexed', at: '6h' },
  { n: 'HR-POL-2026 Leave Policy.docx', kind: 'Upload', docs: 1, st: 'Failed', at: '3d' },
  { n: 'Procurement handbook v4.pdf', kind: 'Upload', docs: 1, st: 'Queued', at: t('now', 'الآن') },
];

