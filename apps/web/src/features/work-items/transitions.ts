import type { WorkItemStatus } from "@/db/schema/enums";

/**
 * Which status a work item may move to from each of the others (`UC-24.1-07`).
 *
 * The board lets a card be dragged anywhere, so the rule has to live where the move is
 * written rather than in the drag handler: a transition the platform does not allow must
 * fail the same way whether it came from a drag, the drawer, an agent or the API.
 *
 * The shape is deliberately permissive in the middle of the flow and strict at its ends.
 * Work goes back and forth between To do, In progress, In review and Blocked all day; what
 * is not ordinary is resurrecting finished work, which is why Done and Cancelled reopen
 * only to To do.
 */
export const ALLOWED_TRANSITIONS: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  Backlog: ["ToDo", "InProgress", "Cancelled"],
  ToDo: ["Backlog", "InProgress", "Blocked", "Cancelled"],
  InProgress: ["ToDo", "InReview", "Blocked", "Done", "Cancelled"],
  InReview: ["InProgress", "Blocked", "Done", "Cancelled"],
  Blocked: ["ToDo", "InProgress", "InReview", "Cancelled"],
  // Reopening finished work starts it again rather than putting it back mid-flight.
  Done: ["ToDo"],
  Cancelled: ["ToDo"],
};

/** The statuses work is submitted for review from (`UC-25.2-01`): the review has its own way in. */
export const SUBMITTABLE_STATUSES: readonly WorkItemStatus[] = ["ToDo", "InProgress"];

/** Whether one status may become another. Moving to the same status is a no-op, not a move. */
export function canMove(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from as WorkItemStatus];
  return !!allowed && (allowed as readonly string[]).includes(to);
}
