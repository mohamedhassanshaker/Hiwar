"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHead } from "@/components/shared/page-head";
import { useToast } from "@/components/shared/toast";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { answer, decide } from "@/features/inbox/actions";
import type { InboxCounts, InboxItem } from "@/features/inbox/types";
import { useAwp } from "@/hooks/use-awp";

const KINDS: [string, string, string][] = [
  ["all", "All open", "كل المفتوح"],
  ["approval", "Approvals", "الموافقات"],
  ["question", "Questions", "الأسئلة"],
  ["resolved", "Resolved", "المحسومة"],
];

/** One approval or question with its decision controls. Rejecting needs a reason (data model rule 3). */
function ItemCard({ item }: { item: InboxItem }) {
  const { t } = useAwp();
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [reply, setReply] = useState("");
  const [pending, start] = useTransition();
  const run = (body: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const result = await body();
      toast.say(result.ok ? done : (result.message ?? t("Not done.", "لم يتم.")));
      if (result.ok) router.refresh();
    });
  return (
    <Card
      title={
        <span className="awp-row" style={{ gap: 8 }}>
          {t(item.t, item.tAr)}
          <Tg tone={item.kind === "approval" ? "warning" : "info"} label={item.kind} />
          {item.risk && <Tg tone="danger" label={item.risk} />}
        </span>
      }
    >
      <div className="awp-col" style={{ gap: 8 }}>
        <span className="awp-small awp-muted">
          {item.from} · {new Date(item.at).toLocaleString()} {item.runKey ? `· ${item.runKey}` : ""}
        </span>
        {item.tool && (
          <span className="awp-mono awp-small">
            {item.tool} {item.args}
          </span>
        )}
        {item.policy && <span className="awp-small">{item.policy}</span>}
        {item.blocked && <span className="awp-small" style={{ color: "var(--text-danger)" }}>{t(item.blocked, item.blockedAr ?? item.blocked)}</span>}
        {!item.resolved && !item.blocked && item.kind === "approval" && (
          <div className="awp-col" style={{ gap: 8 }}>
            <input className="awp-input" aria-label={t("Reason", "السبب")} placeholder={t("Reason (needed to reject)", "السبب (مطلوب للرفض)")} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="awp-row" style={{ gap: 8 }}>
              <Btn label={t("Approve", "موافقة")} disabled={pending} onClick={() => run(() => decide({ inboxItemId: item.id, decision: "Approved", reason: reason || undefined }), t("Approved. The run continues.", "تمت الموافقة. يتابع التشغيل."))} />
              <Btn type="danger" label={t("Reject", "رفض")} disabled={pending || !reason.trim()} title={reason.trim() ? undefined : t("Give a reason first.", "اكتب السبب أولًا.")} onClick={() => run(() => decide({ inboxItemId: item.id, decision: "Rejected", reason }), t("Rejected. The agent tells the person.", "تم الرفض. يبلّغ الوكيل الشخص."))} />
            </div>
          </div>
        )}
        {!item.resolved && !item.blocked && item.kind === "question" && (
          <div className="awp-row" style={{ gap: 8 }}>
            <input className="awp-input" aria-label={t("Answer", "الإجابة")} value={reply} onChange={(e) => setReply(e.target.value)} />
            <Btn label={t("Send answer", "إرسال الإجابة")} disabled={pending || !reply.trim()} onClick={() => run(() => answer({ inboxItemId: item.id, answer: reply }), t("Answer sent. The run continues.", "أُرسلت الإجابة. يتابع التشغيل."))} />
          </div>
        )}
      </div>
    </Card>
  );
}

export function Approvals({ items, counts, filter }: { items: InboxItem[]; counts: InboxCounts; filter: string }) {
  const { t } = useAwp();
  const router = useRouter();
  const open = Object.values(counts.open).reduce((sum, n) => sum + n, 0);
  return (
    <div className="awp-page awp-col" style={{ gap: 16 }}>
      <PageHead title={t("Approvals", "الموافقات")} sub={t(`${open} waiting · tool calls and questions from agent runs`, `${open} بانتظارك · استدعاءات أدوات وأسئلة من عمليات الوكلاء`)} />
      <Chips items={KINDS.map(([id, en, ar]) => ({ id, label: t(en, ar) }))} value={filter} onChange={(id) => router.push(`/ops/ai/approvals?filter=${id}`)} />
      {items.length === 0 ? (
        <Card>
          <span className="awp-muted">{t("Nothing is waiting for you.", "لا شيء بانتظارك.")}</span>
        </Card>
      ) : (
        items.map((item) => <ItemCard key={item.id} item={item} />)
      )}
    </div>
  );
}
