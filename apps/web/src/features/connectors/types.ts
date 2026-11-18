import type { CredentialSummary } from "./credential";

/** Connectors and their tools (S-54). */

/**
 * The built-in connector whose tools are the platform's own catalogue (D228). Its tools are
 * read from the code, never stored, and an agent's grant of them is its platform-tool grant.
 */
export const PLATFORM_CONNECTOR_CODE = "platform";

export type Connector = {
  n: string;
  /** The name people read, in each language. */
  name: string;
  nameAr: string;
  d: string;
  dAr: string;
  /** How the console describes the transport: Remote MCP, Platform MCP or Local MCP (stdio). */
  kind: string;
  /** The stored transport token: StreamableHttp or Stdio. */
  transport: string;
  url: string;
  /** A `Stdio` connector's command line; empty for every other transport. */
  command: string;
  /** The auth type token, `CONNECTOR_AUTH_TYPES`. */
  auth: string;
  /** D296: the stored credential without its secrets, which an edit starts from. */
  credential: CredentialSummary;
  /** Connected, Error or Disabled. */
  st: string;
  on: boolean;
  def: string;
  tools: ConnectorTool[];
  /** The catalogue entry this was installed from, if any. */
  catalogueId: string | null;
  /** For the edit: a concurrent change to the same connector is refused, not merged. */
  version: number;
  /** Part of the platform (`internal://`): it cannot be removed. */
  builtin: boolean;
};

/**
 * One tool of a connector.
 *
 * `available` is false while a tool the server started offering has not been reviewed
 * (`UC-54.2-06`); no agent calls it until an admin has seen it in the drawer.
 */
export type ConnectorTool = {
  name: string;
  tier: string;
  available: boolean;
  /** A Platform connector built-in the harness answers inside the run (D80). */
  harness?: boolean;
};

/** A catalogue entry not yet installed, listed to agents by `connector_list`. */
export type CatalogueEntry = {
  id: string;
  code: string;
  en: string;
  ar: string;
  kind: string;
  tools: number;
  /** How it installs, for `connector_create`. */
  transport: string;
  url: string;
  auth: string;
};

/** The four tool tiers of specification 5.3. */
export const TIERS: [string, string, string, string][] = [
  ['T0', 'Autonomous', 'مستقل', 'neutral'],
  ['T1', 'Confirm', 'تأكيد', 'info'],
  ['T2', 'Human approval', 'اعتماد بشري', 'warning'],
  ['T3', 'Forbidden', 'محظور', 'danger'],
];
