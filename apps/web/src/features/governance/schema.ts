import { z } from "zod";

import { MAIL_TEMPLATE_KINDS } from "@/db/schema/enums";
import { BRANDING_KINDS } from "@/lib/branding";

/** Requirement 32: the governance action inputs. */

export const pauseAgentsInput = z.object({ paused: z.boolean() });

export const brandColourInput = z.object({ colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour.") });

/**
 * `UC-75.2-01` and `UC-75.2-02`: a branding upload. The size rule is not here because it
 * lives in the bytes, not in the shape: `lib/branding.ts` reads it and the service applies it.
 */
export const brandingAssetInput = z.object({
  kind: z.enum(BRANDING_KINDS),
  dataUrl: z.string().min(1),
});

export const brandingKindInput = z.object({ kind: z.enum(BRANDING_KINDS) });

export const featureFlagInput = z.object({ key: z.string().min(1), enabled: z.boolean() });

/**
 * `UC-75.1-01`: the organisation's general settings.
 *
 * The time zone is validated against the platform's own IANA database rather than a list
 * kept here, so a zone this runtime cannot resolve is refused before it reaches a calendar
 * calculation. Calendars drive SLA and schedule arithmetic (`UC-75.1-01`), and a zone the
 * server cannot read would make every due date silently wrong.
 */
export const generalSettingsInput = z.object({
  nameEn: z.string().trim().min(1, "An English name is required.").max(200),
  nameAr: z.string().trim().min(1, "An Arabic name is required.").max(200),
  timeZone: z
    .string()
    .trim()
    .min(1)
    .refine(isKnownTimeZone, "That is not a time zone this platform can resolve."),
  languages: z.array(z.enum(["en", "ar"])).min(1, "At least one language is required."),
  workingCalendarId: z.uuid().nullable().default(null),
  holidayCalendarId: z.uuid().nullable().default(null),
});

/** Whether the runtime's own IANA database knows this zone. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** D247: one email template; the bodies are HTML from the rich text editor, sanitised on save. */
export const mailTemplateInput = z.object({
  kind: z.enum(MAIL_TEMPLATE_KINDS),
  template: z.object({
    enabled: z.boolean(),
    subjectEn: z.string().trim().min(1).max(300),
    bodyEn: z.string().trim().min(1).max(20_000),
    subjectAr: z.string().trim().min(1).max(300),
    bodyAr: z.string().trim().min(1).max(20_000),
  }),
});

/**
 * D240: the platform's mail server. The password is write-only: absent keeps the stored
 * one, an empty string removes it. A server switched on needs a host and a from address.
 */
const mailServer = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["tls", "starttls", "none"]),
  username: z.string().trim().max(255),
  fromAddress: z.union([z.email(), z.literal("")]),
  fromName: z.string().trim().max(120),
});
const mailServerReady = (mail: z.infer<typeof mailServer>) => !mail.enabled || (mail.host !== "" && mail.fromAddress !== "");
const MAIL_SERVER_READY = "A mail server that is on needs a host and a from address.";

export const mailSettingsInput = mailServer.extend({ password: z.string().max(1000).optional() }).refine(mailServerReady, MAIL_SERVER_READY);

/** D293: an agent's save of the mail server, which never carries the password (D277); the stored one is kept. */
export const agentMailSettingsInput = mailServer.strict().refine(mailServerReady, MAIL_SERVER_READY);

export const testEmailInput = z.object({ to: z.email() });

/** D242: an agent's email, to people of the platform by their e-mail address. */
export const agentEmailInput = z.strictObject({
  to: z.array(z.email()).min(1),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
});

export type MailSettingsInput = z.infer<typeof mailSettingsInput>;
export type MailTemplateInput = z.infer<typeof mailTemplateInput>;

/** `UC-73.1-03`: the filter an export is taken under, so it matches what was on screen. */
export const auditFilterInput = z.object({
  actor: z.enum(["all", "human", "agent"]).optional(),
  period: z.enum(["all", "24h", "7d", "30d", "90d"]).optional(),
  action: z.string().trim().optional(),
  limit: z.number().int().positive().max(5000).optional(),
});
