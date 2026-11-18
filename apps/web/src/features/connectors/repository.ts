import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { assertWritten } from "@/lib/concurrency";
import type { RuntimeConnector } from "@/lib/connector-runtime";
import { decrypt, encrypt } from "@/lib/crypto";
import type { Operation } from "./openapi";
import { credentialSummary, readCredential, type StoredCredential } from "./credential";
import type { SaveConnectorInput } from "./schema";
import type { CatalogueEntry, Connector } from "./types";

/** The only module in `connectors` that touches Drizzle. */

/** The transport words the console shows, from the stored transport and the server URL. */
function kindOf(transport: string, serverUrl: string | null): string {
  if (transport === "OpenApi") return "REST API (OpenAPI)";
  if (transport === "Stdio") return "Local MCP (stdio)";
  if ((serverUrl ?? "").startsWith("internal://")) return "Platform MCP";
  return "Remote MCP";
}

/** A stored command line, split into the argv the connector runtime actually runs. */
export function splitCommand(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

/**
 * Every connector by code, with its catalogue description, the console's transport words, a
 * credential summary without secrets, and its registered tools with tier and availability.
 */
export async function listConnectors(): Promise<Connector[]> {
  const rows = await dbRo()
    .select({
      id: s.connector.id,
      n: s.connector.code,
      name: s.connector.nameEn,
      nameAr: s.connector.nameAr,
      d: s.connectorCatalogEntry.descriptionEn,
      dAr: s.connectorCatalogEntry.descriptionAr,
      transport: s.connector.transport,
      url: s.connector.serverUrl,
      command: s.connector.command,
      auth: s.connector.authType,
      secretRef: s.connector.secretRef,
      st: s.connector.status,
      on: s.connector.isEnabled,
      def: s.connector.defaultTierForNewTools,
      catalogueId: s.connector.catalogEntryId,
      version: s.connector.version,
    })
    .from(s.connector)
    .leftJoin(s.connectorCatalogEntry, eq(s.connectorCatalogEntry.id, s.connector.catalogEntryId))
    .orderBy(asc(s.connector.code));

  const ids = rows.map((row) => row.id);
  const tools = ids.length
    ? await dbRo()
        .select({
          connectorId: s.connectorTool.connectorId,
          name: s.connectorTool.name,
          tier: s.connectorTool.tier,
          available: s.connectorTool.isAvailable,
        })
        .from(s.connectorTool)
        .where(inArray(s.connectorTool.connectorId, ids))
        .orderBy(asc(s.connectorTool.name))
    : [];

  return rows.map((row) => ({
    n: row.n,
    name: row.name,
    nameAr: row.nameAr,
    d: row.d ?? "",
    dAr: row.dAr ?? "",
    kind: kindOf(row.transport, row.url),
    builtin: (row.url ?? "").startsWith("internal://"),
    url: row.url ?? "",
    command: row.command ?? "",
    auth: row.auth,
    credential: credentialSummary(row.auth, row.secretRef ? readCredential(row.auth, decrypt(row.secretRef)) : null),
    st: row.st,
    on: row.on,
    def: row.def,
    transport: row.transport,
    catalogueId: row.catalogueId,
    version: row.version,
    tools: tools
      .filter((tool) => tool.connectorId === row.id)
      .map(({ name, tier, available }) => ({ name, tier, available })),
  }));
}

/**
 * The code a catalogue entry installs as: what an agent will name its tools by
 * (`connector/tool`), so it is lowercase, hyphenated and free of the URL it came from.
 */
function connectorCode(from: string): string {
  return from
    .replace(/^stdio:\/\//, "")
    .replace(/^https?:\/\/(mcp\.)?/, "")
    .replace(/\.example\/mcp$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Catalogue entries that are not installed as a connector, for `connector_list`. */
export async function listCatalogue(): Promise<CatalogueEntry[]> {
  const installed = await dbRo().select({ catalogEntryId: s.connector.catalogEntryId }).from(s.connector);
  const taken = new Set(installed.map((row) => row.catalogEntryId));
  const rows = await dbRo()
    .select({
      id: s.connectorCatalogEntry.id,
      en: s.connectorCatalogEntry.descriptionEn,
      ar: s.connectorCatalogEntry.descriptionAr,
      nameEn: s.connectorCatalogEntry.nameEn,
      defaultUrl: s.connectorCatalogEntry.defaultUrl,
      auth: s.connectorCatalogEntry.authType,
      tools: s.connectorCatalogEntry.toolCount,
    })
    .from(s.connectorCatalogEntry)
    .orderBy(asc(s.connectorCatalogEntry.nameEn));

  return rows
    .filter((row) => !taken.has(row.id))
    .map((row) => {
      const stdio = (row.defaultUrl ?? "").startsWith("stdio://");
      return {
        id: row.id,
        code: connectorCode(row.defaultUrl ?? row.nameEn),
        en: row.en ?? row.nameEn,
        ar: row.ar ?? row.nameEn,
        kind: stdio ? "Local MCP (stdio)" : "Remote MCP",
        tools: row.tools,
        transport: stdio ? "Stdio" : "StreamableHttp",
        url: row.defaultUrl ?? "",
        auth: row.auth,
      };
    });
}

/** Turning a connector off stops every agent calling any of its tools. */
export async function setEnabled(code: string, enabled: boolean, version: number, personId: string): Promise<void> {
  const rows = await db()
    .update(s.connector)
    .set({ isEnabled: enabled, status: enabled ? "Connected" : "Disabled", updatedAt: new Date(), updatedBy: personId })
    .where(and(eq(s.connector.code, code), eq(s.connector.version, version)))
    .returning({ id: s.connector.id });
  assertWritten(rows, "Connector");
}

/** Specification 5.3: a project policy may raise a tool's tier, never lower it. */
export async function setToolTier(connectorCode: string, toolName: string, tier: string, personId: string): Promise<void> {
  await db()
    .update(s.connectorTool)
    .set({ tier, updatedAt: new Date(), updatedBy: personId })
    .where(
      and(
        eq(s.connectorTool.name, toolName),
        sql`${s.connectorTool.connectorId} = (select c.id from ai.connector c where c.code = ${connectorCode})`,
      ),
    );
}

/** One connector with the tools it was registered with, for the drawer and the refresh. */
export async function readConnector(code: string): Promise<{
  id: string;
  code: string;
  defaultTierForNewTools: string;
  transport: string;
  serverUrl: string | null;
  authType: string;
  /** The stored credential, still encrypted. */
  secretRef: Buffer | null;
  tools: { name: string; tier: string }[];
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.connector.id,
      code: s.connector.code,
      defaultTierForNewTools: s.connector.defaultTierForNewTools,
      transport: s.connector.transport,
      serverUrl: s.connector.serverUrl,
      authType: s.connector.authType,
      secretRef: s.connector.secretRef,
    })
    .from(s.connector)
    .where(eq(s.connector.code, code))
    .limit(1);
  if (!row) return null;

  const tools = await dbRo()
    .select({ name: s.connectorTool.name, tier: s.connectorTool.tier })
    .from(s.connectorTool)
    .where(eq(s.connectorTool.connectorId, row.id));
  return { ...row, tools };
}

/**
 * D296: the column write a credential makes. Absent leaves the stored one; `null` (no
 * authentication) clears it.
 */
function secretOf(credential: StoredCredential | null | undefined): { secretRef?: Buffer | null } {
  if (credential === undefined) return {};
  return { secretRef: credential ? encrypt(JSON.stringify(credential)) : null };
}

/** D296: store a connector's credential as the OAuth flow left it. */
export async function writeCredential(code: string, credential: StoredCredential): Promise<void> {
  await db().update(s.connector).set({ secretRef: encrypt(JSON.stringify(credential)), updatedAt: new Date() }).where(eq(s.connector.code, code));
}

/** `UC-54.2-07`: what the console says about a connector it could or could not reach. */
export async function setConnectorStatus(
  connectorId: string,
  status: string,
  personId: string,
): Promise<void> {
  await db()
    .update(s.connector)
    .set({
      status,
      lastHandshakeAt: new Date(),
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(eq(s.connector.id, connectorId));
}

/**
 * `UC-54.2-06`: bring the stored tool list in line with what the server offers.
 *
 * A tool that is still there keeps the tier an admin gave it — that decision was about the
 * tool, not about this handshake. One that has arrived is stored unavailable at the tier
 * its annotations earned it, and one that has gone is marked unavailable rather than
 * deleted, because an agent is configured against it and the admin should see what
 * happened rather than find the row missing.
 */
export async function reconcileTools(
  connectorId: string,
  offered: {
    name: string;
    description: string;
    tier: string;
    readOnlyHint?: boolean | null;
    destructiveHint?: boolean | null;
  }[],
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const existing = await tx
      .select({ id: s.connectorTool.id, name: s.connectorTool.name })
      .from(s.connectorTool)
      .where(eq(s.connectorTool.connectorId, connectorId));
    const byName = new Map(existing.map((tool) => [tool.name, tool.id]));

    for (const tool of offered) {
      const id = byName.get(tool.name);
      if (id) {
        await tx
          .update(s.connectorTool)
          .set({
            descriptionEn: tool.description,
            readOnlyHint: tool.readOnlyHint ?? null,
            destructiveHint: tool.destructiveHint ?? null,
            isAvailable: true,
            updatedAt: new Date(),
            updatedBy: personId,
          })
          .where(eq(s.connectorTool.id, id));
        continue;
      }
      await tx.insert(s.connectorTool).values({
        connectorId,
        name: tool.name,
        // The server names the tool; the title is what the console shows, and until
        // someone writes one the name is the most honest thing to show.
        titleEn: tool.name,
        titleAr: tool.name,
        descriptionEn: tool.description,
        readOnlyHint: tool.readOnlyHint ?? null,
        destructiveHint: tool.destructiveHint ?? null,
        tier: tool.tier,
        // Unavailable until an admin has looked at it: nobody assigned this one a tier.
        isAvailable: false,
        createdBy: personId,
        updatedBy: personId,
      });
    }

    const offeredNames = new Set(offered.map((tool) => tool.name));
    const gone = existing.filter((tool) => !offeredNames.has(tool.name)).map((tool) => tool.id);
    if (gone.length) {
      await tx
        .update(s.connectorTool)
        .set({ isAvailable: false, updatedAt: new Date(), updatedBy: personId })
        .where(inArray(s.connectorTool.id, gone));
    }
  });
}

/** Whether a connector is part of the platform (`internal://`). */
export async function isBuiltin(code: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ url: s.connector.serverUrl })
    .from(s.connector)
    .where(eq(s.connector.code, code))
    .limit(1);
  return (row?.url ?? "").startsWith("internal://");
}

