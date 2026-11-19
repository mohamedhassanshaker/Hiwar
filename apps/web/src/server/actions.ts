import { ZodError } from "zod";

import { Refused } from "./api";
import { Forbidden } from "./authz";
import { Unauthenticated } from "./session";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; upgrade?: boolean };

/** Runs a server action body and turns the known refusals into a result the client shows. */
export async function act<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (problem) {
    if (problem instanceof Refused) return { ok: false, error: problem.message, upgrade: Boolean(problem.details?.upgrade) };
    if (problem instanceof Forbidden) return { ok: false, error: "You do not have access to this." };
    if (problem instanceof Unauthenticated) return { ok: false, error: problem.message };
    if (problem instanceof ZodError) return { ok: false, error: problem.issues.map((i) => i.message).join(" ") };
    console.error(problem);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
