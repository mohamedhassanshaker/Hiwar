import { audit } from "@/lib/audit";
import { readMailSettings } from "@/db/queries/mail";
import { encrypt } from "@/lib/crypto";
import { sanitizeMailHtml } from "@/lib/mail-html";
import { Rejected } from "@/lib/rejection";
import { assertBrandingAsset, type BrandingKind } from "@/lib/branding";
import { assertAccessibleBrandColour } from "@/lib/contrast";
import type { FeatureKey } from "@/lib/feature-flags";
import { requirePermission, requireSession } from "@/lib/session";
import type { Letterhead } from "@/types/letterhead";
import * as repository from "./repository";
import type { MailSettingsInput, MailTemplateInput } from "./schema";

/**
 * D240: the mail server and the templates. The password is encrypted under `APP_KEK` before
 * it is stored and never read back to a screen; the audit names what moved, not the secret.
 */
export async function saveMailSettings(input: MailSettingsInput): Promise<void> {
  const session = await requirePermission("settings:write");
  const before = await readMailSettings();
  const { password, ...rest } = input;
  const passwordCipher = password === undefined ? before.passwordCipher : password === "" ? null : encrypt(password).toString("base64");
  // The templates are saved one at a time from their own popup (D247).
  await repository.saveMailSettings({ ...rest, passwordCipher, templates: before.templates }, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "settings:write",
    objectType: "Settings",
    objectLabel: "mail",
    detail: { enabled: rest.enabled, host: rest.host, port: rest.port, security: rest.security, passwordChanged: password !== undefined },
  });
}

/** D247: one email template, its HTML bodies sanitised before they are stored. */
export async function saveMailTemplate(input: MailTemplateInput): Promise<void> {
  const session = await requirePermission("settings:write");
  const before = await readMailSettings();
  const template = { ...input.template, bodyEn: sanitizeMailHtml(input.template.bodyEn), bodyAr: sanitizeMailHtml(input.template.bodyAr) };
  await repository.saveMailSettings({ ...before, templates: { ...before.templates, [input.kind]: template } }, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "settings:write",
    objectType: "Settings",
    objectLabel: `mail.templates.${input.kind}`,
    detail: { enabled: template.enabled },
  });
}

/**
 * `UC-75.2-03` and `UC-75.2-04`. The colour reaches buttons, links, active navigation and
 * the embedded widget, so the contrast check runs here and not only on the screen: the
 * screen disables Save, and this refuses a call that never used it (`COM-08`, NFR-18).
 *
 * @throws {ContrastError} when the colour is below WCAG 2.2 AA against white.
 */
export async function saveBrandColour(colour: string): Promise<void> {
  const session = await requirePermission("settings:write");
  assertAccessibleBrandColour(colour);
  await repository.saveBrandColour(colour, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "settings:write",
    objectType: "Settings",
    objectLabel: "branding.brandColour",
    detail: { colour },
  });
}

/**
 * `UC-75.2-01`: store a logo or the favicon. `UC-75.2-02` refuses one of the wrong size,
 * read from the image's own bytes rather than taken from the upload.
 *
 * @throws {BrandingRejected} when the format, the bytes or the size is not acceptable.
 */
export async function saveBrandingAsset(kind: BrandingKind, dataUrl: string): Promise<void> {
  const session = await requirePermission("settings:write");
  const size = assertBrandingAsset(kind, dataUrl);

  await repository.saveBrandingAsset(kind, dataUrl, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "settings:branding",
    objectType: "BrandingAsset",
    objectLabel: kind,
    // The image itself is never audited, only that one of this size was accepted.
    detail: { width: size.width, height: size.height },
  });
}

/** `UC-75.2-01`: drop an uploaded asset, so the platform's own logo or favicon is used again. */
export async function removeBrandingAsset(kind: BrandingKind): Promise<void> {
  const session = await requirePermission("settings:write");
  await repository.deleteBrandingAsset(kind);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "settings:branding",
    objectType: "BrandingAsset",
    objectLabel: kind,
    detail: { removed: true },
  });
}

/** `UC-75.3-01`: switches one feature flag and audits it as `settings:feature_flag`. Requires `settings:write`. */
export async function setFeatureFlag(key: string, enabled: boolean): Promise<void> {
  const session = await requirePermission("settings:write");
  await repository.setFeatureFlag(key, enabled, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "settings:feature_flag",
    objectType: "FeatureFlag",
    objectLabel: key,
    detail: { enabled },
  });
}

