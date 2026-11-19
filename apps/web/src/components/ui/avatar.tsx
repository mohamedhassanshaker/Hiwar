"use client";

import { useDirectory } from "@/components/shared/directory";
import { safePhotoRef } from "@/lib/photo";
import type { Agent, Person } from "@/types/directory";

/** An agent's initials in a circle `s` pixels across, with its name as the title. */
export function AgentAv({ a, s = 32 }: { a: Pick<Agent, "ini" | "name">; s?: number }) {
  // Circles, as handoff v2 draws them: an agent and a person sit side by side in the same
  // row throughout the console, and a square beside a circle read as two different things.
  return (
    <span className="awp-ag" title={a.name} style={{ width: s, height: s, fontSize: s * 0.38, borderRadius: "50%" }}>
      {a.ini}
    </span>
  );
}

/** `UC-04.1-03`: the photo wherever a person appears, with the initials as the fallback. */
export function PersonAv({ p, s = 32, online }: { p: Pick<Person, "ini" | "name" | "photo">; s?: number; online?: boolean }) {
  // The value goes into a CSS `url(...)`, so only a shape that cannot close it is drawn.
  const photo = safePhotoRef(p.photo);
  return (
    <span style={{ position: "relative", display: "inline-flex" }} title={p.name}>
      <span
        className="awp-pp"
        style={
          photo
            ? { width: s, height: s, backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center", color: "transparent" }
            : { width: s, height: s, fontSize: s * 0.36 }
        }
      >
        {p.ini}
      </span>
      {online !== undefined && (
        <span
          className="awp-dot"
          style={{ position: "absolute", bottom: 0, insetInlineEnd: 0, border: "2px solid var(--surface-raised)", width: 10, height: 10, background: online ? "var(--icon-success)" : "var(--icon-disabled)" }}
        />
      )}
    </span>
  );
}

/** The avatar of whichever principal an id names, person or agent. */
export function Who({ id, s = 32, online }: { id: string; s?: number; online?: boolean }) {
  const { agents, people, me } = useDirectory();
  const a = agents.find((x) => x.id === id);
  if (a) return <AgentAv a={a} s={s} />;
  const p = people.find((x) => x.id === id) || me;
  return <PersonAv p={p} s={s} online={online} />;
}
