import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import { clientKeyMatches, newClientKey } from "@/lib/crypto";
import type { Client, ClientDetail, ClientKey } from "./types";

/** The only module in `integrations` that touches Drizzle. */

const keyCount = sql<number>`(select count(*) from gov.client_key k where k.client_id = ${outer(s.integrationClient.id)})::int`;

const lastUsed = sql<Date | null>`(
  select max(k.last_used_at) from gov.client_key k where k.client_id = ${s.integrationClient.id}
)`;

/** Every client by English name, with its permissions, agent codes, key count, last key use and exposure switches. */
export async function listClients(): Promise<Client[]> {
  const rows = await dbRo()
    .select({
      id: s.integrationClient.id,
      code: s.integrationClient.clientId,
      n: s.integrationClient.nameEn,
      nAr: s.integrationClient.nameAr,
      own: s.integrationClient.ownerPersonId,
      st: s.integrationClient.status,
      keys: keyCount,
      lastUsedAt: lastUsed,
      mcp: sql<boolean>`coalesce((select e.is_enabled from gov.client_mcp_exposure e where e.client_id = ${outer(s.integrationClient.id)}), false)`,
      agui: sql<boolean>`coalesce((select e.is_enabled from gov.client_agui_exposure e where e.client_id = ${outer(s.integrationClient.id)}), false)`,
    })
    .from(s.integrationClient)
    .orderBy(asc(s.integrationClient.nameEn));

  const ids = rows.map((row) => row.id);
  const permissions = ids.length
    ? await dbRo()
        .select({ clientId: s.clientPermission.clientId, permission: s.clientPermission.permission })
        .from(s.clientPermission)
        .where(inArray(s.clientPermission.clientId, ids))
    : [];
  const agents = ids.length
    ? await dbRo()
        .select({ clientId: s.clientAgent.clientId, code: s.agent.code })
        .from(s.clientAgent)
        .innerJoin(s.agent, eq(s.agent.id, s.clientAgent.agentId))
        .where(inArray(s.clientAgent.clientId, ids))
    : [];

  return rows.map((row) => ({
    id: row.code,
    n: row.n,
    nAr: row.nAr,
    own: row.own ?? "",
    perms: permissions.filter((permission) => permission.clientId === row.id).map((permission) => permission.permission),
    agents: agents.filter((agent) => agent.clientId === row.id).map((agent) => agent.code),
    keys: row.keys,
    mcp: row.mcp,
    agui: row.agui,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    st: row.st,
  }));
}

/**
 * Each client's keys (newest first), MCP exposure and AG-UI exposure, keyed by client code. A key
 * past its expiry reads Expired; a client with no exposure row reads disabled.
 */
export async function readDetails(): Promise<Record<string, ClientDetail>> {
  const clients = await dbRo()
    .select({ id: s.integrationClient.id, code: s.integrationClient.clientId })
    .from(s.integrationClient);
  const ids = clients.map((client) => client.id);
  if (ids.length === 0) return {};

  const keys = await dbRo()
    .select({
      clientId: s.clientKey.clientId,
      id: s.clientKey.id,
      name: s.clientKey.name,
      prefix: s.clientKey.prefix,
      lastUsedAt: s.clientKey.lastUsedAt,
      expiresAt: s.clientKey.expiresAt,
      status: s.clientKey.status,
      expired: sql<boolean>`${s.clientKey.expiresAt} is not null and ${s.clientKey.expiresAt} < now()`,
    })
    .from(s.clientKey)
    .where(inArray(s.clientKey.clientId, ids))
    .orderBy(desc(s.clientKey.createdAt));

  const mcp = await dbRo().select().from(s.clientMcpExposure).where(inArray(s.clientMcpExposure.clientId, ids));
  const agui = await dbRo().select().from(s.clientAguiExposure).where(inArray(s.clientAguiExposure.clientId, ids));

  return Object.fromEntries(
    clients.map((client) => {
      const exposure = mcp.find((row) => row.clientId === client.id);
      const stream = agui.find((row) => row.clientId === client.id);
      return [
        client.code,
        {
          keys: keys
            .filter((key) => key.clientId === client.id)
            .map<ClientKey>((key) => ({
              id: key.id,
              name: key.name,
              prefix: key.prefix,
              lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
              expiresAt: key.expiresAt?.toISOString() ?? null,
              status: key.status === "Revoked" ? "Revoked" : key.expired ? "Expired" : "Active",
            })),
          mcp: {
            enabled: exposure?.isEnabled ?? false,
            authType: exposure?.authType ?? "ApiKey",
            exposedTools: exposure?.exposedTools ?? [],
            lastTestAt: exposure?.lastTestAt?.toISOString() ?? null,
            lastTestResult: exposure?.lastTestResult ?? null,
          },
          agui: {
            enabled: stream?.isEnabled ?? false,
            allowedEvents: stream?.allowedEvents ?? [],
            allowedOrigins: stream?.allowedOrigins ?? [],
          },
        },
      ];
    }),
  );
}

