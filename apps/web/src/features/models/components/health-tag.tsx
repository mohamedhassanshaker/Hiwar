"use client";

import { CONNECTION_HEALTH, type ConnectionHealth } from "@/features/models/types";
import { Tg } from "@/components/ui/tag";
import { useAwp } from "@/hooks/use-awp";

/** A connection's or provider's health as a tag, read from its stored test. */
export function HealthTag({ h }: { h: ConnectionHealth }) {
  const { t } = useAwp();
  const [tone, en, ar] = CONNECTION_HEALTH[h];
  return <Tg tone={tone} dot label={t(en, ar)} />;
}
