/**
 * D384: a work item's brief for the agent assigned to it: the item, its sub items, comments and
 * history with who and when, its audit trail and the names of its attachments and artifacts.
 */
import { auditLinesOf, clip, composeBrief } from "@/features/agents/service";
import { humanSize } from "@/lib/utils";
import * as repository from "./repository";

/** The brief of the work item `key`, or an empty string when there is no such work item. */
export async function workItemBrief(key: string): Promise<string> {
  const facts = await repository.readBriefFacts(key);
  if (!facts) return "";
  const { item, subs, activity, attachments, artifacts } = facts;
  const audit = await auditLinesOf("WorkItem", key, item.createdAt);
  const fields = Object.entries(item.attributes ?? {}).map(([name, value]) => `- ${name}: ${clip(String(value))}`);
  return composeBrief({
    heading: `Work item ${key}: ${item.title}`,
    facts: [
      ["Type", item.type],
      ["Status", item.status],
      ["Priority", item.priority],
      ["Project", item.project],
      ["Due", item.dueAt?.toISOString()],
      ["Parent work item", item.parent],
      ["Raised from request", item.request],
      ["Blocked because", item.blocked],
    ],
    sections: [
      { title: "Description", lines: item.description?.trim() ? [clip(item.description, 8_000)] : [] },
      { title: "Fields", lines: fields },
      { title: "Sub items", lines: subs.map((sub) => `- ${sub.key} (${sub.status}): ${sub.title}`) },
      {
        title: "Comments and history, oldest first",
        lines: activity.map((entry) => `- ${entry.at.toISOString()} ${entry.who} [${entry.event}]: ${clip(entry.detail ?? "")}`),
      },
      {
        title: "Attachments (names only)",
        lines: [
          ...attachments.map((file) => `- ${file.name} (${humanSize(file.size)})`),
          ...artifacts.map((artifact) => `- ${artifact.name} (artifact)`),
        ],
      },
      { title: "Audit trail", lines: audit },
    ],
  });
}