/** `UC-54.2-05`: the agents that would lose tools if this connector went. */
export async function agentsUsingConnector(code: string): Promise<string[]> {
  const rows = await dbRo()
    .selectDistinct({ code: s.agent.code })
    .from(s.agentToolMode)
    .innerJoin(s.connectorTool, eq(s.connectorTool.id, s.agentToolMode.connectorToolId))
    .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agentToolMode.agentVersionId))
    .innerJoin(s.agent, eq(s.agent.id, s.agentVersion.agentId))
    .where(eq(s.connector.code, code))
    .orderBy(asc(s.agent.code));
  return rows.map((row) => row.code);
}

/** `UC-54.2-05`: remove the connector and everything configured against it. */
export async function removeConnector(code: string, personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [connector] = await tx
      .select({ id: s.connector.id })
      .from(s.connector)
      .where(eq(s.connector.code, code))
      .limit(1);
    if (!connector) return;

    // The modes agents set for its tools go with it: a mode for a tool that no longer
    // exists is a decision about nothing.
    await tx.delete(s.agentToolMode).where(
      inArray(
        s.agentToolMode.connectorToolId,
        tx.select({ id: s.connectorTool.id }).from(s.connectorTool).where(eq(s.connectorTool.connectorId, connector.id)),
      ),
    );
    await tx.delete(s.connectorTool).where(eq(s.connectorTool.connectorId, connector.id));
    await tx.delete(s.connector).where(eq(s.connector.id, connector.id));
    void personId;
  });
}

