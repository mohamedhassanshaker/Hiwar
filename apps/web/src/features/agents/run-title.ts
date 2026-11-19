/** The title a run is started with, cut from its prompt. */

/** Characters of the prompt a run's title keeps. */
export const RUN_TITLE_LENGTH = 120;

/**
 * The first 120 characters of a prompt, cut between characters rather than UTF-16 units: a cut
 * through an emoji (the assistant names each attached file with 📎) left half a surrogate pair,
 * which the agent service cannot encode, so it refused the run with a 500.
 */
export function runTitle(prompt: string): string {
  return Array.from(prompt).slice(0, RUN_TITLE_LENGTH).join("");
}
