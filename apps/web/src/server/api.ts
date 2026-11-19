import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { Forbidden } from "./authz";
import { Unauthenticated } from "./session";

/** A user-facing refusal with an HTTP status, for example a plan limit. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "Refused";
  }
}

/** Wraps a route handler: maps the known errors to JSON responses with the right status. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      const result = await fn(...args);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (problem) {
      if (problem instanceof Unauthenticated) return NextResponse.json({ error: problem.message }, { status: 401 });
      if (problem instanceof Forbidden) return NextResponse.json({ error: "You do not have access to this." }, { status: 403 });
      if (problem instanceof Refused)
        return NextResponse.json({ error: problem.message, ...problem.details }, { status: problem.status });
      if (problem instanceof ZodError)
        return NextResponse.json({ error: "Check the highlighted fields.", fields: problem.flatten().fieldErrors }, { status: 422 });
      console.error(problem);
      return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
    }
  };
}
