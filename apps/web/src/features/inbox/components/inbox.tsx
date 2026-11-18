"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { LiveRegion } from "@/components/shared/live-region";
import { PageHead } from "@/components/shared/page-head";
import { Pager } from "@/components/shared/pager";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/tabs";
import { Ic } from "@/components/ui/icon";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { useComments } from "@/features/comments/components/comment-store";
import { ThreadPane } from "@/features/comments/components/thread-pane";
import { CARD_LABEL, type CommentCard } from "@/features/comments/types";
import { answer, decide, markRead } from "@/features/inbox/actions";
import type { InboxCounts, InboxItem } from "@/features/inbox/types";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { useAgo } from "@/hooks/use-client-now";
import { kindLbl, priAr } from "@/i18n/vocabulary";
import type { ServerPage } from "@/lib/paging";
import { useGo, useScreenParams } from "@/lib/routes";

/**
 * S-12: approvals, agent questions, mentions and SLA warnings that need the signed-in
 * person, and the quick-request threads raised from a comment on a dashboard card
 * (handoff v2 section 6).
 *
 * Both the filter and the selection can be deep-linked, which is what the Inbox peek,
 * the comment popover and the reply toast all use to land somebody on the right thing.
 * A quick request is selected as `q:<card>`, so one parameter addresses either kind.
 *
 * `items` is one page of the filter's items, read on the server (D349); `selected` is the
 * item the address selects, read on its own so it opens whichever page it is on.
 */
