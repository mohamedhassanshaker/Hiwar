/**
 * What a server action hands back when the refusal is for the person to read.
 *
 * A server action that throws reaches the browser with its message replaced: Next.js
 * sanitises server errors in a production build and leaves only a digest. So a refusal the
 * screen has to show is a returned value, and only the unexpected is thrown.
 *
 * `attempt` wraps the server side and lives in `outcome.server.ts`, because this module is
 * imported by client components and must pull nothing server-only into their bundle.
 */

export type Refusal = {
  reason: string;
  /** The same refusal in Arabic, when the refusal was raised with one. */
  reasonAr?: string;
  suggestion?: string;
  problems?: unknown[];
  /** The kind of refusal, where a screen reacts to the kind rather than to the words. */
  digest?: string;
};

export type Outcome<T> = ({ ok: true } & (T extends void ? { value?: undefined } : { value: T })) | ({ ok: false } & Refusal);

/** A refusal, raised in the browser so its message survives to the screen. */
export class Refused extends Error {
  readonly reasonAr?: string;
  readonly suggestion?: string;
  readonly problems?: unknown[];
  readonly digest?: string;

  constructor(refusal: Refusal) {
    super(refusal.reason);
    this.name = "Refused";
    this.reasonAr = refusal.reasonAr;
    this.suggestion = refusal.suggestion;
    this.problems = refusal.problems;
    this.digest = refusal.digest;
  }
}

/**
 * The value an action returned, or a `Refused` carrying the reason.
 *
 * Called in the browser, which is what keeps the message: a screen that already catches to
 * show a refusal keeps working, and one that forgets to is a type error rather than silence.
 *
 * @throws {Refused} when the action refused.
 */
export function orThrow<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Refused(outcome);
  return outcome.value as T;
}
