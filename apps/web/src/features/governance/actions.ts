"use server";

import { revalidatePath } from "next/cache";

import { type FieldNames, inputRefusal } from "@/lib/input-refusal";
import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import { BrandingRejected } from "@/lib/branding";
import {
  auditFilterInput,
  brandColourInput,
  brandingAssetInput,
  brandingKindInput,
  generalSettingsInput,
  pauseAgentsInput,
  mailSettingsInput,
  mailTemplateInput,
  testEmailInput,
} from "./schema";
import * as notifications from "./notification-service";
import * as service from "./service";

/** S-78: pausing and resuming every agent. */

export async function setAgentsPaused(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const { paused } = pauseAgentsInput.parse(input);
    await service.pauseAgents(paused);
  });
  revalidatePath("/system");
  revalidatePath("/agents");
  revalidatePath("/dashboard");
  return outcome;
}

/** D240: the platform's mail server. */
export async function saveMailSettings(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.saveMailSettings(mailSettingsInput.parse(input)));
  revalidatePath("/settings");
  return outcome;
}

/** D247: one email template, from its edit popup. */
export async function saveMailTemplate(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.saveMailTemplate(mailTemplateInput.parse(input)));
  revalidatePath("/settings");
  return outcome;
}

/**
 * `UC-75.2-04`: stores the brand colour through `service.saveBrandColour`, which refuses a colour
 * below AA contrast, and re-renders the whole layout. Returns the outcome or the refusal.
 */
export async function saveBrandColour(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const { colour } = brandColourInput.parse(input);
    await service.saveBrandColour(colour);
  });
  // The shell applies the colour on every screen.
  revalidatePath("/", "layout");
  return outcome;
}

/**
 * `UC-75.2-01` and `UC-75.2-02`: store a logo or the favicon.
 *
 * A rejection comes back as a message the form shows rather than an unhandled error, because
 * the person needs the required size, not a stack trace (`COM-12`).
 */
export async function saveBrandingAsset(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const { kind, dataUrl } = brandingAssetInput.parse(input);
  try {
    await service.saveBrandingAsset(kind, dataUrl);
  } catch (error) {
    if (error instanceof BrandingRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  // The shell on every screen draws the logo, so the whole layout is re-rendered.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** `UC-75.2-01`: remove an uploaded logo or favicon, so the platform's own is used again. */
export async function removeBrandingAsset(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const { kind } = brandingKindInput.parse(input);
  await service.removeBrandingAsset(kind);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** What the General tab's fields are called, for a refusal that names the field instead of a thrown 500. */
const GENERAL_FIELDS: FieldNames = {
  nameEn: ["The English name", "الاسم بالإنجليزية"],
  nameAr: ["The Arabic name", "الاسم بالعربية"],
  timeZone: ["The time zone", "المنطقة الزمنية"],
  languages: ["The languages", "اللغات"],
};

/** `UC-75.1-01`: save the organisation's general settings. */
export async function saveGeneralSettings(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const parsed = generalSettingsInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, GENERAL_FIELDS);
  const values = parsed.data;
  try {
    await service.saveGeneralSettings({ ...values, languages: [...values.languages] });
  } catch (error) {
    if (error instanceof service.SettingsRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * `UC-73.1-03`: export the filtered audit entries as CSV, and audit the export.
 *
 * The screen's chips are translated into the repository's filter here, so the export is
 * taken under exactly the filter the auditor was looking at.
 */
export async function exportAudit(input: unknown): Promise<string> {
  const { actor, period, action, limit } = auditFilterInput.parse(input);
  // "Any time" has no bound, which the repository expresses by the field being absent.
  const DAYS: Record<string, number | undefined> = { all: undefined, "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
  const sinceDays = DAYS[period ?? "all"];
  return service.exportAudit({
    actor: actor === "all" ? undefined : actor,
    action: action || undefined,
    sinceDays,
    limit,
  });
}

/** Settings → Email (D240): a test send through the configured server. */
export async function sendTestEmail(input: unknown): Promise<{ sent: true } | { sent: false; reason: string }> {
  return notifications.sendTestEmail(testEmailInput.parse(input).to);
}

/** Settings → Email: connects to the saved mail server and signs in, sending nothing. */
export async function testSavedMailSettings(): Promise<{ ok: true } | { ok: false; reason: string }> {
  return notifications.testSavedMailSettings();
}

/** Settings → Email (D240): what was sent lately, and why not. */
export async function loadRecentNotifications() {
  return (await notifications.recentNotifications()).map((notice) => ({
    ...notice,
    createdAt: notice.createdAt.toISOString(),
    sentAt: notice.sentAt?.toISOString() ?? null,
  }));
}
