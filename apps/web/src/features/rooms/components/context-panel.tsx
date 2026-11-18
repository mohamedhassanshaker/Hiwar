"use client";

import type { RoomContextUsage } from "@/features/rooms/types";
import { useAwp } from "@/hooks/use-awp";

/**
 * The room panel's Context section: the lead agent's context window and how much of it its last
 * reply read. A reply that would not fit is refused by the model server, so the room says how
 * close it is before that happens.
 */
export function ContextPanel({ usage }: { usage: RoomContextUsage | null }) {
  const { t, aName } = useAwp();
  return (
    <div>
      <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 900 }}>{t("Context", "السياق")}</h4>
      {usage ? <ContextUsage usage={usage} agentName={aName(usage.agent)} /> : <span className="awp-muted awp-small">{t("No lead agent.", "لا يوجد وكيل رئيسي.")}</span>}
    </div>
  );
}

function ContextUsage({ usage, agentName }: { usage: RoomContextUsage; agentName: string }) {
  const { t } = useAwp();
  const tokens = (count: number) => t(`${count.toLocaleString()} tokens`, `${count.toLocaleString()} رمز`);
  return (
    <div className="awp-col awp-small" style={{ gap: 6 }}>
      <span className="awp-muted">
        {agentName}
        {usage.route ? <span className="awp-mono"> · {usage.route}</span> : null}
      </span>
      <span>
        {t("Window", "النافذة")}: {usage.window ? tokens(usage.window) : t("not recorded", "غير مسجّلة")}
      </span>
      <span>
        {t("Last reply read", "قرأ آخر رد")}: {usage.lastTokensIn ? tokens(usage.lastTokensIn) : t("no reply yet", "لا رد بعد")}
      </span>
      {usage.window && usage.lastTokensIn ? (
        <meter
          min={0}
          max={usage.window}
          value={Math.min(usage.lastTokensIn, usage.window)}
          low={usage.window * 0.75}
          high={usage.window * 0.9}
          optimum={0}
          style={{ width: "100%" }}
          aria-label={t("Context window used by the last reply", "ما استخدمه آخر رد من نافذة السياق")}
        />
      ) : null}
    </div>
  );
}
