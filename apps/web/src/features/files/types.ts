/** Artifacts and project files (S-32, S-33). */

export type ProjectItem = {
  /** File name. */
  n: string;
  /** Human-readable size. */
  s: string;
  /** Project key. */
  p: string;
  /** Who produced or uploaded it. */
  w: string;
  /** What it is linked to, for artifacts. */
  l?: string;
  /** Scope of use, for files: `OnlyMe`, `Selected` or `AllProject`. */
  scope?: string;
  /** For a `Selected` file, who may use it: their names, and their person ids or agent codes. */
  grants?: string[];
  grantIds?: string[];
  st: string;
  /** What the bytes are, which decides whether the preview can show them (`UC-32.1-06`). */
  mimeType?: string;
  /** `UC-32.1-03`: the run that produced an artifact, and the agent that ran it. */
  runKey?: string;
  runAgent?: string;
  /** The row version an edit has to name back, so a concurrent save is refused. */
  v: number;
};

/** The formats the preview can draw. Anything else gets its file-type icon and Download. */
/** What the preview draws: the file itself, its text, or nothing with the reason. */
export type Preview =
  | { mode: "inline" }
  | { mode: "text"; text: string }
  | { mode: "none"; reason?: string; reasonAr?: string };

export const PREVIEWABLE = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
