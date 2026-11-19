import { ZodError } from "zod";

import { messageArOf } from "./rejection";
import { NotPermitted } from "./session";
import type { Outcome } from "./outcome";

/**
 * Turns an expected refusal into a value a server action can return.
 *
 * `NotPermitted` is deliberately still thrown: the console has one boundary for it, and a
 * permission refusal is not something a screen explains in its own words.
 */
export async function attempt<T>(body: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await body() } as Outcome<T>;
  } catch (problem) {
    if (problem instanceof NotPermitted) throw problem;
    // An input the action's schema refused: its messages are written for a person, and the
    // error's own message is the issues as JSON.
    if (problem instanceof ZodError) {
      return { ok: false, reason: problem.issues.map((issue) => issue.message).join(" ") } as Outcome<T>;
    }
    const refusal = problem as { message?: string; suggestion?: string; problems?: unknown[]; digest?: string };
    const reasonAr = messageArOf(problem);
    return {
      ok: false,
      reason: refusal.message ?? String(problem),
      // Specification section 9: a refusal is read, so it is carried in both languages and
      // the screen picks one. Only a refusal raised as `Rejected` has an Arabic half.
      ...(reasonAr ? { reasonAr } : {}),
      ...(refusal.suggestion ? { suggestion: refusal.suggestion } : {}),
      ...(refusal.problems ? { problems: refusal.problems } : {}),
      // `COM-10`: "somebody else saved first" is a kind the screen answers differently.
      ...(refusal.digest ? { digest: refusal.digest } : {}),
    };
  }
}
