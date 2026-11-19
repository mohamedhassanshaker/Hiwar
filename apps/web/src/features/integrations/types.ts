/** Integration clients and their keys (S-76, S-77). */

export type ClientKey = {
  id: string;
  name: string;
  /** The visible prefix. The secret itself is shown once and never returned (requirement 29). */
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** Active, Revoked, or Expired when the expiry has passed. */
  status: string;
};

export type Client = {
  id: string;
  n: string;
  nAr: string;
  /** The owning person's id. */
  own: string;
  perms: string[];
  agents: string[];
  keys: number;
  mcp: boolean;
  agui: boolean;
  lastUsedAt: string | null;
  st: string;
};

export type ClientDetail = {
  keys: ClientKey[];
  mcp: { enabled: boolean; authType: string; exposedTools: string[]; lastTestAt: string | null; lastTestResult: string | null };
  agui: { enabled: boolean; allowedEvents: string[]; allowedOrigins: string[] };
};

/** One thing a client may be given, with the words the screen shows for it. */
export type ClientOption = { code: string; en: string; ar: string };
