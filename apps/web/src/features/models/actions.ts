"use server";

import { revalidatePath } from "next/cache";

import { type FieldNames, inputRefusal } from "@/lib/input-refusal";
import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import {
  addCloudProviderInput,
  addCustomProviderInput,
  connectionIdInput,
  discoverModelsInput,
  providerIdInput,
  saveConnectionInput,
  routeAliasInput,
  saveRouteInput,
  setProviderActiveInput,
  testConnectionDraftInput,
} from "./schema";
import * as service from "./service";

/** S-59 and S-60 mutations. */

/**
 * What the typed fields are called in a refusal. A value the person typed that the schema
 * refuses comes back as a message, not as a thrown error that would replace the screen.
 */
const FIELDS: FieldNames = {
  alias: ["The alias", "الاسم المستعار"],
  confidenceThreshold: ["The confidence threshold", "حد الثقة"],
  maxRetries: ["The number of retries", "عدد المحاولات"],
  sttModel: ["The speech-to-text model", "نموذج تحويل الكلام إلى نص"],
  ttsVoice: ["The voice", "الصوت"],
  languages: ["Each language code", "رمز كل لغة"],
  maxCallMinutes: ["The maximum call length in minutes", "الحد الأقصى لمدة المكالمة بالدقائق"],
  outputSchema: ["The output schema", "مخطط المخرجات"],
  name: ["The provider name", "اسم المزود"],
  engine: ["The engine", "المحرك"],
  baseUrl: ["The base URL", "عنوان الخدمة"],
  endpoint: ["The endpoint", "نقطة الاتصال"],
  secret: ["The key", "المفتاح"],
  models: ["The model list", "قائمة النماذج"],
};

export async function setProviderActive(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const { providerId, active } = setProviderActiveInput.parse(input);
    await service.setProviderActive(providerId, active);
  });
  revalidatePath("/models");
  return outcome;
}

/**
 * Saves a provider connection through `service.saveConnection` and refreshes `/models`; returns
 * the outcome or the refusal.
 */
export async function saveConnection(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    await service.saveConnection(saveConnectionInput.parse(input));
  });
  revalidatePath("/models");
  return outcome;
}

/** `UC-60.1-02` … `-08`: save a route, or say why it was refused. */
export async function saveRoute(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const parsed = saveRouteInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    await service.saveRoute(parsed.data);
    revalidatePath("/models");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.ModelsRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-60.1-09`: remove a route, or name what still calls it. */
export async function removeRoute(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string; blockedBy: string[] }> {
  const { alias } = routeAliasInput.parse(input);
  try {
    await service.removeRoute(alias);
    revalidatePath("/models");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.ModelsRejected) {
      return { ok: false, message: error.message, messageAr: error.messageAr, blockedBy: error.blockedBy };
    }
    throw error;
  }
}

/** `UC-59.1-03` and `UC-59.1-08`: the per-model result of a real completion, also stored. */
export async function testConnection(
  input: unknown,
): Promise<
  | { ok: true; results: { model: string; ok: boolean; detail: string }[]; untestable: string | null }
  | { ok: false; message: string; messageAr: string }
> {
  const { connectionId } = connectionIdInput.parse(input);
  try {
    const { results, untestable } = await service.testConnection(connectionId);
    revalidatePath("/models");
    return { ok: true, results, untestable };
  } catch (error) {
    if (error instanceof service.ModelsRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-59.1-03`: test a connection as the editor currently holds it, before it is saved. */
export async function testConnectionDraft(
  input: unknown,
): Promise<
  | { ok: true; results: { model: string; ok: boolean; detail: string }[]; untestable: string | null }
  | { ok: false; message: string; messageAr: string }
> {
  const parsed = testConnectionDraftInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    const { results, untestable } = await service.testConnectionDraft(parsed.data);
    return { ok: true, results, untestable };
  } catch (error) {
    if (error instanceof service.ModelsRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-59.1-05` and `UC-59.1-06`: the engine's models, or why it could not say. */
export async function discoverModels(
  input: unknown,
): Promise<{ ok: true; models: string[] } | { ok: false; message: string; messageAr: string }> {
  const parsed = discoverModelsInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    return { ok: true, models: await service.discoverEngineModels(parsed.data) };
  } catch (error) {
    if (error instanceof service.ModelsRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-59.1-05`: add a custom provider with its first connection. */
export async function addCustomProvider(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const parsed = addCustomProviderInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    await service.addCustomProvider(parsed.data);
    revalidatePath("/models");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.ModelsRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** Add a provider agentgateway already speaks to natively, not only through seed data. */
export async function addCloudProvider(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const parsed = addCloudProviderInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    await service.addCloudProvider(parsed.data);
    revalidatePath("/models");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.ModelsRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-59.1-05`: remove a provider, or name the routes that still use it. */
export async function removeProvider(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string; blockedBy: string[] }> {
  const { providerId } = providerIdInput.parse(input);
  try {
    await service.removeProvider(providerId);
    revalidatePath("/models");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.ModelsRejected) {
      return { ok: false, message: error.message, messageAr: error.messageAr, blockedBy: error.blockedBy };
    }
    throw error;
  }
}

/** `UC-59.1-10`: remove a connection, or name the routes that still use it. */
export async function removeConnection(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string; blockedBy: string[] }> {
  const { connectionId } = connectionIdInput.parse(input);
  try {
    await service.removeConnection(connectionId);
    revalidatePath("/models");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.ModelsRejected) {
      return { ok: false, message: error.message, messageAr: error.messageAr, blockedBy: error.blockedBy };
    }
    throw error;
  }
}
