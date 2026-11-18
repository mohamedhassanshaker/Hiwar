import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// First render calls no server action, so each is a stub that would refuse if it ever were.
vi.mock("@/features/files/actions", () =>
  Object.fromEntries(
    ["attachFile", "deleteItem", "setFileStatus", "setScopeOfUse", "uploadFile"].map((name) => [
      name,
      async () => ({ ok: false, reason: `${name} is not called on first render` }),
    ]),
  ),
);

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ToastProvider } from "@/components/shared/toast";
import { UploadFileModal } from "@/features/files/components/file-modals";
import { PreviewModal } from "@/features/files/components/preview-modal";
import { PreferencesProvider } from "@/lib/preferences";
import type { Project } from "@/types/directory";

/** What the upload and preview modals draw when they open, held as a snapshot. */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const projects: Project[] = [
  { k: "FIN", n: "Finance operations", nAr: "العمليات المالية", st: "Active", own: "p1", unit: "Finance", sens: "Internal", items: 4, prog: 50 },
];

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects, may }}>
        <ToastProvider>{node}</ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

const closed = () => undefined;
const go = () => undefined;

describe("S-32 and S-33 file modals", () => {
  it("draws the upload into a project, with its scope of use", () => {
    expect(renderScreen(<UploadFileModal onClose={closed} go={go} />, ["files:write"])).toMatchSnapshot();
  });

  it("draws the upload onto an item, which asks for no scope", () => {
    expect(
      renderScreen(<UploadFileModal onClose={closed} go={go} owner={{ type: "WorkItem", key: "FIN-12" }} />, ["files:write"]),
    ).toMatchSnapshot();
  });

  it("UC-33.1-07 offers a file's scope of use to change to somebody who may change it, and shows it to anybody else", () => {
    const item = { n: "notes.txt", kind: "file" as const, s: "1 KB", p: "FIN", w: "p1", scope: "OnlyMe", grantIds: [], st: "Active" };
    const writer = renderScreen(<PreviewModal onClose={closed} go={go} item={item} />, ["files:write"]);
    expect(writer).toContain('<div class="awp-seg"><button class="on">Only me</button><button class="">Selected</button><button class="">All</button></div>');

    const reader = renderScreen(<PreviewModal onClose={closed} go={go} item={item} />, ["files:read"]);
    expect(reader).not.toContain("awp-seg");
    expect(reader).toContain("<dt>Scope of use</dt><dd>Only me</dd>");
  });
});