/** Whether a connector with this code already exists, and which row it is. */
export async function connectorIdByCode(code: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.connector.id }).from(s.connector).where(eq(s.connector.code, code)).limit(1);
  return row?.id ?? null;
}

/**
 * `UC-54.1-03`, `UC-54.2-01`…`-04`: write the connector the drawer holds.
 *
 * Add and edit are one write because the drawer is one form. Tools named here are stored
 * available at the tier given: an admin looking at a tool in the drawer is the review that
 * `UC-54.2-06` holds a newly discovered tool for.
 */
export async function saveConnector(
  input: Omit<SaveConnectorInput, "credential"> & { nameEn: string; nameAr: string; credential?: StoredCredential | null },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const values = {
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      catalogEntryId: input.catalogueId ?? null,
      transport: input.transport,
      serverUrl: input.url || null,
      command: input.command || null,
      authType: input.authType,
      ...secretOf(input.credential),
      defaultTierForNewTools: input.defaultTier,
      isEnabled: input.enabled,
      status: input.enabled ? "Connected" : "Disabled",
      updatedAt: new Date(),
      updatedBy: personId,
    };

    let connectorId: string;
    if (input.version === undefined) {
      const [row] = await tx
        .insert(s.connector)
        .values({ ...values, code: input.code, createdBy: personId })
        .returning({ id: s.connector.id });
      connectorId = row.id;
    } else {
      const rows = await tx
        .update(s.connector)
        .set(values)
        .where(and(eq(s.connector.code, input.code), eq(s.connector.version, input.version)))
        .returning({ id: s.connector.id });
      assertWritten(rows, "Connector");
      connectorId = rows[0].id;
    }

    const existing = await tx
      .select({ id: s.connectorTool.id, name: s.connectorTool.name })
      .from(s.connectorTool)
      .where(eq(s.connectorTool.connectorId, connectorId));
    const byName = new Map(existing.map((tool) => [tool.name, tool.id]));

    for (const tool of input.tools) {
      const id = byName.get(tool.name);
      if (id) {
        await tx
          .update(s.connectorTool)
          .set({ tier: tool.tier, isAvailable: true, updatedAt: new Date(), updatedBy: personId })
          .where(eq(s.connectorTool.id, id));
        continue;
      }
      await tx.insert(s.connectorTool).values({
        connectorId,
        name: tool.name,
        titleEn: tool.name,
        titleAr: tool.name,
        descriptionEn: tool.description,
        tier: tool.tier,
        createdBy: personId,
        updatedBy: personId,
      });
    }

    const named = new Set(input.tools.map((tool) => tool.name));
    const gone = existing.filter((tool) => !named.has(tool.name)).map((tool) => tool.id);
    if (gone.length) {
      // A tool the drawer no longer lists is one the server stopped offering; the modes
      // agents set for it go with it.
      await tx.delete(s.agentToolMode).where(inArray(s.agentToolMode.connectorToolId, gone));
      await tx.delete(s.connectorTool).where(inArray(s.connectorTool.id, gone));
    }

  });
}

