import type { PermissionCode } from "@/authz/permissions";
import { z } from "zod";

import type { PlatformTool, ToolTier } from "./tools";

/**
 * One platform action, offered to an agent as a tool.
 *
 * The platform's own actions are what the console does; an agent working on someone's
 * behalf does the same things, so the catalogue is built from them rather than written a
 * second time. Each entry names an existing action's Zod input and the service behind it:
 * the schema the console validates with is the schema the model fills in, and the
 * permission check is the one already written, so a tool cannot reach further than the
 * person it acts for. A new action becomes a tool by adding a line, and a changed schema
 * changes the tool with it.
 *
 * Every tool is a subject and an operation — `request_type` and `create` — so a model
 * that has learnt one subject can guess the rest. Two hundred tools under a handful of
 * verbs is a vocabulary; two hundred individually named tools is a list to memorise, and
 * a bulk mission writing fifty calls cannot afford to get the names wrong.
 */

/**
 * What a tool does to its subject.
 *
 * The five ordinary ones are the console's own verbs. The rest are lifecycle: they take
 * something out of use or put a version into it, which is a different kind of decision
 * and carries the tier to match.
 */
export const OPERATIONS = {
  list: "T0",
  get: "T0",
  search: "T0",
  create: "T1",
  edit: "T1",
  /** Takes a draft into use, where requests and runs then depend on it. */
  publish: "T2",
  /** Removes something other records may point at. */
  delete: "T2",
  /** Applies or withdraws a change to the platform's own configuration. */
  apply: "T2",
  rollback: "T2",
} as const satisfies Record<string, ToolTier>;

export type Operation = keyof typeof OPERATIONS;

/** The tier an operation carries, before any per-entry override. */
export function tierFor(operation: Operation): ToolTier {
  return OPERATIONS[operation];
}

/** `request_type` + `create` is `request_type_create`. */
export function toolName(subject: string, operation: Operation): string {
  return `${subject}_${operation}`;
}

/** One entry of a feature's tool registry. */
export type ActionTool<S extends z.ZodType> = {
  /**
   * What the tool acts on, in the platform's own vocabulary: `request_type`,
   * `request_type_step`, `project`. A sub-resource is its own subject, so adding a step
   * is `request_type_step_create` rather than a verb of its own.
   */
  subject: string;
  operation: Operation;
  /**
   * What the tool does, in the words the model reads to decide whether to call it. The
   * one part written by hand, because a name alone does not say when to use something.
   */
  description: string;
  /** The action's own input schema, reused rather than restated. */
  input: S;
  /** The permission the service behind it checks. */
  permission: PermissionCode;
  /** The service function, which runs as the person the run acts for. */
  run: (input: z.infer<S>) => Promise<unknown>;
  /** Set only where the operation's tier is wrong for this particular action. */
  tier?: ToolTier;
  /**
   * Which fields of a given payload need a person's agreement (D58). The module's own
   * field rules answer this; the server reads it before the call runs.
   */
  escalates?: (input: z.infer<S>, personId: string) => string[] | Promise<string[]>;
  /** Changes who may do what (D253); see `PlatformTool.authorisation`. */
  authorisation?: true;
};

/** Turns a feature's registry entry into a platform tool. */
export function action<S extends z.ZodType>(entry: ActionTool<S>): PlatformTool {
  return {
    name: toolName(entry.subject, entry.operation),
    description: entry.description,
    permission: entry.permission,
    tier: entry.tier ?? tierFor(entry.operation),
    input: entry.input,
    run: entry.run as (input: never) => Promise<unknown>,
    ...(entry.escalates ? { escalates: entry.escalates as PlatformTool["escalates"] } : {}),
    ...(entry.authorisation ? { authorisation: true as const } : {}),
  };
}

/**
 * The JSON Schema a model fills in, from the action's own Zod schema.
 *
 * `tools/list` previously advertised `{ type: "object" }` for every tool, which tells a
 * model nothing about what to send — it had to guess field names and learn them from
 * rejections. Converting the real schema is what lets a bulk mission be written correctly
 * the first time.
 */
export function inputSchemaOf(tool: PlatformTool): Record<string, unknown> {
  try {
    return z.toJSONSchema(tool.input as z.ZodType, { io: "input" }) as Record<string, unknown>;
  } catch {
    // A schema with a transform or a lazy cycle may not convert; an object with no
    // declared properties is still honest about the shape, where a throw would take the
    // whole catalogue down.
    return { type: "object" };
  }
}
