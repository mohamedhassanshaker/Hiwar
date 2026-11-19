import { loadInbox } from "@/features/inbox/service";
import { Approvals } from "./approvals";

/**
 * The module's Inbox (S-12) as Hiwar's AI approvals: tool calls waiting for a person and
 * questions agents asked, for the signed-in operator.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const inbox = await loadInbox({ filter: filter ?? "all" });
  return <Approvals items={inbox.items} counts={inbox.counts} filter={filter ?? "all"} />;
}
