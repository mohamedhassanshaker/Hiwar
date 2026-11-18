import * as budgets from "@/features/budgets/service";
import * as engage from "@/features/engage/service";
import * as files from "@/features/files/service";
import * as home from "@/features/home/service";
import * as inbox from "@/features/inbox/service";
import * as knowledge from "@/features/knowledge/service";
import * as memory from "@/features/memory/service";
import * as agentRuns from "@/features/agents/service";
import * as organisation from "@/features/organisation/service";
import * as projects from "@/features/projects/service";
import * as requests from "@/features/requests/service";
import * as rooms from "@/features/rooms/service";
import * as schedules from "@/features/schedules/service";
import * as skills from "@/features/skills/service";
import * as workItems from "@/features/work-items/service";
import { screenOfPath, type ScreenId } from "@/lib/route-table";
import { requireSession } from "@/lib/session";

/**
 * What is on a console screen, read as that screen's own feature service reads it.
 *
 * `UC-03.1-02`: the page assistant is told which screen the question is about and reads
 * that screen's data itself. "Summarise this page" is only answerable if the agent can
 * reach the same content the person is looking at, and a summary built from whatever the
 * browser happened to send would be neither complete nor trustworthy.
 *
 * Every reader is the service behind the page, so the permission check, the project
 * visibility and the audit are the ones already written: the run acts as the person who
 * asked, and a screen they may not open returns their refusal rather than its content.
 */
const READERS: Partial<Record<ScreenId, () => Promise<unknown>>> = {
  dashboard: () => home.loadDashboard(),
  records: () => home.loadRecords(undefined),
  inbox: () => inbox.loadInbox(),
  projects: () => projects.loadProjects(),
  sessions: () => rooms.loadRooms(),
  tasks: () => workItems.loadWorkItems(),
  requests: () => requests.loadRequests(),
  requestTypes: () => requests.loadRequests().then(({ types }) => types),
  routines: () => schedules.loadSchedules(),
  artifacts: () => files.loadArtifacts(),
  files: () => files.loadFiles(),
  orgchart: () => organisation.loadOrgChart(),
  people: () => organisation.loadPeopleAndRoles(),
  units: () => organisation.loadOrgUnits(),
  agents: () => organisation.loadDirectory().then(({ agents }) => ({ agents })),
  run: () => agentRuns.loadRuns(),
  skills: () => skills.loadSkills(),
  memory: () => memory.loadMemory(),
  knowledge: () => knowledge.loadKnowledge(),
  channels: () => engage.loadChannelBoard(),
  deployments: () => engage.loadDeployments(),
  budgets: () => budgets.loadBudgets(),
};

/** One room, work item or request named in the path, rather than the whole list. */
const DETAIL: { pattern: RegExp; read: (key: string) => Promise<unknown> }[] = [
  { pattern: /^\/discussion-rooms\/([^/?#]+)/, read: (key) => rooms.loadRoom(decodeURIComponent(key)) },
];

export type PageContent = {
  /** The screen the path belongs to, or `null` when it belongs to none. */
  screen: ScreenId | null;
  path: string;
  content: unknown;
};

/**
 * Reads the screen a path names.
 *
 * @throws when the screen's own service refuses the acting person — the refusal is the
 * answer, not something to swallow into an empty page.
 */
export async function readPage(path: string): Promise<PageContent> {
  const clean = path.split("?")[0].split("#")[0] || "/";

  for (const { pattern, read } of DETAIL) {
    const match = pattern.exec(clean);
    if (match) return { screen: screenOfPath(clean), path: clean, content: await read(match[1]) };
  }

  const screen = screenOfPath(clean);
  const reader: (() => Promise<unknown>) | undefined = screen ? READERS[screen] : undefined;
  if (!reader) {
    return {
      screen,
      path: clean,
      content: { note: "This screen has no readable content. Say so rather than guessing at it." },
    };
  }
  return { screen, path: clean, content: await reader() };
}

/** One thing waiting on the person, with where to open it and why it is urgent. */
export type AttentionItem = {
  kind: "Approval" | "Question" | "Mention" | "SlaRisk" | "Review" | "WorkItem" | "Request";
  key: string;
  title: string;
  /** Lower sorts first: 0 is a decision blocking a run, 3 is ordinary open work. */
  rank: number;
  why: string;
  /** The console path that opens it. */
  href: string;
  at: string | null;
};

/** The Inbox kinds, in the order they block someone else's work. */
const INBOX_RANK: Record<string, { rank: number; kind: AttentionItem["kind"]; why: string }> = {
  approval: { rank: 0, kind: "Approval", why: "A run is paused until this is decided." },
  question: { rank: 0, kind: "Question", why: "A run is waiting for this answer." },
  sla: { rank: 1, kind: "SlaRisk", why: "Its SLA is close to its deadline." },
  review: { rank: 1, kind: "Review", why: "Work is waiting on this review." },
  mention: { rank: 2, kind: "Mention", why: "Someone named you." },
};

/**
 * `UC-03.1-02`: what is waiting on the person who asked, most blocking first.
 *
 * The Inbox comes first because every item in it is something another person's or another
 * run's progress is stopped on; their own open work follows, soonest due first. Each entry
 * carries the path that opens it, so the answer is a list of links rather than a list of
 * keys to go and find.
 */
export async function myAttention(limit = 20): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];

  // The open items, oldest first; more than one answer can list are never needed (`limit` is at most 50).
  const open = (await inbox.loadInbox({ filter: "all" })).items;
  for (const item of open) {
    const classified = INBOX_RANK[item.kind] ?? { rank: 2, kind: "Approval" as const, why: "It is waiting on you." };
    items.push({
      kind: classified.kind,
      key: item.id,
      title: item.t,
      rank: classified.rank,
      why: item.blocked ?? classified.why,
      href: item.roomKey
        ? `/discussion-rooms/${item.roomKey}`
        : item.workItemKey
          ? `/work-items?open=${item.workItemKey}`
          : "/inbox",
      at: item.at,
    });
  }

  const { personId } = await requireSession();
  // The person's own open work, soonest due first: assigned to them, not everything they may read.
  const { items: work } = await workItems.loadWorkItems({ scope: "all", assignee: personId, open: true }, { board: false, limit, offset: 0, order: "due" });
  for (const item of work) {
    items.push({
      kind: "WorkItem",
      key: item.k,
      title: item.t,
      rank: 3,
      why: `${item.st}${item.pri ? ` · ${item.pri} priority` : ""}`,
      href: `/work-items?open=${item.k}`,
      at: item.dueAt ?? null,
    });
  }

  // Rank first, then the nearest date: within one band the thing due soonest is the one to
  // do next, and an item with no date is not more urgent than one with a date that is past.
  return items
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      if (left.at === right.at) return 0;
      if (left.at === null) return 1;
      if (right.at === null) return -1;
      return left.at.localeCompare(right.at);
    })
    .slice(0, limit);
}
