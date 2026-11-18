import type { MailSettings } from "@/db/queries/mail";

/** Audit, logs, settings, system and documentation (S-73 to S-75, S-78, S-79). */

export type AuditRow = {
  at: string;
  actorType: string;
  actor: string;
  actorLabel: string;
  action: string;
  objectType: string;
  objectLabel: string | null;
  detail: string;
  outcome: string;
};

export type LogRow = {
  at: string;
  level: string;
  service: string;
  correlationId: string | null;
  message: string;
};

/** D240: the mail server as Settings shows it; the password is never sent back, only whether there is one. */
export type MailView = Omit<MailSettings, "passwordCipher"> & { hasPassword: boolean };

export type Settings = {
  organisation: { nameEn: string; nameAr: string; timeZone: string; languages: string[] };
  workingCalendarEn: string;
  workingCalendarAr: string;
  holidayCalendarEn: string;
  holidayCalendarAr: string;
  /** The calendars the form sends back unchanged: it shows their names, not their ids. */
  workingCalendarId: string | null;
  holidayCalendarId: string | null;
  brandColour: string;
  versionNumber: number;
  branding: { kind: string; contentRef: string }[];
  flags: { key: string; group: string; nameEn: string; nameAr: string; enabled: boolean }[];
  mail: MailView;
};

/** One dependency the System screen shows, as `/api/health` reports it. */
export type ServiceHealth = {
  name: string;
  version: string | null;
  status: string;
  /** Why the probe failed. `UC-78.1-04` shows it beside the error state. */
  detail?: string;
};

export type SystemState = {
  agentsPaused: boolean;
  pausedAt: string | null;
  activeRuns: number;
  queueDepth: number;
  activeRooms: number;
  services: ServiceHealth[];
  /** When the probes ran, shown so a reader knows how old "Error" is (`UC-78.1-04`). */
  checkedAt: string;
};

export type DocPage = { slug: string; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string };