/** Inserts an active client with its permissions and disabled MCP and AG-UI exposures, in one transaction. */
export async function createClient(
  input: { clientId: string; nameEn: string; nameAr: string; ownerPersonId: string; permissions: string[] },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const [created] = await tx
      .insert(s.integrationClient)
      .values({
        clientId: input.clientId,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        ownerPersonId: input.ownerPersonId,
        status: "Active",
        allAgents: false,
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.integrationClient.id });
    if (input.permissions.length > 0) {
      await tx.insert(s.clientPermission).values(
        input.permissions.map((permission) => ({ clientId: created.id, permission, createdBy: personId, updatedBy: personId })),
      );
    }
    await tx.insert(s.clientMcpExposure).values({ clientId: created.id, isEnabled: false, authType: "ApiKey", exposedTools: [], createdBy: personId, updatedBy: personId });
    await tx.insert(s.clientAguiExposure).values({ clientId: created.id, isEnabled: false, allowedEvents: [], allowedOrigins: [], createdBy: personId, updatedBy: personId });
  });
}

/**
 * Requirement 29 and acceptance 37: the secret is generated here, returned once, and
 * stored only as a prefix and a SHA-256 hash. Nothing can read it back afterwards.
 */
export async function createKey(clientId: string, name: string, expiresInDays: number | null, personId: string): Promise<string> {
  const [client] = await dbRo().select({ id: s.integrationClient.id }).from(s.integrationClient).where(eq(s.integrationClient.clientId, clientId)).limit(1);
  if (!client) throw new Error(`No client ${clientId}.`);
  const key = newClientKey(`awp_${clientId}`);
  await db().insert(s.clientKey).values({
    clientId: client.id,
    name,
    prefix: key.visiblePrefix,
    secretHash: key.hash,
    expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000),
    status: "Active",
    createdBy: personId,
    updatedBy: personId,
  });
  return key.secret;
}

/** Marks one key Revoked. */
export async function revokeKey(keyId: string, personId: string): Promise<void> {
  await db().update(s.clientKey).set({ status: "Revoked", updatedAt: new Date(), updatedBy: personId }).where(eq(s.clientKey.id, keyId));
}


/* ------------------------------------- S-77: rotation, exposures and authentication */

/**
 * `UC-77.1-02`: a new secret for the same key name, with the old one given a grace period.
 *
 * The old key keeps working until the grace runs out, which is what lets a caller redeploy
 * without a window where neither key works.
 */