/** Thrown when a settings change is refused for a reason the form should show. */
export class SettingsRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "SettingsRejected";
  }
}

/**
 * `UC-75.1-01`: save the organisation's general settings, with history.
 *
 * The history is the settings version, the same record a brand colour writes, so every
 * change to this screen is readable in one place and in order. The audit entry names what
 * moved and what it was before: "saved" is not reviewable on its own, and the previous
 * value is what someone reading the trail after a bad change actually needs.
 *
 * @throws {SettingsRejected} when a chosen calendar does not exist.
 */
export async function saveGeneralSettings(values: {
  nameEn: string;
  nameAr: string;
  timeZone: string;
  languages: string[];
  workingCalendarId: string | null;
  holidayCalendarId: string | null;
}): Promise<void> {
  const session = await requirePermission("settings:write");

  const calendars = await repository.calendarIds();
  for (const chosen of [values.workingCalendarId, values.holidayCalendarId]) {
    if (chosen && !calendars.has(chosen)) {
      throw new SettingsRejected("That calendar no longer exists.", "لم يعد هذا التقويم موجوداً.");
    }
  }

  const before = (await repository.readSettings()).organisation;
  await repository.saveGeneralSettings(values, session.personId);

  // Only what moved, so the trail reads as a change and not as a copy of the form.
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  if (before.nameEn !== values.nameEn) changed.nameEn = { from: before.nameEn, to: values.nameEn };
  if (before.nameAr !== values.nameAr) changed.nameAr = { from: before.nameAr, to: values.nameAr };
  if (before.timeZone !== values.timeZone) changed.timeZone = { from: before.timeZone, to: values.timeZone };
  if (before.languages.join() !== values.languages.join()) {
    changed.languages = { from: before.languages, to: values.languages };
  }

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "settings:write",
    objectType: "Settings",
    objectLabel: "general",
    detail: { changed },
  });
}

/**
 * `UC-75.3-02`: what turning a flag off would stop, for the confirmation to name.
 *
 * Only `embedded-deployments` has a consequence the admin cannot see from the Settings
 * screen — widgets already serving people elsewhere. The others change what the console
 * offers, which is visible the moment the flag flips.
 */
export async function flagConsequences(key: string): Promise<{ key: string; name: string }[]> {
  await requirePermission("settings:read");
  if (key !== "embedded-deployments") return [];
  return repository.liveDeployments();
}

/**
 * The branding every console page renders (`UC-75.2-01`, `UC-75.2-03`).
 *
 * Needs only a session, not `settings:read`: this is what the platform looks like to
 * everyone who signs in, not a setting they administer.
 */
export async function loadBranding() {
  await requireSession();
  return repository.readBranding();
}

/**
 * The logos alone, for the sign-in screens, which render before anyone has signed in, so
 * unlike `loadBranding` this asks for no session: the logo is what the sign-in page shows.
 */
export async function publicLogos(): Promise<{ logoLight: string | null; logoDark: string | null }> {
  const branding = await repository.readBranding();
  return { logoLight: branding.logoLight, logoDark: branding.logoDark };
}

/**
 * The browser-tab icon alone, for the root layout's `<head>`, rendered before anyone has
 * signed in, so it asks for no session either.
 */
export async function faviconUrl(): Promise<string | null> {
  return (await repository.readBranding()).favicon;
}

/**
 * Whether a platform feature is switched on, for the features that depend on one.
 *
 * No permission check: a flag decides what the platform does, not what a person may see of
 * its settings. The caller has already checked its own permission for the screen it is
 * building — `UC-75.3-03`'s reader holds `knowledge:read`, not `settings:read`.
 */
export async function isFeatureEnabled(key: FeatureKey): Promise<boolean> {
  return repository.isFeatureEnabled(key);
}

/**
 * D388: what a report's letterhead carries: the organisation's name, logos and brand colour, and
 * who is preparing the report. Needs only a session, like the branding every console page renders.
 */
export async function loadLetterhead(): Promise<Letterhead> {
  const session = await requireSession();
  const [branding, organisation] = await Promise.all([repository.readBranding(), repository.readOrganisationName()]);
  return {
    logos: { logoLight: branding.logoLight, logoDark: branding.logoDark },
    brandColour: branding.brandColour,
    organisation,
    preparedBy: { en: session.nameEn, ar: session.nameAr },
  };
}
