/**
 * D384: a request's brief for the agent working it: the request and its form, its comments and
 * history with who and when, its audit trail and the names of its attachments.
 */
import { auditLinesOf, clip, composeBrief } from "@/features/agents/service";
import { humanSize } from "@/lib/utils";
import * as repository from "./repository";

/** The brief of the request `key`, or an empty string when there is no such request. */
export async function requestBrief(key: string): Promise<string> {
  const facts = await repository.readBriefFacts(key);
  if (!facts) return "";
  const { request, events, attachments } = facts;
  const audit = await auditLinesOf("Request", key, request.createdAt);
  const fields = Object.entries(request.attributes ?? {}).map(([name, value]) => `- ${name}: ${clip(String(value))}`);
  return composeBrief({
    heading: `Request ${key}: ${request.title}`,
    facts: [
      ["Request type", request.type],
      ["Status", request.status],
      ["Current step", request.step],
      ["Requester", request.requester],
      ["Project", request.project],
      ["Channel", request.channel],
      ["Submitted", request.submittedAt?.toISOString()],
      ["Due", request.dueAt?.toISOString()],
    ],
    sections: [
      { title: "Description", lines: request.description?.trim() ? [clip(request.description, 8_000)] : [] },
      { title: "Form fields", lines: fields },
      {
        title: "Comments and history, oldest first",
        lines: events.map((entry) => `- ${entry.at.toISOString()} ${entry.who} [${entry.event}]: ${clip(entry.detail ?? "")}`),
      },
      { title: "Attachments (names only)", lines: attachments.map((file) => `- ${file.name} (${humanSize(file.size)})`) },
      { title: "Audit trail", lines: audit },
    ],
  });
}