/** The catalogue entry a connector is saved from, whose names fill any the save leaves empty. */
export async function readCatalogueEntry(id: string): Promise<{
  id: string;
  nameEn: string;
  nameAr: string;
  defaultUrl: string | null;
  authType: string;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.connectorCatalogEntry.id,
      nameEn: s.connectorCatalogEntry.nameEn,
      nameAr: s.connectorCatalogEntry.nameAr,
      defaultUrl: s.connectorCatalogEntry.defaultUrl,
      authType: s.connectorCatalogEntry.authType,
    })
    .from(s.connectorCatalogEntry)
    .where(eq(s.connectorCatalogEntry.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * `UC-54.1-09`: writes a REST API connector and one tool per operation.
 *
 * Each tool carries its operation, which is what `openapi-call.ts` builds the request
 * from: method, path, where each parameter goes, and the JSON Schema the model fills in.
 */
export async function saveApiConnector(
  input: {
    code: string;
    nameEn: string;
    nameAr: string;
    serverUrl: string;
    authType: string;
    credential?: StoredCredential | null;
    defaultTier: string;
    enabled: boolean;
    operations: { operation: Operation; tier: string }[];
  },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const [created] = await tx
      .insert(s.connector)
      .values({
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        transport: "OpenApi",
        serverUrl: input.serverUrl,
        authType: input.authType,
        ...secretOf(input.credential),
        defaultTierForNewTools: input.defaultTier,
        isEnabled: input.enabled,
        status: input.enabled ? "Connected" : "Disabled",
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.connector.id });

    await tx.insert(s.connectorTool).values(
      input.operations.map(({ operation, tier }) => ({
        connectorId: created.id,
        name: operation.name,
        titleEn: operation.name,
        titleAr: operation.name,
        descriptionEn: `${operation.method.toUpperCase()} ${operation.path} — ${operation.description}`,
        readOnlyHint: operation.readOnly,
        tier,
        operation: operation as unknown as Record<string, unknown>,
        createdBy: personId,
        updatedBy: personId,
      })),
    );

  });
}

