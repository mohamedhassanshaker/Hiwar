import { FunctionMiddleware, type AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type CustomEvent, type RunAgentInput } from "@ag-ui/core";
import { map } from "rxjs";

import { insertAuditEntry } from "@/db/queries/audit";
import { logger } from "@/lib/logger";

/**
 * The AG-UI middleware stack of stack specification 4.3.2, applied to every `HttpAgent`
 * the runtime registers:
 *
 * - **PII redaction** of what this process logs or audits. The harness masks what reaches
 *   the model (§5.3); this is the second place a value could escape, because anything
 *   written down is something that leaves the request.
 * - **Audit of human-in-the-loop decisions.** A T1 confirmation and a T2 approval travel
 *   as the CUSTOM events of `packages/contracts/schemas/agui-custom-events.schema.json`,
 *   and specification §9 puts every decision in the append-only log.
 * - **RAW stripping**, unless trace capture is on for the run. The "Capture full traces
 *   (RAW events)" feature flag of §7.5.5 is what turns it on.
 */

/** What the redactor looks for in anything about to be written down. */
const PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]"],
  [/\+?\d[\d\s-]{7,}\d/g, "[phone]"],
  [/\b(?:\d[ -]*?){13,19}\b/g, "[card]"],
  [/\b(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{12,}\b/g, "[secret]"],
];

/** A copy of the value with anything that looks like personal data or a secret removed. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, redact(inner)]));
  }
  return value;
}

/** The custom events that carry a person's decision on a deferred tool call. */
export const DECISION_EVENTS = new Set(["awp.tool.confirmation", "awp.tool.approval"]);

type Decision = {
  callId?: string;
  approvalId?: string;
  toolName?: string;
  tier?: string;
  decision?: string;
  reason?: string;
};

/** A decision is denied unless it says otherwise, so a malformed one is never an allow. */
function outcomeOf(value: Decision): "Allowed" | "Denied" {
  return value.decision === "Approved" || value.decision === "Confirmed" ? "Allowed" : "Denied";
}

/**
 * One middleware per agent, because the audit row has to name the agent and the person the
 * run token was minted for.
 */
export function governedMiddleware(options: {
  agentId: string;
  agentLabel: string;
  personId: string;
  captureRawEvents: boolean;
}): FunctionMiddleware {
  const log = logger();
  return new FunctionMiddleware((input: RunAgentInput, next: AbstractAgent) =>
    next.run(input).pipe(
      map((event: BaseEvent) => {
        if (event.type === EventType.RAW && !options.captureRawEvents) {
          // Emptied rather than forwarded: a RAW event is the provider's own payload, and
          // nothing downstream is entitled to it unless the run was asked to capture it.
          return { ...event, rawEvent: null } as BaseEvent;
        }

        if (event.type === EventType.CUSTOM) {
          const custom = event as CustomEvent;
          const decision = (custom.value ?? {}) as Decision;
          // The same names announce a call that waits, with no decision yet (D239); only a
          // decision is audited here, and the platform audits it again where it is made.
          if (DECISION_EVENTS.has(custom.name) && decision.decision !== undefined) {
            void insertAuditEntry({
              actorType: "Person",
              actorId: options.personId,
              actorLabel: options.agentLabel,
              action: `agent:${custom.name}`,
              objectType: "Run",
              objectId: null,
              objectLabel: decision.toolName ?? options.agentLabel,
              detailJson: redact({
                agentId: options.agentId,
                callId: decision.callId,
                approvalId: decision.approvalId,
                tier: decision.tier,
                decision: decision.decision,
                reason: decision.reason,
              }) as Record<string, unknown>,
              outcome: outcomeOf(decision),
            }).catch((problem: unknown) => {
              log.error({ problem, agentId: options.agentId }, "agent decision was not audited");
            });
          }
        }

        return event;
      }),
    ),
  );
}
