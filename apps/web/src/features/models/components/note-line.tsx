"use client";

/** A message the drawer shows against the thing it is about. */
export type Note = { tone: "ok" | "bad"; text: string; items?: string[] } | null;

/** A note as an alert (bad) or a status line (ok), with its items as chips; nothing when there is no note. */
export function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <div
      role={note.tone === "bad" ? "alert" : "status"}
      style={{ color: note.tone === "bad" ? "var(--feedback-danger-text)" : "var(--text-success)" }}
    >
      {note.text}
      {note.items && note.items.length > 0 && (
        <div className="awp-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {note.items.map((item) => (
            <span key={item} className="awp-chip awp-mono">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