/** One `OpenApi` connector and one of its operations, as a call needs them. */
export type OpenApiTarget = {
  code: string;
  /** The operation's tool name, as `code/toolName` is called. */
  toolName: string;
  serverUrl: string;
  authType: string;
  /** The stored credential, still encrypted. */
  secretRef: Buffer | null;
  operation: Operation;
  /** The tier stored against the operation, which decides whether a call needs an approval. */
  tier: string;
};

/** Why a `connector/tool` name does not resolve to a callable operation. */
export type OpenApiTargetProblem =
  | "no-connector"
  | "not-openapi"
  | "disabled"
  | "no-server-url"
  | "no-operation"
  | "unavailable";

/**
 * Reads what `openapi-call.ts` needs to issue one request, or says why it cannot.
 *
 * A reason code rather than a message: the words belong beside the caller, in both
 * languages, and a repository has no business writing what a person reads.
 */
export async function openApiTarget(
  connectorCode: string,
  toolName: string,
): Promise<{ target: OpenApiTarget } | { problem: OpenApiTargetProblem }> {
  const [row] = await dbRo()
    .select({
      id: s.connector.id,
      code: s.connector.code,
      serverUrl: s.connector.serverUrl,
      authType: s.connector.authType,
      secretRef: s.connector.secretRef,
      isEnabled: s.connector.isEnabled,
      transport: s.connector.transport,
    })
    .from(s.connector)
    .where(eq(s.connector.code, connectorCode))
    .limit(1);
  if (!row) return { problem: "no-connector" };
  if (row.transport !== "OpenApi") return { problem: "not-openapi" };
  if (!row.isEnabled) return { problem: "disabled" };
  if (!row.serverUrl) return { problem: "no-server-url" };

  const [tool] = await dbRo()
    .select({ operation: s.connectorTool.operation, isAvailable: s.connectorTool.isAvailable, tier: s.connectorTool.tier })
    .from(s.connectorTool)
    .where(and(eq(s.connectorTool.connectorId, row.id), eq(s.connectorTool.name, toolName)))
    .limit(1);
  if (!tool?.operation) return { problem: "no-operation" };
  if (!tool.isAvailable) return { problem: "unavailable" };

  return {
    target: {
      code: row.code,
      toolName,
      serverUrl: row.serverUrl,
      authType: row.authType,
      secretRef: row.secretRef,
      operation: tool.operation as unknown as Operation,
      tier: tool.tier,
    },
  };
}

