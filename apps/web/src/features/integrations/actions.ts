"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";
import {
  clientCodeInput,
  createClientInput,
  createKeyInput,
  revokeKeyInput,
  rotateKeyInput,
  setAguiInput,
  setClientStatusInput,
  setMcpInput,
  setPermissionsInput,
} from "./schema";
import * as service from "./service";

/**
 * S-76 and S-77 mutations.
 *
 * Each returns an outcome: a duplicate client id, a client left with no permission and a
 * key that cannot be rotated are all things the screen tells the person about.
 */

export async function createClient(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.createClient(createClientInput.parse(input)));
  revalidatePath("/integrations");
  return outcome;
}

/** Issues a key for a client; the outcome carries the secret, which is shown only this once. */
export async function createKey(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.createKey(createKeyInput.parse(input)));
  revalidatePath("/integrations");
  return outcome;
}

/** Revokes one key, which stops working at once. */
export async function revokeKey(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.revokeKey(revokeKeyInput.parse(input).keyId));
  revalidatePath("/integrations");
  return outcome;
}

/** Issues a new secret for a key and gives the old one a grace period; the outcome carries the secret. */
export async function rotateKey(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.rotateKey(rotateKeyInput.parse(input)));
  revalidatePath("/integrations");
  return outcome;
}

/** Activates or deactivates a client; deactivating stops all of its keys. */
export async function setClientStatus(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setClientStatus(setClientStatusInput.parse(input)));
  revalidatePath("/integrations");
  return outcome;
}

/** Deletes a client with its keys, permissions and exposures; the page is refreshed only on success. */
export async function deleteClient(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.deleteClient(clientCodeInput.parse(input).clientCode));
  if (outcome.ok) revalidatePath("/integrations");
  return outcome;
}

/** Replaces a client's permissions and the agents it may run; refused when no permission is left. */
export async function setPermissions(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setPermissions(setPermissionsInput.parse(input)));
  revalidatePath("/integrations");
  return outcome;
}

/** Saves a client's MCP exposure: enabled, authentication type and exposed tools. */
export async function setMcp(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setMcp(setMcpInput.parse(input)));
  revalidatePath("/integrations");
  return outcome;
}

/** Saves a client's AG-UI exposure: enabled, allowed events and allowed origins. */
export async function setAgui(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setAgui(setAguiInput.parse(input)));
  revalidatePath("/integrations");
  return outcome;
}

/** Lists the platform's MCP tools with the given key and returns the recorded result line. */
export async function testMcpConnection(clientCode: string, secret: string): Promise<Outcome<string>> {
  return attempt(() => service.testMcpConnection(clientCode, secret));
}
