import { z } from "zod";

import { CLIENT_STATUSES } from "@/db/schema/enums";

/** Requirement 32: the integration-client action inputs. */

export const createClientInput = z.object({
  clientId: z.string().trim().min(3).max(40).regex(/^[a-z0-9_-]+$/, "Use lowercase letters, digits, hyphens and underscores."),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  ownerPersonId: z.string().min(1),
  permissions: z.array(z.string().min(1)).default([]),
});

export const createKeyInput = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  /** Null means the key never expires. */
  expiresInDays: z.number().int().positive().max(3650).nullable(),
});

export const revokeKeyInput = z.object({ keyId: z.uuid() });

export type CreateClientInput = z.infer<typeof createClientInput>;
export type CreateKeyInput = z.infer<typeof createKeyInput>;

export const rotateKeyInput = z.object({
  keyId: z.uuid(),
  /** How long the old secret keeps working (`UC-77.1-02`). */
  graceHours: z.number().int().min(0).max(168).default(24),
});

export const setClientStatusInput = z.object({ clientCode: z.string().min(1), status: z.enum(CLIENT_STATUSES) });
export const clientCodeInput = z.object({ clientCode: z.string().min(1) });

export const setPermissionsInput = z.object({
  clientCode: z.string().min(1),
  permissions: z.array(z.string().min(1)),
  agentCodes: z.array(z.string().min(1)),
});

export const setMcpInput = z.object({
  clientCode: z.string().min(1),
  enabled: z.boolean(),
  authType: z.enum(["ApiKey", "OAuth"]),
  exposedTools: z.array(z.string().min(1)),
});

export const setAguiInput = z.object({
  clientCode: z.string().min(1),
  enabled: z.boolean(),
  allowedEvents: z.array(z.string().min(1)),
  allowedOrigins: z.array(z.string().min(1)),
});

export type RotateKeyInput = z.infer<typeof rotateKeyInput>;
export type SetAguiInput = z.infer<typeof setAguiInput>;
export type SetClientStatusInput = z.infer<typeof setClientStatusInput>;
export type SetMcpInput = z.infer<typeof setMcpInput>;
export type SetPermissionsInput = z.infer<typeof setPermissionsInput>;