/**
 * The connector tools among a run's granted names (`<connector>/<tool>`), for the platform MCP
 * server to list and call (D223). A disabled connector or an unavailable tool is returned
 * marked, so a call can say why it does not run.
 */
export async function grantedConnectorTools(names: string[]): Promise<
  {
    code: string;
    name: string;
    transport: string;
    description: string | null;
    tier: string;
    operation: Record<string, unknown> | null;
    isEnabled: boolean;
    isAvailable: boolean;
  }[]
> {
  const wanted = names.filter((name) => name.includes("/"));
  if (wanted.length === 0) return [];
  return dbRo()
    .select({
      code: s.connector.code,
      name: s.connectorTool.name,
      transport: s.connector.transport,
      description: s.connectorTool.descriptionEn,
      tier: s.connectorTool.tier,
      operation: s.connectorTool.operation,
      isEnabled: s.connector.isEnabled,
      isAvailable: s.connectorTool.isAvailable,
    })
    .from(s.connectorTool)
    .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
    .where(inArray(sql`${s.connector.code} || '/' || ${s.connectorTool.name}`, wanted))
    .orderBy(asc(s.connector.code), asc(s.connectorTool.name));
}

/** The operations one API connector registered, in the order the document declared them. */
export async function apiOperations(connectorCode: string): Promise<Operation[]> {
  const rows = await dbRo()
    .select({ operation: s.connectorTool.operation })
    .from(s.connectorTool)
    .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
    .where(and(eq(s.connector.code, connectorCode), eq(s.connector.transport, "OpenApi")))
    .orderBy(asc(s.connectorTool.name));
  return rows.map((row) => row.operation as unknown as Operation).filter(Boolean);
}

/**
 * The connectors the runtime serves, each with its credential still encrypted, for the
 * headers `discovery-service.ts` builds from it (D296). The runtime replaces rather than
 * merges, so any push has to carry the whole set: sending one connector on its own would leave
 * every other unreachable until the next save.
 */
export async function runtimeConnectors(): Promise<{ connector: RuntimeConnector; credential: { code: string; serverUrl: string; authType: string; secretRef: Buffer | null } }[]> {
  const rows = await dbRo()
    .select({
      code: s.connector.code,
      nameEn: s.connector.nameEn,
      transport: s.connector.transport,
      url: s.connector.serverUrl,
      command: s.connector.command,
      authType: s.connector.authType,
      secretRef: s.connector.secretRef,
      enabled: s.connector.isEnabled,
    })
    .from(s.connector)
    .where(eq(s.connector.isEnabled, true))
    .orderBy(asc(s.connector.code));

  // An `OpenApi` connector is not handed to the runtime at all: this application issues
  // its calls, because the credential is stored here. Sending it would ask the runtime to
  // speak MCP to a REST API.
  // The Platform connector's tools are the platform's own catalogue, served by its MCP
  // server rather than by the runtime (D228).
  // D372: a stdio connector with no command cannot start, and the runtime refuses the whole
  // set for one, leaving every other connector unreachable. Saving refuses such a connector;
  // only a seed stored one, so it is held back here rather than sent.
  return rows
    .filter((row) => row.transport !== "OpenApi" && row.url !== "internal://platform")
    .filter((row) => row.transport !== "Stdio" || Boolean(row.command?.trim()))
    .map((row) => ({
      connector: {
        connector_id: row.code,
        name: row.nameEn,
        transport: row.transport === "Stdio" ? ("stdio" as const) : ("http" as const),
        url: row.url ?? "",
        command: row.command ? splitCommand(row.command) : [],
        enabled: row.enabled,
      },
      credential: { code: row.code, serverUrl: row.url ?? "", authType: row.authType, secretRef: row.secretRef },
    }));
}
