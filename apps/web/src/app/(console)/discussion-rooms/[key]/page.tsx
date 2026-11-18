import { notFound } from "next/navigation";

import { SessionRoom } from "@/features/rooms/components/room";
import { loadRoom } from "@/features/rooms/service";
import { ROOM_MESSAGE_MAX, ROOM_MESSAGE_WINDOW } from "@/features/rooms/types";

/**
 * S-23: the discussion room the URL names, with its latest messages: 200, or as many as
 * `?show=` asks for after "Show earlier messages", up to 2000.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { key } = await params;
  const { show } = await searchParams;
  const asked = Number(show);
  const shown = Number.isInteger(asked) && asked > ROOM_MESSAGE_WINDOW ? Math.min(asked, ROOM_MESSAGE_MAX) : ROOM_MESSAGE_WINDOW;
  const detail = await loadRoom(decodeURIComponent(key), shown);
  if (!detail) notFound();
  return <SessionRoom detail={detail} />;
}
