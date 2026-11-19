/**
 * D384: the brief a work item or request run starts with. The console gathers the record, its
 * comments and history, its audit trail and its attachments' names, so the agent works from them
 * without needing a platform tool to read any of it. Pure: the records are read by each feature's
 * repository, from the primary, since a brief is built straight after the write that started the run.
 */
/** The most a brief carries, in characters; past it the oldest history goes first. */
export const BRIEF_MAX_CHARS = 40_000;

/** The most one comment, history entry or field carries, in characters. */
export const BRIEF_ENTRY_MAX_CHARS = 2_000;

/** One part of a brief: a heading and its lines, oldest first. */
export type BriefSection = { title: string; lines: string[] };

/** What a brief is made of: the record's heading, its facts as label and value, and its sections. */
export type BriefParts = { heading: string; facts: [string, string | null | undefined][]; sections: BriefSection[] };

/** A value cut to `max` characters by code point, marked when it was cut. */
export function clip(value: string, max = BRIEF_ENTRY_MAX_CHARS): string {
  const characters = Array.from(value.trim());
  return characters.length <= max ? characters.join("") : `${characters.slice(0, max).join("")} […]`;
}

/**
 * The brief as text. Empty facts are left out and an empty section says "none", so the agent can
 * tell nothing from missing. When the whole is longer than `BRIEF_MAX_CHARS`, the oldest lines of
 * the longest section are dropped first and the section says how many went.
 */
export function composeBrief(parts: BriefParts): string {
  const sections = parts.sections.map((section) => ({ ...section, lines: [...section.lines], dropped: 0 }));
  const render = () =>
    [
      `# ${parts.heading}`,
      ...parts.facts.filter(([, value]) => value?.trim()).map(([label, value]) => `- ${label}: ${clip(value ?? "")}`),
      ...sections.map((section) =>
        [
          `\n## ${section.title}`,
          section.dropped ? `(${section.dropped} older entries left out)` : "",
          ...(section.lines.length ? section.lines : ["none"]),
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n");
  let text = render();
  while (text.length > BRIEF_MAX_CHARS) {
    const longest = sections.reduce((a, b) => (b.lines.length > a.lines.length ? b : a), sections[0]);
    if (!longest || longest.lines.length === 0) return clip(text, BRIEF_MAX_CHARS);
    longest.lines.shift();
    longest.dropped += 1;
    text = render();
  }
  return text;
}

/**
 * The mission prompt: what was asked, the record's brief, and how the run's answer is used. The
 * answer is posted on the record as the agent's comment when the run ends (D384).
 */
export function withBrief(instruction: string, brief: string, recordKey: string): string {
  return [
    instruction.trim(),
    "",
    `Everything recorded on ${recordKey} so far is below. Read it before you act; do not ask for what it already says.`,
    "Use your instructions, skills and connector tools to do the work.",
    `Your final answer (its "comment" when you answer in JSON) is posted on ${recordKey} as your comment, so make it the result: what you did, what came back, and anything still open.`,
    "",
    brief,
  ].join("\n");
}

/** The most of a run's answer posted as its comment, in characters. */
const ANSWER_MAX_CHARS = 20_000;

/**
 * D384: what a run's output says, as the comment posted on its work item or request; empty when
 * it said nothing. A request step answers in JSON (`{"action", "comment"}`, D215), which reads as
 * the decision and its reason rather than as JSON.
 */
export function agentAnswerOf(output: string): string {
  const text = output.trim();
  if (!text) return "";
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { action, comment } = parsed as { action?: unknown; comment?: unknown };
      const decision = typeof action === "string" && action ? `Decision: ${action}.` : "";
      const reason = typeof comment === "string" ? comment.trim() : "";
      if (decision || reason) return clip([decision, reason].filter(Boolean).join(" "), ANSWER_MAX_CHARS);
    }
  } catch {
    // Not JSON: the answer is the text itself.
  }
  return clip(text, ANSWER_MAX_CHARS);
}

/** Audit entries as brief lines, oldest first. */
export function auditLines(rows: { at: Date; actor: string; action: string; outcome: string }[]): string[] {
  return rows.map((row) => `- ${row.at.toISOString()} ${row.actor}: ${row.action} (${row.outcome})`);
}
