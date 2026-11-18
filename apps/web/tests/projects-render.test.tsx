import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Server actions are a network boundary that first render never crosses, so each is a stub
// that would refuse if it were called.
const { refusing, address } = vi.hoisted(() => ({
  refusing: (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })])),
  /** The query string the screen is opened with. */
  address: { search: "" },
}));
vi.mock("@/features/projects/actions", () =>
  refusing(["addProjectMember", "createProject", "deleteProject", "removeProjectMember", "renameProject", "updateProjectPolicy"]),
);
vi.mock("@/features/organisation/actions", () => refusing(["listOrgUnitChoices"]));
vi.mock("@/features/skills/actions", () => refusing(["createSkill", "importSkill", "validateSkillPackage"]));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(address.search),
  usePathname: () => "/projects",
}));

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { NewProjectModal, NewRequestTypeModal } from "@/features/projects/components/create-modals";
import { ImportSkillModal, NewSkillModal } from "@/features/projects/components/skill-modals";
import { Projects } from "@/features/projects/components/projects";
import type { ProjectsScreen } from "@/features/projects/types";
import { PreferencesProvider } from "@/lib/preferences";
import type { Project } from "@/types/directory";

/** What S-20 Projects and the create modals draw on first render, held as snapshots. */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const projects: Project[] = [
  { k: "FIN", n: "Finance operations", nAr: "عمليات المالية", st: "InProgress", own: "p1", unit: "Finance", sens: "Confidential", items: 12, prog: 40 },
  { k: "HR", n: "People services", nAr: "خدمات الموظفين", st: "Planned", own: "p1", unit: "HR", sens: "Internal", items: 0, prog: 0 },
];
// The screen opens a modal only when asked; first render draws none.
const registry = new Proxy({}, { get: () => () => null }) as ModalRegistry;

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects, may }}>
        <ToastProvider>
          <ModalProvider registry={registry}>{node}</ModalProvider>
        </ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-20 projects", () => {
  const screen: ProjectsScreen = {
    details: {},
    connectors: [{ code: "erp", nameEn: "ERP", nameAr: "تخطيط الموارد" }],
    agents: [{ code: "fin", nameEn: "Finance agent", nameAr: "وكيل المالية" }],
    mayWrite: true,
  };

  it("draws the project list with New Project for somebody who may create one", () => {
    expect(renderScreen(<Projects {...screen} />, ["projects:write"])).toMatchSnapshot();
  });

  it("draws it without New Project for somebody who may not", () => {
    expect(renderScreen(<Projects {...screen} mayWrite={false} />)).toMatchSnapshot();
  });

  it("UC-20.2-01 opens on the project its address names, which is where a new project lands", () => {
    const detail = {
      key: "HR",
      sensitivity: "Internal",
      status: "Backlog",
      version: 1,
      contents: { rooms: 0, workItems: 0, requests: 0, schedules: 0, artifacts: 0, files: 0 },
      members: [{ id: "p1", role: "Owner", isAgent: false }],
      requireReviewerNotAuthor: false,
      approvalRules: [],
      allowedAgents: [],
      allowedConnectors: [],
      decisions: [],
    };
    address.search = "open=HR";
    try {
      const html = renderScreen(<Projects {...screen} details={{ HR: detail }} />, ["projects:write"]);
      expect(html).toContain("People services");
      expect(html).toContain("Members");
      expect(html).not.toContain("Search projects");
    } finally {
      address.search = "";
    }
  });
});

describe("the create modals", () => {
  const go = () => undefined;
  const onClose = () => undefined;

  it("draws New Project and New request type", () => {
    expect(renderScreen(<NewProjectModal onClose={onClose} go={go} />)).toMatchSnapshot();
    expect(renderScreen(<NewRequestTypeModal onClose={onClose} go={go} />)).toMatchSnapshot();
  });

  it("draws New skill and Import skill", () => {
    expect(renderScreen(<NewSkillModal onClose={onClose} go={go} />)).toMatchSnapshot();
    expect(renderScreen(<ImportSkillModal onClose={onClose} go={go} />)).toMatchSnapshot();
  });
});
