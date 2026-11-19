"use server";

import { revalidatePath } from "next/cache";

import { type FieldNames, inputRefusal } from "@/lib/input-refusal";
import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import {
  connectOAuthInput,
  connectorCodeInput,
  importApiConnectorInput,
  saveConnectorInput,
  setConnectorEnabledInput,
  setToolTierInput,
  testConnectorInput,
} from "./schema";
import * as service from "./service";

/** S-54 mutations. */

/** What the drawer's fields are called, for a refusal that names the field (`UC-54.1-06`). */
const FIELDS: FieldNames = {
  code: ["The code", "الرمز"],
  nameEn: ["The English name", "الاسم بالإنجليزية"],
  nameAr: ["The Arabic name", "الاسم بالعربية"],
  url: ["The server URL", "عنوان الخادم"],
  command: ["The command", "الأمر"],
};

export async function setConnectorEnabled(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setConnectorEnabled(setConnectorEnabledInput.parse(input)));
  revalidatePath("/connectors");
  return outcome;
}

/**
 * Sets a connector tool's tier through `service.setToolTier` and refreshes `/connectors`; returns
 * the outcome or the refusal.
 */
export async function setToolTier(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setToolTier(setToolTierInput.parse(input)));
  revalidatePath("/connectors");
  return outcome;
}

/** `UC-54.1-02` and `UC-54.1-05`: shake hands and list the tools, or say why not. */
export async function testConnector(
  input: unknown,
): Promise<
  | { ok: true; tools: { name: string; description: string; tier: string }[] }
  | { ok: false; message: string; messageAr: string }
> {
  const values = testConnectorInput.parse(input);
  try {
    const { tools } = await service.testConnector(values);
    return { ok: true, tools };
  } catch (error) {
    if (error instanceof service.ConnectorRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-54.1-02` for a saved REST API connector: reach it and record its status. */
export async function testApiConnector(
  input: unknown,
): Promise<{ ok: true; httpStatus: number; tools: { name: string; tier: string }[] } | { ok: false; message: string; messageAr: string }> {
  const { connectorCode } = connectorCodeInput.parse(input);
  try {
    const result = await service.testApiConnector(connectorCode);
    revalidatePath("/connectors");
    return { ok: true, ...result };
  } catch (error) {
    revalidatePath("/connectors");
    if (error instanceof service.ConnectorRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-54.2-06`: re-read the server's tool list and report what changed. */
export async function refreshConnectorTools(
  input: unknown,
): Promise<{ ok: true; added: string[]; removed: string[] } | { ok: false; message: string; messageAr: string }> {
  const { connectorCode } = connectorCodeInput.parse(input);
  try {
    const { added, removed } = await service.refreshConnectorTools(connectorCode);
    revalidatePath("/connectors");
    return { ok: true, added, removed };
  } catch (error) {
    // A refresh that failed recorded the connector as Error, so the page reads it again.
    revalidatePath("/connectors");
    if (error instanceof service.ConnectorRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-54.2-05`: remove a connector, naming the agents it leaves without tools. */
export async function removeConnector(
  input: unknown,
): Promise<{ ok: true; affectedAgents: string[] } | { ok: false; message: string; messageAr: string }> {
  const { connectorCode, dryRun } = connectorCodeInput.parse(input);
  try {
    const { affectedAgents } = await service.removeConnector(connectorCode, dryRun);
    if (!dryRun) revalidatePath("/connectors");
    return { ok: true, affectedAgents };
  } catch (error) {
    if (error instanceof service.ConnectorRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-54.1-03` and `UC-54.2-01`: add or edit a connector. */
export async function saveConnector(
  input: unknown,
): Promise<{ ok: true; code: string } | { ok: false; message: string; messageAr: string }> {
  const parsed = saveConnectorInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    const { code } = await service.saveConnector(parsed.data);
    revalidatePath("/connectors");
    return { ok: true, code };
  } catch (error) {
    if (error instanceof service.ConnectorRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    // `COM-10`: a concurrent edit reaches the error boundary by its digest, as everywhere.
    throw error;
  }
}

/** `UC-54.1-09`: register a REST API as a connector from its OpenAPI or Swagger document. */
export async function importApiConnector(input: unknown): Promise<Outcome<service.ImportOutcome>> {
  const outcome = await attempt(() => service.importApiConnector(importApiConnectorInput.parse(input)));
  revalidatePath("/connectors");
  return outcome;
}

/** D296: start connecting an OAuth connector; the browser goes to the returned address. */
export async function connectOAuth(input: unknown): Promise<Outcome<{ authorizationUrl: string }>> {
  return attempt(async () => ({ authorizationUrl: await service.beginOAuthConnect(connectOAuthInput.parse(input).connectorCode) }));
}
