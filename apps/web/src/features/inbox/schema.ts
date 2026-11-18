import { z } from "zod";

/** Requirement 32: the Inbox action inputs, validated before the service sees them. */

export const approvalKeyInput = z.object({ key: z.string().trim().min(1).max(40) });

export const decisionInput = z
  .object({
    inboxItemId: z.uuid(),
    decision: z.enum(["Approved", "Rejected", "ChangesRequested"]),
    reason: z.string().trim().max(2000).optional(),
  })
  // Data model section 23 rule 3: a rejection always carries a reason.
  .refine((value) => value.decision !== "Rejected" || (value.reason ?? "").length > 0, {
    message: "A reason is required to reject.",
    path: ["reason"],
  });

export const answerAskedInput = z.object({
  questionId: z.uuid(),
  answer: z.string().trim().min(1).max(4000),
});

export const readInput = z.object({ inboxItemId: z.uuid() });

export const answerInput = z.object({
  inboxItemId: z.uuid(),
  answer: z.string().trim().min(1).max(4000),
});

export type DecisionInput = z.infer<typeof decisionInput>;
