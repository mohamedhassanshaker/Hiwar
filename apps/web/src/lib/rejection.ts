/**
 * A refusal the person who acted is meant to read, in both console languages.
 *
 * Specification section 9: every label is in English and Arabic. A refusal is a label —
 * it is the only thing the screen has to say about why nothing happened — so it is written
 * the same way the rest of the console writes text, as the two strings side by side at the
 * place that knows what went wrong. `attempt()` carries both to the screen, which picks one.
 *
 * The English string is what `Error.message` holds, so logs and stack traces read as before.
 */
export class Rejected extends Error {
  readonly messageAr: string;

  constructor(message: string, messageAr: string) {
    super(message);
    this.name = "Rejected";
    this.messageAr = messageAr;
  }
}

/** The Arabic half of a refusal, when the thrown value carries one. */
export function messageArOf(problem: unknown): string | undefined {
  return problem instanceof Rejected ? problem.messageAr : undefined;
}
