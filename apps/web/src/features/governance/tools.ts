import { z } from "zod";

import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { sendAgentEmail, sendTestEmail } from "./notification-service";
import {
  agentEmailInput,
  agentMailSettingsInput,
  brandColourInput,
  featureFlagInput,
  generalSettingsInput,
  mailTemplateInput,
  pauseAgentsInput,
  testEmailInput,
} from "./schema";
import * as service from "./service";

/**
 * D242: the agent's email tool. T2, so it is off unless an agent is granted it (D63) and each
 * send waits for a person to approve the exact message (D49). The system notifications of
 * D240 do not use it.
 *
 * D293: the Settings and System screens as tools. Each write is T2, because it changes the
 * platform for everybody; the mail server's password is never one of their fields (D277).
 */
export const GOVERNANCE_TOOLS: PlatformTool[] = [
  action({
    subject: "email",
    operation: "create",
    tier: "T2",
    description:
      "Send an email, through the platform's mail server, to people of the platform by their " +
      "e-mail address (person_list gives it). Plain text. Use it only when the person you act " +
      "for asked for an email to be sent. A person approves the exact message before it goes. " +
      "Refused for an address that is not an active person of the platform, and when the " +
      "platform has no mail server. Returns the addresses it was queued to.",
    input: agentEmailInput,
    permission: "organisation:read",
    run: (input) => sendAgentEmail(input),
  }),

  action({
    subject: "settings",
    operation: "get",
    description:
      "Read the platform settings: the organisation's names, time zone, languages and calendars, the " +
      "brand colour, the feature flags with their keys, and the mail server and email templates " +
      "(whether a password is stored, never the password).",
    input: z.object({}),
    permission: "settings:read",
    run: () => service.loadSettings(),
  }),

  action({
    subject: "general_settings",
    operation: "edit",
    tier: "T2",
    description:
      "Save the organisation's general settings, every field as it should now be: bilingual names, " +
      "time zone (IANA), languages, and the working and holiday calendars by id.",
    input: generalSettingsInput,
    permission: "settings:write",
    run: async (input) => {
      await service.saveGeneralSettings({ ...input, languages: [...input.languages] });
      return { saved: true };
    },
  }),

  action({
    subject: "feature_flag",
    operation: "edit",
    tier: "T2",
    description: "Switch a feature flag on or off, by its key from settings_get.",
    input: featureFlagInput,
    permission: "settings:write",
    run: async ({ key, enabled }) => {
      await service.setFeatureFlag(key, enabled);
      return { key, enabled };
    },
  }),

  action({
    subject: "brand_colour",
    operation: "edit",
    tier: "T2",
    description: "Set the brand colour, a six-digit hex colour. One without enough contrast is refused.",
    input: brandColourInput,
    permission: "settings:write",
    run: async ({ colour }) => {
      await service.saveBrandColour(colour);
      return { colour };
    },
  }),

  action({
    subject: "mail_server",
    operation: "edit",
    tier: "T2",
    description:
      "Save the platform's mail server, every field as it should now be: on or off, host, port, " +
      "security, user name, from address and from name. The password is not a field here: the " +
      "stored one is kept, and a person sets it in Settings → Email.",
    input: agentMailSettingsInput,
    permission: "settings:write",
    run: async (input) => {
      await service.saveMailSettings(input);
      return { saved: true };
    },
  }),

  action({
    subject: "mail_template",
    operation: "edit",
    tier: "T2",
    description:
      "Save one email template, every field as it should now be: on or off, and the English and " +
      "Arabic subjects and HTML bodies. Placeholders: {{key}} {{title}} {{outcome}} {{summary}} " +
      "{{completedAt}} {{link}}.",
    input: mailTemplateInput,
    permission: "settings:write",
    run: async (input) => {
      await service.saveMailTemplate(input);
      return { kind: input.kind };
    },
  }),

  action({
    subject: "test_email",
    operation: "create",
    tier: "T2",
    description: "Send the mail server's test email to one address, and say whether it was sent and why not.",
    input: testEmailInput,
    permission: "settings:write",
    run: ({ to }) => sendTestEmail(to),
  }),

  action({
    subject: "agent_pause",
    operation: "edit",
    tier: "T2",
    description:
      "Pause every agent, or resume them. While paused no agent run starts, this one's later " +
      "missions included; runs already going finish.",
    input: pauseAgentsInput,
    permission: "system:operate",
    run: async ({ paused }) => {
      await service.pauseAgents(paused);
      return { paused };
    },
  }),
];
