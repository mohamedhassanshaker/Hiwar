import { handle } from "@/server/api";
import { markAllRead } from "@/server/notifications";
import { apiMember } from "@/server/session";

export const POST = handle(async () => {
  const member = await apiMember();
  await markAllRead(member.org.id, member.user.id, member.role);
});
