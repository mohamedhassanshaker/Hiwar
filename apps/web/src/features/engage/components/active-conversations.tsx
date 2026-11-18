"use client";

import { LiveRegion } from "@/components/shared/live-region";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tg } from "@/components/ui/tag";
import { useAwp } from "@/hooks/use-awp";
import { formatTime } from "@/i18n";
import { useGo } from "@/lib/routes";
import type { ActiveConversation } from "@/features/engage/types";
import { ALERTS_CHANGED, useAlertPermission } from "./conversation-notifier";

/**
 * D344: the open conversations beside the one being read: the agent's, and the ones this person
 * has taken over, most recently active first. Refreshed whenever any conversation moves, and the
 * place where the person turns desktop alerts on.
 */
export function ActiveConversations({ items, currentId }: { items: ActiveConversation[]; currentId: string }) {
  const { t, lang } = useAwp();
  const go = useGo();
  const alerts = useAlertPermission();

  return (
    <Card pad={false}>
      <LiveRegion path="/api/sse/conversations" />
      <div className="awp-col" style={{ gap: 8, padding: 16, borderBottom: "1px solid var(--border-subtle)" }}>
        <b>{t("Open conversations", "المحادثات المفتوحة")}</b>
        {alerts === "default" && (
          <Btn
            type="secondary"
            label={t("Turn on desktop alerts", "تفعيل تنبيهات سطح المكتب")}
            onClick={async () => {
              await Notification.requestPermission();
              window.dispatchEvent(new Event(ALERTS_CHANGED));
            }}
          />
        )}
        {alerts === "granted" && <span className="awp-small awp-muted">{t("Desktop alerts are on.", "تنبيهات سطح المكتب مفعّلة.")}</span>}
        {alerts === "denied" && (
          <span className="awp-small awp-muted">{t("Desktop alerts are blocked in this browser's settings.", "تنبيهات سطح المكتب محظورة في إعدادات هذا المتصفح.")}</span>
        )}
      </div>
      <div style={{ maxHeight: "60vh", overflow: "auto" }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="awp-col"
            aria-current={item.id === currentId ? "page" : undefined}
            onClick={() => go("conversation", { id: item.id })}
            style={{
              gap: 4,
              width: "100%",
              padding: "12px 16px",
              border: 0,
              borderBottom: "1px solid var(--border-subtle)",
              background: item.id === currentId ? "var(--surface-brand-subtle)" : "transparent",
              color: "inherit",
              textAlign: "start",
              cursor: "pointer",
            }}
          >
            <div className="awp-row" style={{ gap: 8, justifyContent: "space-between" }}>
              <b className="awp-small">{t(item.deploymentNameEn, item.deploymentNameAr || item.deploymentNameEn)}</b>
              {item.lastAt && <span className="awp-small awp-muted">{formatTime(lang, new Date(item.lastAt))}</span>}
            </div>
            <span className="awp-small awp-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
              {item.lastText ?? t("No message yet", "لا رسائل بعد")}
            </span>
            <Tg tone={item.mine ? "warning" : "success"} label={item.mine ? t("With you", "معك") : t("With the agent", "مع الوكيل")} />
          </button>
        ))}
        {!items.length && <p className="awp-small awp-muted" style={{ margin: 0, padding: 16 }}>{t("No conversation is open.", "لا توجد محادثة مفتوحة.")}</p>}
      </div>
    </Card>
  );
}
