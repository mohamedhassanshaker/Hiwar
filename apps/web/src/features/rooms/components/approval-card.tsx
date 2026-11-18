"use client";

import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { Tg } from "@/components/ui/tag";
import { decide as decideApproval } from "@/features/inbox/actions";
import type { RoomApproval } from "@/features/rooms/types";
import { useAwp } from "@/hooks/use-awp";

/** The approval card an agent posts when a T2 tool call pauses its run. */
export function ApprovalCard({ approval, mayDecide }: { approval: RoomApproval; mayDecide: boolean }) {
  const { t, why } = useAwp();
  const [decided, setDecided] = useState<string | null>(approval.status === "Pending" ? null : approval.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /**
   * `UC-23.2-01` … `-03`: the decision is the same one the Inbox takes, so a card decided
   * here and an item decided there cannot disagree.
   */
  const decide = (decision: "Approved" | "Rejected" | "ChangesRequested", reason?: string) =>
    start(async () => {
      setError(null);
      if (!approval.inboxItemId) {
        setError(t("This approval has no inbox item to decide.", "لا يوجد عنصر وارد لاعتماد هذا."));
        return;
      }
      const outcome = await decideApproval({ inboxItemId: approval.inboxItemId, decision, reason });
      if (outcome.ok) setDecided(decision);
      else setError(why(outcome));
    });
  return (
    <div className="awp-card" style={{ marginTop: 10, padding: 16, background: "var(--surface-card)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="awp-row">
        <Ic n="SecurityPassword" c="var(--icon-warning)" />
        <b style={{ flex: 1 }}>{t("Approval required · ", "اعتماد مطلوب · ") + approval.key}</b>
        <Tg tone={approval.risk === "High" ? "danger" : approval.risk === "Low" ? "neutral" : "warning"} label={t(`${approval.risk} risk`, "مخاطر")} />
      </div>
      <dl className="awp-kv" style={{ margin: 0 }}>
        <dt>{t("Action", "الإجراء")}</dt>
        <dd className="awp-mono">{approval.action}</dd>
        <dt>{t("Changes", "التغييرات")}</dt>
        <dd>{t(approval.changesEn, approval.changesAr)}</dd>
        <dt>{t("Approvers", "المعتمدون")}</dt>
        <dd>{approval.approvers}</dd>
      </dl>
      {decided ? (
        <Tg
          tone={decided === "Approved" ? "success" : "danger"}
          dot
          size="md"
          label={
            decided === "Approved"
              ? mayDecide
                ? t("Approved by you · applying", "اعتمدتَه · جارٍ التطبيق")
                : t("Approved", "معتمد")
              : mayDecide
                ? t("Rejected by you", "رفضتَه")
                : t("Rejected", "مرفوض")
          }
        />
      ) : !mayDecide ? (
        // D19, D253: whoever holds it decides it; every other member of the room is told the
        // card is open and who it is open on, rather than being offered buttons that would
        // be refused.
        <Tg
          tone="warning"
          dot
          size="md"
          label={
            approval.approvers
              ? t(`Awaiting approval from ${approval.approvers}`, `بانتظار اعتماد ${approval.approvers}`)
              : t("Awaiting approval", "بانتظار الاعتماد")
          }
        />
      ) : (
        <div className="awp-row" style={{ gap: 10 }}>
          <Btn label={t("Approve", "اعتماد")} disabled={pending} onClick={() => decide("Approved")} />
          <Btn
            type="secondary"
            label={t("Request changes", "طلب تعديلات")}
            disabled={pending}
            onClick={() => decide("ChangesRequested", t("Please revise this.", "يرجى المراجعة."))}
          />
          <Btn
            type="danger"
            label={t("Reject", "رفض")}
            disabled={pending}
            onClick={() => decide("Rejected", t("Not approved.", "غير معتمد."))}
          />
        </div>
      )}
      {error && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
