import { loadRecordAudit } from "@/features/governance/service";
import { requirePermission, visibleProjectIds } from "@/lib/session";
import * as repository from "./repository";
import type { Request, RequestDetail, RequestInquiry, RequestReportNode, RequestReportWorkItem, RequestType } from "./types";

/**
 * D388: a request as a report — its header, form, steps and history, the requests below it at
 * every depth, the work items raised for each, and its audit trail for whoever may read the audit.
 */

export type RequestReport = {
  request: Request;
  detail: RequestDetail;
  type: RequestType | null;
  /** The requests below this one that the person may see, parents before children. */
  tree: RequestReportNode[];
  workItems: RequestReportWorkItem[];
  /** Null when the person may not read the audit log. */
  audit: Awaited<ReturnType<typeof loadRecordAudit>>;
  generatedAt: string;
};

/**
 * The requests of `nodes` whose chain of parents reaches `rootKey`: one hidden from the person
 * hides the requests below it too, because a report must not show where it hangs.
 */
export function reachableFrom(rootKey: string, nodes: RequestReportNode[]): RequestReportNode[] {
  const reached = new Set([rootKey]);
  const kept: RequestReportNode[] = [];
  let pending = nodes;
  for (let grew = true; grew; ) {
    grew = false;
    const waiting: RequestReportNode[] = [];
    for (const node of pending) {
      if (reached.has(node.parentKey)) {
        reached.add(node.key);
        kept.push(node);
        grew = true;
      } else waiting.push(node);
    }
    pending = waiting;
  }
  return kept;
}

/** The report of request `key`, or null when there is none or the person may not see it. Requires `requests:read`. */
export async function loadRequestReport(key: string): Promise<RequestReport | null> {
  const session = await requirePermission("requests:read");
  const visible = await visibleProjectIds("requests:read");
  const listed = await repository.listRequestPage(visible, session.personId, { key }, { limit: 1, offset: 0 });
  const request = listed.rows[0];
  const detail = request ? await repository.readRequestDetail(key) : null;
  if (!request || !detail) return null;
  const [nodes, types, createdAt] = await Promise.all([
    repository.readSubRequestTree(key, visible, session.personId),
    repository.listRequestTypes(),
    repository.requestCreatedAt(key),
  ]);
  const audit = await loadRecordAudit("Request", key, createdAt ?? new Date(request.submittedAt));
  const tree = reachableFrom(key, nodes);
  const workItems = await repository.readRequestWorkItems([key, ...tree.map((node) => node.key)]);
  return { request, detail, type: types.find((type) => type.c === request.ty) ?? null, tree, workItems, audit, generatedAt: new Date().toISOString() };
}

/**
 * D388: the requests a person may see that match a Requests report's filters, at most `limit`,
 * with how many match in all. Requires `requests:read`.
 */
export async function inquireRequests(filter: RequestInquiry, limit: number) {
  const session = await requirePermission("requests:read");
  const [matched, types] = await Promise.all([
    repository.inquireRequests(await visibleProjectIds("requests:read"), session.personId, filter, limit),
    repository.listRequestTypes(),
  ]);
  return { ...matched, types, generatedAt: new Date().toISOString() };
}

/** D388: what the Requests report's filters offer: the statuses, steps and channels in use, and the types. Requires `requests:read`. */
export async function requestReportChoices() {
  await requirePermission("requests:read");
  const [options, types] = await Promise.all([repository.requestInquiryOptions(), repository.listRequestTypes()]);
  return { options, types };
}
