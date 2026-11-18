import { createHash } from "node:crypto";

import { Rejected } from "./rejection";

/**
 * What an approval is an approval *of* (D20, D21, D49).
 *
 * An approval that names only a tool approves a payload nobody read: the agent asks to
 * publish a request type, a person agrees, and the call that then runs may carry different
 * arguments against a record that has since changed. So an approval binds to the exact
 * call — the tool, a hash of its canonical arguments, the version of the record it targets
 * — and to the run and the person it was asked of. It expires, and it is spent once.
 *
 * The hash is computed here and only here, from the arguments the server is about to act
 * on, so what was approved and what runs cannot drift apart.
 */

/**
 * How long a person has to decide before the approval stops counting (D21, D95).
 *
 * The same 24 hours the harness waits, because the two bound the same pause: an approval
 * that expired while the mission was still waiting would be refused on the retry, and
 * the person who decided it would see the call fail for a reason unconnected to their
 * decision.
 *
 * A day rather than a week: the approval binds to one call against one version of a
 * record, and a week-old mission is stale whoever decides it.
 */
export const APPROVAL_LIFETIME_MINUTES = 24 * 60;

/**
 * The run contexts where the person who asked decides their own run's approval: a room
 * (D105) and the assistant panel (`Console`, D281). Elsewhere the approvers are the other
 * holders of `approvals:decide`.
 */
export const REQUESTER_DECIDES_IN: readonly string[] = ["Room", "Console"];

/**
 * Of those, where a call that changes who may reach what (D253) still goes to the other
 * holders of `approvals:decide`: a room. In the panel the person asking decides it (D284).
 */
export const ACCESS_CHANGE_SEPARATE_IN: readonly string[] = ["Room"];

/**
 * One JSON text for one value, whatever order the keys arrived in.
 *
 * A model does not emit its object keys in a stable order, and two orderings of the same
 * arguments are the same call. Hashing the raw body would make an approval fail to match
 * the call it was created from, which reads as "someone tampered with this" when nothing
 * did. Arrays keep their order, because theirs is meaning.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/**
 * The arguments an approval binds to, as one hash.
 *
 * `__approval` is stripped: it is how the retry presents the approval, not part of the
 * call that was approved, and leaving it in would mean no retry could ever match.
 */
export function argumentsHash(args: unknown): string {
  const body =
    args && typeof args === "object" && !Array.isArray(args)
      ? Object.fromEntries(Object.entries(args as Record<string, unknown>).filter(([key]) => key !== APPROVAL_ARGUMENT))
      : args;
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

/** The argument a retry carries its approval in. */
export const APPROVAL_ARGUMENT = "__approval";

/**
 * The version of the record a call targets, when it names one.
 *
 * An approval is agreement to change a record as it stood. If someone else edits it in
 * between, the cascade the approver read no longer describes what would happen, so the
 * approval stops matching and the agent has to ask again.
 */
export function targetVersion(args: unknown): number | null {
  if (!args || typeof args !== "object") return null;
  const value = (args as Record<string, unknown>).expectedVersion;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * What the agent is told when a call needs an approval it does not have.
 *
 * Enough for the harness to create the right approval without guessing: which tool, which
 * exact arguments (by hash), which record version, and — when the server escalated because
 * of what the patch touches — which fields caused it. The harness pauses on this, creates
 * the bound approval, and retries the identical call with its id.
 */
export type ApprovalDescriptor = {
  reasonCode: "approval_required";
  tool: string;
  argumentsHash: string;
  expectedVersion: number | null;
  /** The fields that needed a person's agreement, when a field is what escalated the call. */
  fields: string[];
  /** One line per field, in the words an approver reads. */
  reasons: string[];
};

/**
 * Raised instead of writing, when a call needs an approval that was not presented.
 *
 * Thrown before anything is written, which is what makes the harness's retry safe: a
 * refused call left the record exactly as the approver will read it.
 */
export class ApprovalRequired extends Rejected {
  readonly descriptor: ApprovalDescriptor;

  constructor(descriptor: Omit<ApprovalDescriptor, "reasonCode">, message?: string, messageAr?: string) {
    const fields = descriptor.fields.length > 0 ? ` (${descriptor.fields.join(", ")})` : "";
    super(
      message ?? `${descriptor.tool}${fields} needs a person's approval before it runs.`,
      messageAr ?? `${descriptor.tool}${fields} يحتاج موافقة شخص قبل التنفيذ.`,
    );
    this.name = "ApprovalRequired";
    this.descriptor = { reasonCode: "approval_required", ...descriptor };
  }
}