export async function rotateKey(keyId: string, graceHours: number, personId: string): Promise<string> {
  return db().transaction(async (tx) => {
    const [existing] = await tx
      .select({ clientId: s.clientKey.clientId, name: s.clientKey.name, expiresAt: s.clientKey.expiresAt, createdAt: s.clientKey.createdAt })
      .from(s.clientKey)
      .where(eq(s.clientKey.id, keyId))
      .limit(1);
    if (!existing) throw new Error("That key no longer exists.");

    const [client] = await tx.select({ code: s.integrationClient.clientId }).from(s.integrationClient).where(eq(s.integrationClient.id, existing.clientId)).limit(1);
    const key = newClientKey(`awp_${client?.code ?? "client"}`);

    const grace = new Date(Date.now() + graceHours * 3_600_000);
    await tx
      .update(s.clientKey)
      .set({ expiresAt: existing.expiresAt && existing.expiresAt < grace ? existing.expiresAt : grace, updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.clientKey.id, keyId));

    // The new key keeps whatever lifetime the old one had, measured from now.
    const lifetime = existing.expiresAt ? existing.expiresAt.getTime() - existing.createdAt.getTime() : null;
    await tx.insert(s.clientKey).values({
      clientId: existing.clientId,
      name: existing.name,
      prefix: key.visiblePrefix,
      secretHash: key.hash,
      expiresAt: lifetime === null ? null : new Date(Date.now() + lifetime),
      status: "Active",
      createdBy: personId,
      updatedBy: personId,
    });
    return key.secret;
  });
}

/** Sets a client's status by its code. */
export async function setClientStatus(clientCode: string, status: string, personId: string): Promise<void> {
  await db()
    .update(s.integrationClient)
    .set({ status, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.integrationClient.clientId, clientCode));
}

/** The client and everything under it — its keys, permissions, and agent and tool exposure. */
export async function deleteClient(clientCode: string): Promise<void> {
  await db().delete(s.integrationClient).where(eq(s.integrationClient.clientId, clientCode));
}

/** `UC-77.4-01`: the client's permissions, replaced as a set. */
export async function setClientPermissions(clientCode: string, permissions: string[], personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [client] = await tx.select({ id: s.integrationClient.id }).from(s.integrationClient).where(eq(s.integrationClient.clientId, clientCode)).limit(1);
    if (!client) throw new Error(`No client ${clientCode}.`);
    await tx.delete(s.clientPermission).where(eq(s.clientPermission.clientId, client.id));
    if (permissions.length > 0) {
      await tx.insert(s.clientPermission).values(
        permissions.map((permission) => ({ clientId: client.id, permission, createdBy: personId, updatedBy: personId })),
      );
    }
  });
}

/** The agents a client may run, replaced as a set. */
export async function setClientAgents(clientCode: string, agentCodes: string[], personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [client] = await tx.select({ id: s.integrationClient.id }).from(s.integrationClient).where(eq(s.integrationClient.clientId, clientCode)).limit(1);
    if (!client) throw new Error(`No client ${clientCode}.`);
    await tx.delete(s.clientAgent).where(eq(s.clientAgent.clientId, client.id));
    if (agentCodes.length === 0) return;
    const agents = await tx.select({ id: s.agent.id, code: s.agent.code }).from(s.agent).where(inArray(s.agent.code, agentCodes));
    await tx.insert(s.clientAgent).values(
      agents.map((agent) => ({ clientId: client.id, agentId: agent.id, createdBy: personId, updatedBy: personId })),
    );
  });
}

/** Replaces a client's MCP exposure settings; throws when the client does not exist. */
export async function setMcpExposure(
  clientCode: string,
  input: { enabled: boolean; authType: string; exposedTools: string[] },
  personId: string,
): Promise<void> {
  const [client] = await dbRo().select({ id: s.integrationClient.id }).from(s.integrationClient).where(eq(s.integrationClient.clientId, clientCode)).limit(1);
  if (!client) throw new Error(`No client ${clientCode}.`);
  await db()
    .update(s.clientMcpExposure)
    .set({ isEnabled: input.enabled, authType: input.authType, exposedTools: input.exposedTools, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.clientMcpExposure.clientId, client.id));
}

/** Replaces a client's AG-UI exposure settings; throws when the client does not exist. */
export async function setAguiExposure(
  clientCode: string,
  input: { enabled: boolean; allowedEvents: string[]; allowedOrigins: string[] },
  personId: string,
): Promise<void> {
  const [client] = await dbRo().select({ id: s.integrationClient.id }).from(s.integrationClient).where(eq(s.integrationClient.clientId, clientCode)).limit(1);
  if (!client) throw new Error(`No client ${clientCode}.`);
  await db()
    .update(s.clientAguiExposure)
    .set({ isEnabled: input.enabled, allowedEvents: input.allowedEvents, allowedOrigins: input.allowedOrigins, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.clientAguiExposure.clientId, client.id));
}