export function Inbox({
  items,
  counts: stored,
  selected,
  filter,
  page,
  mayRaiseTasks,
}: {
  items: InboxItem[];
  counts: InboxCounts;
  selected: InboxItem | null;
  filter: string;
  page: ServerPage;
  mayRaiseTasks: boolean;
}) {
  const { t, aName, why } = useAwp();
  const { ago } = useAgo();
  const go = useGo();
  const router = useRouter();
  const p = useScreenParams();
  const { threads } = useComments();
  const quick = threads.filter((thread) => thread.comments.length > 0);
  const quickNew = quick.filter((thread) => thread.unread);
  const query = useFilterQuery();
  const [sel, setSel] = useState(p.sel ?? items[0]?.id ?? "");
  const [decided, setDecided] = useState<InboxItem | null>(null);
  // The peek opens the Inbox on one kind, so the chip it names is the one selected.
  const setFilter = (id: string) => query.set("filter", id);
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // `UC-12.3-01`: Resolved is a tab of its own, so the three others show only what is
  // still waiting and their counts mean "needs you".
  const list = filter === "quick" ? [] : items;
  const counts = {
    all: Object.values(stored.open).reduce((sum, n) => sum + n, 0),
    approval: stored.open.approval ?? 0,
    question: stored.open.question ?? 0,
    resolved: stored.resolved,
  };
  // The chips the peek can land on appear only when there is something under them,
  // rather than standing there empty for everyone.
  const chipLabel: Record<string, [string, string]> = {
    mention: ["Mentions", "إشارات"],
    sla: ["SLA warnings", "تنبيهات الخدمة"],
    review: ["Reviews", "مراجعات"],
    update: ["Updates", "تحديثات"],
  };
  const extraChips = (["mention", "sla", "review", "update"] as const)
    .map((kind) => ({ kind, n: stored.open[kind] ?? 0 }))
    .filter((entry) => entry.n > 0 || filter === entry.kind);
  const quickOnly = filter === "quick";
  const selectedThread = sel.startsWith("q:") ? (sel.slice(2) as CommentCard) : null;
  const showQuickFirst = quick.length > 0 && filter !== "resolved";
  // The detail is of the list beside it. Choosing a filter that hides what was selected
  // would otherwise leave the panel on a record nobody can see, offering its actions.
  // The item a decision was just taken on stays in the pane, marked Resolved, rather than the
  // pane moving on to another waiting item the person did not choose (D201).
  // The item the address selects opens even when it is on another page, while the filter shows its kind.
  const linked =
    selected && selected.id === sel && (filter === "resolved" ? selected.resolved : !selected.resolved && (filter === "all" || selected.kind === filter))
      ? selected
      : undefined;
  const it = list.find((i) => i.id === sel) ?? linked ?? decided ?? list[0];
  // `UC-12.3-04`: an inbox with nothing in it is a page of its own, not an empty list.
  if (counts.all === 0 && counts.resolved === 0 && quick.length === 0) {
    return (
      <div className="awp-page">
        {/* `UC-10.1-02`: a channel re-reads the page, the same live pattern the dashboard and
            a room already use — so an item that arrives finds this empty state gone. */}
        <LiveRegion path="/api/sse/inbox" />
        <PageHead title={t("Inbox", "صندوق الوارد")} sub={t("Approvals, questions, mentions, reviews and updates on your requests and work items.", "الاعتمادات والأسئلة والإشارات والمراجعات وتحديثات طلباتك وبنود عملك.")} />
        <Card>
          <p className="awp-muted" style={{ margin: 0 }}>{t("Nothing is waiting for you.", "لا شيء بانتظارك.")}</p>
        </Card>
      </div>
    );
  }
  const k = (it && kindLbl[it.kind]) ?? ["", "", "neutral"];

  /**
   * Every decision reports what it did. A refusal comes back as a message rather than an
   * exception, so the pane says why — "Already decided by …", "Expired", "Run cancelled" —
   * instead of looking as though nothing happened.
   */
  const run = (item: InboxItem, work: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(null);
      try {
        const result = await work();
        if (!result.ok) setError(why(result) ?? null);
        // Kept as it was decided, since the refreshed page no longer lists it among the open ones.
        else setDecided({ ...item, resolved: true });
      } catch (problem) {
        setError(why(problem));
      }
    });

  return (
    <div className="awp-page" style={{ maxWidth: "none" }}>
      {/* `UC-10.1-02`: an approval decided elsewhere, a question answered, a mention — any
          of it posted to `notifyInbox` reaches this screen the same way the dashboard and a
          room already refresh themselves. */}
      <LiveRegion path="/api/sse/inbox" />
      <PageHead title={t("Inbox", "صندوق الوارد")} sub={t("Approvals, questions, mentions, reviews and updates on your requests and work items.", "الاعتمادات والأسئلة والإشارات والمراجعات وتحديثات طلباتك وبنود عملك.")} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,400px) minmax(0,1fr)", gap: 16, flex: 1, minHeight: 0 }} className="awp-inbox">
        <Card pad={false} style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 220px)", minHeight: 360 }}>
          <div style={{ padding: 14, borderBottom: "1px solid var(--border-divider)" }}>
            <Chips
              value={filter}
              onChange={setFilter}
              items={[
                { id: "all", label: `${t("All", "الكل")} ${counts.all}` },
                { id: "approval", label: `${t("Approvals", "الاعتمادات")} ${counts.approval}` },
                { id: "question", label: `${t("Questions", "الأسئلة")} ${counts.question}` },
                ...extraChips.map((entry) => ({
                  id: entry.kind,
                  label: `${t(...chipLabel[entry.kind])} ${entry.n}`,
                })),
                ...(quick.length > 0
                  ? [{ id: "quick", label: `${t("Quick Requests", "الطلبات السريعة")} ${quick.length}` }]
                  : []),
                { id: "resolved", label: `${t("Resolved", "تمت المعالجة")} ${counts.resolved}` },
              ]}
            />
          </div>
          <div style={{ overflow: "auto" }}>
            {showQuickFirst && (
              <>
                <div className="qr-sec">
                  {t("Quick Requests", "الطلبات السريعة")}
                  {quickNew.length > 0 && (
                    <span className="qr-new">{t(`${quickNew.length} new`, `${quickNew.length} جديدة`)}</span>
                  )}
                </div>
                {quick.map((thread) => (
                  <button
                    key={thread.card}
                    onClick={() => setSel(`q:${thread.card}`)}
                    style={{
                      width: "100%",
                      border: 0,
                      borderBottom: "1px solid var(--border-divider)",
                      background: sel === `q:${thread.card}` ? "var(--surface-brand-subtle)" : "transparent",
                      padding: "14px 16px",
                      textAlign: "start",
                      cursor: "pointer",
                      display: "flex",
                      gap: 12,
                    }}
                  >
                    <Who id={thread.comments.at(-1)?.authorId ?? ""} s={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="awp-row" style={{ gap: 6 }}>
                        <Tg tone="brand" label={t("Quick request", "طلب سريع")} />
                        <span style={{ flex: 1 }} />
                        {thread.lastMessageAt && (
                          <span className="awp-small awp-muted">
                            {ago(thread.lastMessageAt)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontWeight: 500, marginTop: 6 }}>
                        {t(...(CARD_LABEL[thread.card] ?? [thread.card, thread.card]))}
                      </div>
                      {thread.unread && (
                        <div className="awp-small" style={{ color: "var(--text-brand)", marginTop: 4 }}>
                          {t("New reply", "رد جديد")}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
                {!quickOnly && list.length > 0 && (
                  <div className="qr-sec">{t("Approvals and alerts", "الاعتمادات والتنبيهات")}</div>
                )}
              </>
            )}
            {quickOnly && quick.length === 0 && (
              <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }}>
                {t(
                  "No quick requests yet. Comment on a dashboard card to start one.",
                  "لا توجد طلبات سريعة بعد. علّق على بطاقة في اللوحة لبدء واحد.",
                )}
              </p>
            )}
            {list.map((i) => {
              const kk = kindLbl[i.kind] ?? ["", "", "neutral"];
              return (
                <button key={i.id} onClick={() => setSel(i.id)} style={{ width: "100%", border: 0, borderBottom: "1px solid var(--border-divider)", background: sel === i.id ? "var(--surface-brand-subtle)" : "transparent", padding: "14px 16px", textAlign: "start", cursor: "pointer", display: "flex", gap: 12 }}>
                  <Who id={i.from} s={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="awp-row" style={{ gap: 6 }}>
                      <Tg tone={kk[2]} label={t(kk[0], kk[1])} />
                      {i.risk && <span className="awp-small" style={{ color: i.risk === "High" ? "var(--text-danger)" : "var(--text-warning)" }}>{t(`${i.risk} risk`, `مخاطر ${priAr[i.risk]}`)}</span>}
                      <span style={{ flex: 1 }} />
                      <span className="awp-small awp-muted">{ago(i.at)}</span>
                    </div>
                    <div style={{ fontWeight: 500, marginTop: 6 }}>{t(i.t, i.tAr)}</div>
                    {i.resolved && <div className="awp-small" style={{ color: "var(--text-success)", marginTop: 4 }}>{t("Resolved", "تمت المعالجة")}</div>}
                  </div>
                </button>
              );
            })}
          </div>
          <Pager
            page={page.page - 1}
            last={Math.max(0, Math.ceil(page.total / page.size) - 1)}
            total={page.total}
            size={page.size}
            onPage={(next) => query.set("page", String(next + 1))}
          />
        </Card>
        {selectedThread ? (
          <Card pad={false} style={{ overflow: "auto" }}>
            <ThreadPane card={selectedThread} mayRaiseTasks={mayRaiseTasks} />
          </Card>
        ) : it ? (
        <Card pad={false} style={{ overflow: "auto" }}>
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="awp-row" style={{ flexWrap: "wrap" }}>
              <Tg tone={k[2]} size="md" label={t(k[0], k[1])} />
              {it.risk && <Tg tone={it.risk === "High" ? "danger" : "warning"} size="md" label={t(`${it.risk} risk`, `مخاطر ${priAr[it.risk]}`)} />}
            </div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{t(it.t, it.tAr)}</h2>
            <dl className="awp-kv" style={{ margin: 0 }}>
              {it.from && (
                <>
                  <dt>{t("Requested by", "مقدم الطلب")}</dt>
                  <dd className="awp-row"><Who id={it.from} s={22} />{aName(it.from)}</dd>
                </>
              )}
              {it.runKey && (
                <>
                  <dt>{t("Run", "العملية")}</dt>
                  <dd><Lnk onClick={() => go("run", { id: it.runKey as string })}>{it.runKey}</Lnk></dd>
                </>
              )}
              {it.workItemKey && (
                <>
                  <dt>{t("Work item", "بند العمل")}</dt>
                  <dd className="awp-mono">{it.workItemKey}</dd>
                </>
              )}
              {it.policy && (
                <>
                  <dt>{t("Policy", "السياسة")}</dt>
                  <dd>{it.policy}</dd>
                </>
              )}
            </dl>
            {it.tool && (
              <div>
                <div className="awp-small awp-muted" style={{ marginBottom: 6 }}>{t("Action and arguments (redacted)", "الإجراء والمعطيات (منقّحة)")}</div>
                <pre className="awp-mono" style={{ margin: 0, padding: 14, borderRadius: 12, background: "var(--surface-sunken)", whiteSpace: "pre-wrap", direction: "ltr", textAlign: "left" }}>{`${it.tool}\n${it.args ?? ""}`}</pre>
              </div>
            )}
            {it.evidence.length > 0 && (
              <div>
                <div className="awp-small awp-muted" style={{ marginBottom: 6 }}>{t("Evidence", "الأدلة")}</div>
                <div className="awp-col" style={{ gap: 8 }}>
                  {it.evidence.map((e) => (
                    <div key={e} className="awp-row" style={{ gap: 10 }}>
                      <Ic n="TickCircle" c="var(--icon-success)" s={18} />
                      {e}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div className="awp-card" style={{ padding: 14, background: "var(--feedback-danger-bg)", color: "var(--feedback-danger-text)" }} role="alert">
                {error}
              </div>
            )}
            {it.resolved ? (
              <Tg tone="success" dot size="md" label={t("Resolved — the run was told", "تمت المعالجة — أُبلغت العملية")} />
            ) : it.kind === "question" ? (
              <div className="awp-col" style={{ gap: 10 }}>
                {/* `UC-12.2-03`: the agent offered a choice, so one is picked rather than typed. */}
                {it.options.length > 0 ? (
                  <div className="awp-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {it.options.map((option) => (
                      <button
                        key={option}
                        className={"awp-chip" + (draft === option ? " on" : "")}
                        onClick={() => setDraft(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea
                    className="awp-input"
                    style={{ height: 96, padding: 12 }}
                    value={draft}
                    aria-label={t("Your answer", "إجابتك")}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t("Your answer resumes the run", "إجابتك تستأنف العملية")}
                  />
                )}
                <div>
                  <Btn
                    label={t("Send answer", "إرسال الإجابة")}
                    disabled={pending || !draft.trim()}
                    onClick={() =>
                      run(it, async () => {
                        const result = await answer({ inboxItemId: it.id, answer: draft });
                        if (result.ok) setDraft("");
                        return result;
                      })
                    }
                  />
                </div>
              </div>
            ) : it.kind === "approval" ? (
              <div className="awp-col" style={{ gap: 10 }}>
                {/* `UC-12.1-08`, `-09`, `-10`: say why, rather than offer a button that fails. */}
                {it.blocked ? (
                  <Tg tone="warning" dot size="md" label={t(it.blocked, it.blockedAr ?? it.blocked)} />
                ) : (
                  <>
                    <input
                      className="awp-input"
                      value={reason}
                      aria-label={t("Reason", "السبب")}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t("Reason (required to reject)", "السبب (مطلوب للرفض)")}
                    />
                    <div className="awp-row" style={{ gap: 10, flexWrap: "wrap" }}>
                      <Btn
                        label={t("Approve", "اعتماد")}
                        disabled={pending}
                        onClick={() =>
                          run(it, () => decide({ inboxItemId: it.id, decision: "Approved", reason: reason || undefined }))
                        }
                      />
                      <Btn
                        type="secondary"
                        label={t("Request changes", "طلب تعديلات")}
                        disabled={pending}
                        onClick={() =>
                          run(it, () =>
                            decide({ inboxItemId: it.id, decision: "ChangesRequested", reason: reason || undefined }),
                          )
                        }
                      />
                      <Btn
                        type="danger"
                        label={t("Reject", "رفض")}
                        disabled={pending || !reason}
                        // `UC-12.1-06`: a rejection carries a reason, and the server agrees.
                        title={reason ? undefined : t("Reason (required to reject)", "السبب (مطلوب للرفض)")}
                        onClick={() => run(it, () => decide({ inboxItemId: it.id, decision: "Rejected", reason }))}
                      />
                    </div>
                  </>
                )}
              </div>
            ) : it.link ? (
              <div className="awp-row" style={{ gap: 10, flexWrap: "wrap" }}>
                <Btn
                  type="secondary"
                  label={t("Open", "فتح")}
                  disabled={pending}
                  onClick={() => start(async () => {
                    await markRead({ inboxItemId: it.id });
                    router.push(it.link as string);
                  })}
                />
                <Btn type="secondary" label={t("Mark as read", "تعليم كمقروء")} disabled={pending} onClick={() => start(async () => void (await markRead({ inboxItemId: it.id })))} />
              </div>
            ) : (
              <Btn
                type="secondary"
                label={t("Open", "فتح")}
                onClick={() =>
                  // `UC-12.3-02` and `-03`: a mention opens its room, an SLA warning its work
                  // item or — when there is neither, a budget crossing — the Budgets screen.
                  it.registration
                    ? go("people", { status: "Pending" })
                    : it.roomKey
                    ? go("session", { key: it.roomKey })
                    : it.workItemKey
                      ? go("tasks", { open: it.workItemKey })
                      : go("budgets")
                }
              />
            )}
          </div>
        </Card>
        ) : (
          <Card>
            <p className="awp-muted" style={{ margin: 0 }}>{t("Nothing matches this filter.", "لا شيء يطابق هذه التصفية.")}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
