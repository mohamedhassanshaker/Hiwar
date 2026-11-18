import { notFound } from "next/navigation";

import { ConversationDetail } from "@/features/engage/components/conversation-detail";
import { loadActiveConversations, loadConversation } from "@/features/engage/service";

/** D342: one visitor conversation, followed live. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [conversation, active] = await Promise.all([loadConversation(id), loadActiveConversations()]);
  if (!conversation) notFound();
  return <ConversationDetail summary={conversation.summary} lines={conversation.lines} active={active} />;
}