/** Stores the time and result line of a client's MCP test; does nothing for an unknown client. */
export async function recordMcpTest(clientCode: string, result: string, personId: string): Promise<void> {
  const [client] = await dbRo().select({ id: s.integrationClient.id }).from(s.integrationClient).where(eq(s.integrationClient.clientId, clientCode)).limit(1);
  if (!client) return;
  await db()
    .update(s.clientMcpExposure)
    .set({ lastTestAt: new Date(), lastTestResult: result, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.clientMcpExposure.clientId, client.id));
}

/** What a presented key turns out to be, or why it is refused. */
export type ClientCaller = {
  clientId: string;
  clientCode: string;
  ownerPersonId: string | null;
  permissions: string[];
  agentCodes: string[];
  allAgents: boolean;
  mcp: { enabled: boolean; exposedTools: string[] };
  agui: { enabled: boolean; allowedEvents: string[]; allowedOrigins: string[] };
};

/**
 * Resolves an API key to the client it belongs to.
 *
 * `UC-77.1-03` a revoked key, `UC-77.1-04` one past its expiry and `UC-77.5-01` a client
 * that has been deactivated all return null, so there is one place that decides whether a
 * key works at all.
 */
export async function authenticateClientKey(secret: string): Promise<ClientCaller | null> {
  if (secret.length < 8) return null;

  const [key] = await dbRo()
    .select({
      id: s.clientKey.id,
      clientId: s.clientKey.clientId,
      secretHash: s.clientKey.secretHash,
      status: s.clientKey.status,
      expiresAt: s.clientKey.expiresAt,
      clientCode: s.integrationClient.clientId,
      clientStatus: s.integrationClient.status,
      ownerPersonId: s.integrationClient.ownerPersonId,
      allAgents: s.integrationClient.allAgents,
    })
    .from(s.clientKey)
    .innerJoin(s.integrationClient, eq(s.integrationClient.id, s.clientKey.clientId))
    // Matched by what the secret starts with rather than by splitting it: the body is
    // base64url, so it may itself contain the separator.
    .where(sql`left(${secret}, length(${s.clientKey.prefix})) = ${s.clientKey.prefix}`)
    .limit(1);
  if (!key) return null;
  if (!clientKeyMatches(secret, key.secretHash)) return null;
  if (key.status !== "Active") return null;
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
  if (key.clientStatus !== "Active") return null;

  await db().update(s.clientKey).set({ lastUsedAt: new Date() }).where(eq(s.clientKey.id, key.id));

  const [permissions, agents, mcp, agui] = await Promise.all([
    dbRo().select({ permission: s.clientPermission.permission }).from(s.clientPermission).where(eq(s.clientPermission.clientId, key.clientId)),
    dbRo()
      .select({ code: s.agent.code })
      .from(s.clientAgent)
      .innerJoin(s.agent, eq(s.agent.id, s.clientAgent.agentId))
      .where(eq(s.clientAgent.clientId, key.clientId)),
    dbRo().select().from(s.clientMcpExposure).where(eq(s.clientMcpExposure.clientId, key.clientId)).limit(1),
    dbRo().select().from(s.clientAguiExposure).where(eq(s.clientAguiExposure.clientId, key.clientId)).limit(1),
  ]);

  return {
    clientId: key.clientId,
    clientCode: key.clientCode,
    ownerPersonId: key.ownerPersonId,
    permissions: permissions.map((row) => row.permission),
    agentCodes: agents.map((row) => row.code),
    allAgents: key.allAgents,
    mcp: { enabled: mcp[0]?.isEnabled ?? false, exposedTools: mcp[0]?.exposedTools ?? [] },
    agui: {
      enabled: agui[0]?.isEnabled ?? false,
      allowedEvents: agui[0]?.allowedEvents ?? [],
      allowedOrigins: agui[0]?.allowedOrigins ?? [],
    },
  };
}
