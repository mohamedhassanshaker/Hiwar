import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A screen calls its server actions over the network once a person acts; first render calls
// none, so each is a stub that would refuse if it ever were called.
vi.mock("@/features/knowledge/actions", () =>
  Object.fromEntries(
    [
      "addSource",
      "collectionCounts",
      "createCollection",
      "deleteCollection",
      "ingestionProgress",
      "loadCollection",
      "recordIngestionOutcome",
      "reindex",
      "reindexCollection",
      "removeSource",
      "routeAliases",
      "saveCollectionConfig",
      "testRetrieval",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

// The App Router is not mounted under `react-dom/server`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/knowledge",
  useSearchParams: () => new URLSearchParams(),
}));

import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { Knowledge } from "@/features/knowledge/components/knowledge";
import type { Collection, KnowledgeSource } from "@/features/knowledge/types";
import { PreferencesProvider } from "@/lib/preferences";
import type { Person, Project } from "@/types/directory";

/** S-56 on first render, held as a snapshot (see `screen-render.test.tsx`). */
const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const project: Project = { k: "PRJ", n: "Project", nAr: "مشروع", st: "Active", own: "p1", unit: "", sens: "Internal", items: 2, prog: 50 };

/** No modal is open on first render, so the registry the provider would draw from is empty. */
const noModals = {} as ModalRegistry;

function renderScreen(node: ReactNode): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects: [project], may: ["knowledge:read", "knowledge:write"] }}>
        <ToastProvider>
          <ModalProvider registry={noModals}>{node}</ModalProvider>
        </ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-56 knowledge collections", () => {
  const base = { why: null, syncedAt: null, chunk: "Semantic", size: 800, overlap: 80, emb: "embedding-default", ext: "reasoning-default", rr: true, k: 8, p: "PRJ" };
  const collections: Collection[] = [
    { ...base, id: "hr-policies", n: "HR policies", nAr: "سياسات الموارد البشرية", st: "Ready", docs: 12, chunks: 340, ents: 25, progress: null, idx: "Hybrid", store: "pgvector · Neo4j", vis: "Internal" },
    { ...base, id: "contracts", n: "Contracts", nAr: "العقود", st: "Ingesting", docs: 4, chunks: 0, ents: 0, progress: 40, idx: "Vector", store: "pgvector", vis: "Confidential" },
    { ...base, id: "faq", n: "FAQ", nAr: "الأسئلة الشائعة", st: "Error", why: "The ingestion service did not answer.", docs: 0, chunks: 0, ents: 0, progress: null, idx: "Graph", store: "Neo4j", vis: "Public" },
  ];
  const sources: Record<string, KnowledgeSource[]> = {
    "hr-policies": [{ id: "s1", n: "policy.pdf", kind: "Upload", docs: 12, st: "Indexed", why: null, at: "2026-01-10T09:00:00Z" }],
  };

  it("draws the collection list with each status", () => {
    expect(
      renderScreen(
        <Knowledge collections={collections} opened={null} sources={sources} sourcePage={{ page: 1, total: 1, size: 50 }} sourceQuery="" lastTest={null} graphRetrieval mayReadLogs logService="ingestion" />,
      ),
    ).toMatchSnapshot();
  });
});
