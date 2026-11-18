import { SERVER_PAGE_SIZE } from "@/lib/paging";
import { requirePermission, visibleProjectIds } from "@/lib/session";
import { COLUMNS, type WorkItemFilters } from "./types";
import * as repository from "./repository";
import { WorkItemRejected } from "./errors";

export { WorkItemRejected } from "./errors";
export {
  createWorkItem,
  type WorkItemDiff,
  updateWorkItem,
  changeStatus,
  deleteWorkItem,
} from "./write-service";
export { addSubItem, setSubItemDone, comment, attach, noteAgentStopped } from "./activity-service";
export { inquireWorkItems, loadWorkItemReport, openWorkItemsReport, type WorkItemReport } from "./report-service";
export {
  mayApprove,
  submitForReview,
  submitAgentWork,
  approve,
  requestChanges,
  unblock,
  reopen,
  assign,
  assignToAgent,
} from "./review-service";

/** S-24 the board and list, S-25 the work item drawer. */

/** How many cards each board column shows; the column's count says how many match. */
export const BOARD_COLUMN_SIZE = 50;

/**
 * The work items the signed-in person sees that match the filters (D349): on the board, the
 * newest `BOARD_COLUMN_SIZE` of each column with each column's count; as a list, one page with
 * the total. Also the scope counts and the person's saved views. Requires `work_items:read`.
 */
export async function loadWorkItems(
  filters: WorkItemFilters = {},
  shape: { board: true } | { board: false; limit: number; offset: number; order?: "newest" | "due" } = { board: false, limit: SERVER_PAGE_SIZE, offset: 0 },
) {
  const session = await requirePermission("work_items:read");
  // A work item outside the person's projects is listed only when they are on it.
  const visibleIds = await visibleProjectIds("work_items:read");
  const [listed, scopes, views] = await Promise.all([
    shape.board
      ? Promise.all(
          COLUMNS.filter(([status]) => !filters.status || filters.status === status).map(async ([status]) => {
            const column = await repository.listWorkItemPage(visibleIds, session.personId, { ...filters, status }, { limit: BOARD_COLUMN_SIZE, offset: 0 });
            return { status, ...column };
          }),
        ).then((columns) => ({
          items: columns.flatMap((column) => column.rows),
          total: columns.reduce((sum, column) => sum + column.total, 0),
          columns: Object.fromEntries(columns.map((column) => [column.status, column.total])) as Record<string, number>,
        }))
      : repository.listWorkItemPage(visibleIds, session.personId, filters, shape).then((page) => ({ items: page.rows, total: page.total, columns: {} })),
    repository.countScopes(visibleIds, session.personId),
    repository.listSavedViews(session.personId, "WorkItems"),
  ]);
  return { ...listed, scopes, views };
}

/**
 * One work item as its card and its drawer's detail, by key, whether or not it is on the screen;
 * `null` when there is none or the signed-in person does not see it.
 */
export async function loadWorkItem(key: string) {
  const session = await requirePermission("work_items:read");
  const listed = await repository.listWorkItemPage(await visibleProjectIds("work_items:read"), session.personId, { key }, { limit: 1, offset: 0 });
  const item = listed.rows[0];
  if (!item) return null;
  const detail = (await repository.readDetails([key]))[key];
  return detail ? { item, detail } : null;
}

/** What a work item looks like when it is converted into a discussion room. */
export async function loadWorkItemForRoom(key: string) {
  const session = await requirePermission("work_items:read");
  return repository.workItemRoomSummary(key, await visibleProjectIds("work_items:read"), session.personId);
}

/** `UC-24.3-05`: open items in the same project that read like this title. */
export async function similarOpenItems(projectKey: string, title: string) {
  const session = await requirePermission("work_items:read");
  if (!projectKey || title.trim().length < 4) return [];
  return repository.similarOpenItems(projectKey, title, await visibleProjectIds("work_items:read"), session.personId);
}

/** `UC-24.2-01` … `-05`: the advanced search. */
export async function searchWorkItems(criteria: repository.WorkItemSearch) {
  const session = await requirePermission("work_items:read");
  // `UC-24.2-04`: a window that ends before it starts matches nothing, and saying so is
  // more useful than an empty list.
  if (criteria.dueFrom && criteria.dueTo && criteria.dueFrom > criteria.dueTo) {
    throw new WorkItemRejected("Due from must be on or before due to.", "تاريخ الاستحقاق من يجب أن يسبق تاريخ الاستحقاق إلى أو يساويه.");
  }
  return repository.searchWorkItems(criteria, await visibleProjectIds("work_items:read"), session.personId);
}

/** `UC-24.2-02`: keep a set of criteria under a name. */
export async function saveView(name: string, filter: Record<string, unknown>): Promise<void> {
  const session = await requirePermission("work_items:read");
  await repository.saveView({ personId: session.personId, screen: "WorkItems", name, filter });
}
