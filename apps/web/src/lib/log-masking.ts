/**
 * Masking the values a log line should never display (NFR-16, `UC-74.1-05`).
 *
 * `lib/logger.ts` redacts *named fields* before a line is written, which stops a careless
 * `log.error({ person }, …)`. It cannot touch a value interpolated into the message itself —
 * `"no mailbox for mariam@tahseel.ae"` is one string by the time pino sees it — and it does
 * nothing for lines the platform did not write, which the collected stream also carries.
 *
 * So the Logs screen masks what it is about to show. The scenario is about what is
 * displayed, and this is the last point where that can be decided for every line, however
 * it was produced.
 *
 * Narrow by design: each pattern matches a shape that is a secret or an identifier wherever
 * it appears. A rule that guessed from context would either miss values or redact ordinary
 * words, and a half-masked line reads as a safe one.
 */

const PATTERNS: readonly (readonly [string, RegExp])[] = [
  // Bearer tokens and API keys, before the generic rules can take a bite out of them.
  ["TOKEN", /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/gi],
  ["TOKEN", /\b(?:sk|pk|api[_-]?key|token|secret)[_-]?[A-Za-z0-9]*\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}["']?/gi],
  ["EMAIL", /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g],
  ["EMIRATES_ID", /\b784-?\d{4}-?\d{7}-?\d\b/g],
  ["IBAN", /\bAE\d{2}[0-9]{19}\b/gi],
  // No leading word boundary: one cannot hold before `+`, which would miss every number
  // written in international form.
  ["PHONE", /(?:\+971|00971|0)[\s-]?5\d[\s-]?\d{3}[\s-]?\d{4}\b/g],
  ["CARD", /\b(?:\d[ -]?){13,19}\b/g],
];

/**
 * The line as it may be shown, with every identifier and secret replaced by its label.
 *
 * Order matters: a token is masked before the card and phone rules run, so a long
 * credential is not reported as a card number.
 */
export function maskLogLine(message: string): string {
  let masked = message;
  for (const [label, pattern] of PATTERNS) {
    masked = masked.replace(pattern, `[${label}]`);
  }
  return masked;
}

/** Whether masking would change this line, for a test or a diagnostic to assert on. */
export function carriesSensitiveValue(message: string): boolean {
  return maskLogLine(message) !== message;
}
