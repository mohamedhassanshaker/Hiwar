/**
 * The screen-id to URL table, and the pure helpers over it.
 *
 * Deliberately carries no `"use client"` directive, unlike `./routes`, which holds the
 * hooks. A `"use server"` module that imports from a client module receives client
 * references rather than values, so `ROUTES.people` read from a server action was
 * `undefined` and every `revalidatePath(ROUTES.x)` crashed the render that followed a
 * successful write. Server code imports the table from here; `./routes` re-exports it so
 * client code is unaffected.
 */
/**
 * The AI capabilities' screen ids mapped to their Hiwar URLs, in the operator portal. The ids
 * are the module's; the few it names outside AI capabilities point at the Hiwar screen that
 * does that job.
 */
export const ROUTES = {
  dashboard: "/ops",
  inbox: "/ops/ai/approvals",
  profile: "/ops/me",
  people: "/ops/support",
  audit: "/ops/support",
  agents: "/ops/ai/agents",
  run: "/ops/ai/agents/runs",
  runs: "/ops/ai/runs",
  skills: "/ops/ai/skills",
  connectors: "/ops/ai/connectors",
  memory: "/ops/ai/memory",
  knowledge: "/ops/ai/knowledge",
  models: "/ops/ai/models",
  channels: "/ops/ai/channels",
  deployments: "/ops/ai/embedded-deployment",
  conversations: "/ops/ai/conversations",
  conversation: "/ops/ai/conversations/[id]",
  budgets: "/ops/ai/budgets",
  integrations: "/ops/ai/integrations",
  system: "/ops/ai/system",
  logs: "/ops/ai/system",
} as const;

export type ScreenId = keyof typeof ROUTES;

/** `navOf` in awp-app.jsx: which nav item a screen highlights. "" highlights nothing. */
export const NAV_OF: Partial<Record<ScreenId, ScreenId | "">> = {
  run: "agents",
  conversation: "conversations",
  profile: "",
};

export type GoParams = Record<string, string | number | undefined>;
export type Go = (screen: ScreenId, params?: GoParams) => void;
export type ScreenParams = Readonly<Partial<Record<string, string>>>;

/**
 * The URL of a screen: a parameter that names a `[segment]` of its route fills it, the rest go into
 * the query string, and undefined values are dropped. Throws when a segment is left unfilled.
 */
export function hrefOf(screen: ScreenId, params: GoParams = {}): string {
  let path: string = ROUTES[screen];
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const token = `[${key}]`;
    if (path.includes(token)) path = path.replace(token, encodeURIComponent(String(value)));
    else query.set(key, String(value));
  }
  // A path segment left unfilled is a caller naming the wrong parameter — `{ id }` for a
  // route whose segment is `[key]`. Next.js answers that with an invariant error from
  // inside its renderer, which says nothing about where it came from.
  if (path.includes("[")) {
    throw new Error(`${screen}: no value for the ${path.slice(path.indexOf("["))} segment`);
  }

  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

const SCREEN_IDS = Object.keys(ROUTES) as ScreenId[];

/**
 * The screen a pathname belongs to, used by the sidebar to pick the active nav item and by
 * the page assistant to decide which screen's data a question is about.
 */
export function screenOfPath(pathname: string): ScreenId | null {
  const exact = SCREEN_IDS.find((id) => ROUTES[id] === pathname);
  if (exact) return exact;
  return (
    SCREEN_IDS.find((id) => {
      const pattern = ROUTES[id];
      if (!pattern.includes("[")) return false;
      const parts = pattern.split("/");
      const actual = pathname.split("/");
      return parts.length === actual.length && parts.every((part, i) => part.startsWith("[") || part === actual[i]);
    }) || null
  );
}
