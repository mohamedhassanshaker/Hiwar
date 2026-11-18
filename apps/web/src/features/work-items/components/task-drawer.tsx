"use client";

import { Fragment, useOptimistic, useState } from "react";

import { useAgents, usePeople } from "@/components/shared/directory";
import {
  addSubItem,
  approve,
  assign,
  changeStatus,
  comment,
  deleteWorkItem,
  reopen,
  requestChanges,
  setSubItemDone,
  submitForReview,
  unblock,
} from "@/features/work-items/actions";
import { type SubItem, type Task, type WorkItemDetail } from "@/features/work-items/types";
import { createRoomFromWorkItem } from "@/features/rooms/actions";
import { formatDay } from "@/i18n";
import { priAr, priTone, stTone2 } from "@/i18n/vocabulary";
import { useModals } from "@/components/shared/modal-host";
import { type Go } from "@/lib/routes";
import { Btn, Lnk } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { Tabs } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { Refused } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { Sel } from "@/components/shared/layout";
import { CARD_LABEL } from "@/features/comments/types";
import type { WorkItemStatus } from "@/db/schema/enums";
import { ALLOWED_TRANSITIONS, SUBMITTABLE_STATUSES } from "@/features/work-items/transitions";
import { useColLbl, useTypeLbl } from "./work-item-labels";
import { AskName } from "./ask-name";

/**
 * One work item's drawer: its fields, origin and description, sub items and activity, a comment
 * box, and the actions its status allows (assign, submit for review, approve, request changes,
 * unblock, reopen, the board's moves, discuss in a room, delete). Each action reports what it
 * did or why the server refused it.
 */
export function TaskDrawer({ x, detail, onClose, go, onOpenKey }: { x: Task; detail: WorkItemDetail | undefined; onClose: () => void; go: Go; onOpenKey: (k: string) => void }) {
  const { t, lang, aName, why } = useAwp();
  const { open } = useModals();
  const colLbl = useColLbl();
  const typeLbl = useTypeLbl();
  const agents = useAgents();
  const people = usePeople();
  // `UC-24.3-01`: work goes to a person or an agent, from one list.
  const assignees: [string, string][] = [
    ['', t('Assign to…', 'إسناد إلى…')],
    ...people.map((person) => [person.id, aName(person.id)] as [string, string]),
    ...agents.map((agent) => [agent.id, `${aName(agent.id)} · ${t('agent', 'وكيل')}`] as [string, string]),
  ];
  const d: WorkItemDetail = detail ?? { rt: ["—", "—"], org: null, rev: "", sch: "—", desc: null, at: [], subs: [], act: [], attachments: [], comment: null };
  // The sub items are the server's: an action revalidates the page and the new detail lists
  // them, an added one included. A tick shows at once and falls back to the detail when the
  // action ends.
  const [subs, showDone] = useOptimistic(d.subs, (current: SubItem[], change: { k: string; done: number }) =>
    current.map((s): SubItem => (s[0] === change.k ? [s[0], s[1], s[2], s[3], change.done] : s)),
  );
  const doneN = subs.filter((s) => s[4]).length;
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState("");
  const [run, pending] = useAction();

  /** Every drawer action reports what it did, or the reason it did not. */
  const act = (work: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    run(async () => {
      const result = await work();
      if (!result.ok) throw new Refused({ reason: why(result) });
      return done;
    });

  /** `UC-25.3-02`: ticked off here and in the database, so the progress bar is the truth. */
  const togSub = (k: string) => {
    const now = subs.find((s) => s[0] === k)?.[4] ? 0 : 1;
    act(() => {
      showDone({ k, done: now });
      return setSubItemDone({ key: k, done: now === 1 });
    }, t('Sub item updated.', 'تم تحديث البند الفرعي.'));
  };
  // Handoff v2 section 7: an item raised from a comment opens on Activity, because the
  // thing a reader wants first is where it came from, not a sub-item list it has none of.
  const [tab, setTab] = useState(x.type === 'SubItem' || x.fromComment ? 'act' : 'subs');
  const [addingSub, setAddingSub] = useState(false);
  const att = d.attachments;
  return (
    <div className="awp-overlay" onClick={onClose}>
      <div className="awp-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="awp-row" style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-divider)' }}>
          <span className="awp-mono awp-muted" style={{ flex: 1 }}>{x.k} · {x.p}</span>
          <button className="awp-iconbtn" onClick={onClose} aria-label={t('Close', 'إغلاق')}><Ic n="X" /></button>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 900 }}>{t(x.t, x.tAr)}</h2>
            <div className="awp-row" style={{ flexWrap: 'wrap' }}>
              <Tg tone={stTone2[x.st]} dot label={colLbl(x.st)} />
              <Tg tone={priTone[x.pri]} label={t(x.pri, priAr[x.pri])} />
              <Tg tone={x.type === 'Bug' ? 'danger' : 'neutral'} label={typeLbl(x.type)} />
            </div>
          </div>
          <dl className="awp-kv" style={{ margin: 0 }}>
            <dt>{t('Assignee', 'المُسند إليه')}</dt>
            <dd className="awp-row">{x.who ? <><Who id={x.who} s={24} />{aName(x.who)}</> : t('Unassigned', 'غير مُسند')}</dd>
            <dt>{t('Reviewer', 'المراجع')}</dt>
            <dd>{d.rev ? aName(d.rev) : "—"}</dd>
            <dt>{t('Project', 'المشروع')}</dt>
            <dd><Lnk onClick={() => go('projects')}>{x.p}</Lnk></dd>
            <dt>{t('Request type', 'نوع الطلب')}</dt>
            <dd>{t(d.rt[0], d.rt[1])}</dd>
            {d.parent && (
              <>
                <dt>{t('Parent item', 'البند الأصل')}</dt>
                <dd><Lnk onClick={() => onOpenKey(d.parent as string)}>{d.parent}</Lnk></dd>
              </>
            )}
            {d.org && (
              <>
                <dt>{t('Origin', 'المصدر')}</dt>
                <dd>
                  {d.comment ? (
                    // Handoff v2 section 7: the route reads "Comment", and following it
                    // opens the conversation it came from rather than a key nobody typed.
                    <Lnk onClick={() => go('inbox', { filter: 'quick', sel: d.org![0] })}>
                      {t('Comment', 'تعليق')} · {t(...(CARD_LABEL[d.comment.card] ?? [d.comment.card, d.comment.card]))}
                    </Lnk>
                  ) : (
                    <Lnk onClick={() => go(d.org![1], d.org![1] === 'requests' ? { open: d.org![0] } : d.org![1] === 'session' ? { key: d.org![0] } : undefined)}>{d.org[0]}</Lnk>
                  )}
                </dd>
              </>
            )}
            <dt>{t('Due', 'الاستحقاق')}</dt>
            <dd>{x.dueAt ? formatDay(lang, new Date(x.dueAt)) : "—"}</dd>
          </dl>
          {/* `UC-24.1-05` and `UC-25.3-03`: a sub item is read inside its parent. */}
          {x.type === 'SubItem' && d.parent && (
            <p className="awp-small awp-muted" style={{ margin: 0 }} role="note">
              {t('This sub item is shown inside its parent work item', 'يظهر هذا البند الفرعي داخل بند العمل الأصل')}{' '}
              <button className="awp-lnk" onClick={() => onOpenKey(d.parent as string)}>{d.parent}</button>
            </p>
          )}
          <div>
            <div className="awp-small awp-muted" style={{ marginBottom: 4 }}>{t('Description', 'الوصف')}</div>
            {d.comment ? (
              // Raised from a comment: what was actually said, and what was pointed at.
              <div className="awp-col" style={{ gap: 10 }}>
                {/* A deleted comment has no text: the item's own description, copied from it, stands in. */}
                <p style={{ margin: 0 }}>{d.comment.text || d.desc || t(x.t, x.tAr)}</p>
                {d.comment.captureUrl && (
                  // Served by `/api/comments/capture`, which decides who may read it.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={d.comment.captureUrl}
                    alt={t('Captured area of the card', 'منطقة ملتقطة من البطاقة')}
                    style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid var(--border-divider)' }}
                  />
                )}
                <div>
                  <Lnk onClick={() => go('inbox', { filter: 'quick', sel: `q:${d.comment!.card}` })}>
                    {t('Open conversation', 'فتح المحادثة')}
                  </Lnk>
                </div>
              </div>
            ) : d.desc ? (
              // What the item was written with: the brief its assignee works from.
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.desc}</p>
            ) : (
              <p style={{ margin: 0 }}>{d.at.length ? t(x.t, x.tAr) + ' — ' + d.at.map((a) => a[1]).slice(0, 2).join(', ') : t(x.t, x.tAr)}</p>
            )}
          </div>
          {d.at.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 900 }}>
                {t('Attributes', 'السمات')} <span className="awp-small awp-muted" style={{ fontWeight: 400 }}>· {t('schema', 'المخطط')} {d.sch}</span>
              </h4>
              <dl className="awp-kv" style={{ margin: 0, padding: 14, background: 'var(--surface-card)', borderRadius: 12 }}>
                {d.at.map(([k, v]) => (
                  <Fragment key={k}>
                    <dt>{k}</dt>
                    <dd className="awp-mono">{v}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          )}
          <div>
            <div className="awp-row" style={{ marginBottom: 8 }}>
              <span className="awp-small awp-muted" style={{ flex: 1 }}>{t('Attachments', 'المرفقات')} · {att.length}</span>
              {/* `UC-25.1-03`: the file goes onto this work item. */}
              <Lnk onClick={() => open('upload', { owner: { type: 'WorkItem', key: x.k } })}>{t('Add attachment', 'إضافة مرفق')}</Lnk>
            </div>
            {att.length ? (
              <div className="awp-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {att.map(([n, sz, kind]) => (
                  // An artifact linked to the item is read as an artifact; only a file attached to it is read through the item.
                  <button key={`${kind}:${n}`} className="awp-card" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }} onClick={() => open('preview', { item: { n, s: sz, p: x.p, w: x.who || 'u1', l: x.k, kind }, owner: kind === 'attachment' ? { type: 'WorkItem', key: x.k } : undefined })}>
                    <Ic n="File01" s={18} c="var(--icon-brand)" />
                    <span className="awp-small" style={{ fontWeight: 500 }}>{n}</span>
                  </button>
                ))}
              </div>
            ) : (
              <span className="awp-small awp-muted">{t('No attachments.', 'لا توجد مرفقات.')}</span>
            )}
          </div>
          <Tabs value={tab} onChange={setTab} items={[...(x.type !== 'SubItem' ? [{ id: 'subs', label: t('Sub items', 'البنود الفرعية'), count: subs.length }] : []), { id: 'act', label: t('Activity', 'النشاط'), count: d.act.length }]} />
          {tab === 'subs' && x.type !== 'SubItem' && (
            <div>
              <div className="awp-row" style={{ marginBottom: 10 }}>
                <span className="awp-small awp-muted" style={{ flex: 1 }}>
                  {subs.length > 0 && t(doneN + ' of ' + subs.length + ' done', doneN + ' من ' + subs.length + ' منجزة')}
                  {/* `UC-25.3-04`: everything under it is done, so the obvious next step. */}
                  {subs.length > 0 && doneN === subs.length && x.st !== 'InReview' && (
                    <span style={{ color: 'var(--text-success)' }}>
                      {' '}· 100% · {t('ready to submit for review', 'جاهز للإرسال للمراجعة')}
                    </span>
                  )}
                </span>
                <Lnk onClick={() => setAddingSub(true)}>{t('Add sub item', 'إضافة بند فرعي')}</Lnk>
              </div>
              {subs.length ? (
                subs.map(([k, en, ar, w, dn]) => (
                  <div key={k} className="awp-row" style={{ padding: '10px 0', borderBottom: '1px solid var(--border-divider)', gap: 10 }}>
                    <button onClick={() => togSub(k)} aria-pressed={!!dn} aria-label={t('Toggle done', 'تبديل الإنجاز')} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', display: 'inline-flex' }}>
                      <Ic n={dn ? 'CheckCircleFill' : 'Icon4'} c={dn ? 'var(--icon-success)' : 'var(--icon-tertiary)'} />
                    </button>
                    <span className="awp-mono awp-muted">{k}</span>
                    <button className="awp-lnk-t" style={{ flex: 1, textDecoration: dn ? 'line-through' : 'none' }} onClick={() => onOpenKey(k)}>{t(en, ar)}</button>
                    <Who id={w} s={24} />
                  </div>
                ))
              ) : (
                <p className="awp-muted awp-small" style={{ margin: 0 }}>{t('No sub items yet.', 'لا توجد بنود فرعية بعد.')}</p>
              )}
              {addingSub && (
                <AskName
                  title={t('Add sub item', 'إضافة بند فرعي')}
                  label={t('Sub item title', 'عنوان البند الفرعي')}
                  onClose={() => setAddingSub(false)}
                  onDone={(title) => {
                    setAddingSub(false);
                    act(() => addSubItem({ parentKey: x.k, titleEn: title }), t('Sub item added.', 'تمت إضافة البند الفرعي.'));
                  }}
                />
              )}
            </div>
          )}
          {tab === 'act' && (
            <div>
              <div className="awp-col awp-small" style={{ gap: 10 }}>
                {d.act.map(([w, en, ar], i) => (
                  <div key={i}>
                    <b>{aName(w)}</b> <span className="awp-muted">{t(en, ar)}</span>
                  </div>
                ))}
              </div>
              {/* `UC-25.4-02`: a comment, and an @handle in it reaches that person. */}
              <div className="awp-row" style={{ gap: 10, marginTop: 12 }}>
                <input
                  className="awp-input"
                  value={draft}
                  aria-label={t('Comment', 'تعليق')}
                  placeholder={t('Add a comment. @mention someone to tell them.', 'أضف تعليقاً. @اذكر شخصاً لإبلاغه.')}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Btn
                  label={t('Comment', 'تعليق')}
                  disabled={pending || !draft.trim()}
                  onClick={() =>
                    act(async () => {
                      const result = await comment({ key: x.k, text: draft });
                      if (result.ok) setDraft('');
                      return result;
                    }, t('Comment added.', 'أُضيف التعليق.'))
                  }
                />
              </div>
            </div>
          )}
        </div>
        <div className="awp-col" style={{ marginTop: 'auto', padding: 20, borderTop: '1px solid var(--border-divider)', gap: 10 }}>
          {/* `UC-25.2-03`, `-07` and `-08` each need a sentence from the person acting. */}
          {['InReview', 'Done'].includes(x.st) && (
            <input
              className="awp-input"
              value={reason}
              aria-label={t('Reason', 'السبب')}
              placeholder={x.st === 'Done'
                ? t('Why is this being reopened?', 'لماذا يُعاد فتحه؟')
                : t('What needs to change?', 'ما الذي يجب تغييره؟')}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <div className="awp-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {x.st === 'Done' ? (
              <Btn
                type="secondary"
                label={t('Reopen', 'إعادة فتح')}
                disabled={pending || !reason.trim()}
                onClick={() => act(() => reopen({ key: x.k, reason }), t('Reopened.', 'أُعيد فتحه.'))}
              />
            ) : x.st === 'InReview' ? (
              <>
                <Btn
                  label={t('Approve', 'اعتماد')}
                  disabled={pending}
                  onClick={() => act(() => approve({ key: x.k, override: reason || undefined }), t('Approved.', 'تم الاعتماد.'))}
                />
                <Btn
                  type="secondary"
                  label={t('Request changes', 'طلب تعديلات')}
                  disabled={pending || !reason.trim()}
                  onClick={() => act(() => requestChanges({ key: x.k, text: reason }), t('Changes requested.', 'طُلبت التعديلات.'))}
                />
              </>
            ) : x.st === 'Blocked' ? (
              <>
                <Btn
                  label={t('Unblock', 'إلغاء التعطيل')}
                  disabled={pending}
                  onClick={() => act(() => unblock({ key: x.k }), t('Unblocked.', 'أُلغي التعطيل.'))}
                />
                <Sel
                  value=""
                  onChange={(who) => who && act(() => assign({ key: x.k, assignee: who }), t(`Assigned to ${aName(who)}.`, `أُسند إلى ${aName(who)}.`))}
                  w={220}
                  opts={assignees}
                />
              </>
            ) : (
              <>
                {/* Offered only from where the service takes a submission (D197). */}
                {(SUBMITTABLE_STATUSES as readonly string[]).includes(x.st) && (
                  <Btn
                    label={t('Submit for review', 'إرسال للمراجعة')}
                    disabled={pending}
                    onClick={() => act(() => submitForReview({ key: x.k }), t('Submitted for review.', 'أُرسل للمراجعة.'))}
                  />
                )}
                {/* `UC-24.1-07`: the board's moves without a drag, for a phone or a keyboard. */}
                <Sel
                  value=""
                  onChange={(status) =>
                    status &&
                    act(
                      () => changeStatus({ key: x.k, status, version: x.version }),
                      t(`${x.k} moved to ${colLbl(status)}.`, `نُقل ${x.k} إلى ${colLbl(status)}.`),
                    )
                  }
                  w={180}
                  opts={[
                    ['', t('Move to…', 'نقل إلى…')],
                    ...(ALLOWED_TRANSITIONS[x.st as WorkItemStatus] ?? []).map((status) => [status, colLbl(status)] as [string, string]),
                  ]}
                />
                <Sel
                  value=""
                  onChange={(who) => who && act(() => assign({ key: x.k, assignee: who }), t(`Assigned to ${aName(who)}.`, `أُسند إلى ${aName(who)}.`))}
                  w={220}
                  opts={assignees}
                />
              </>
            )}
            <span style={{ flex: 1 }} />
            {/* D388: the work item as a document, to print or save as PDF. */}
            <Btn type="secondary" label={t('Report', 'التقرير')} icon="Download04" onClick={() => go('workItemReport', { key: x.k })} />
            <Btn
              type="secondary"
              label={t('Discuss in a room', 'مناقشة في اجتماع')}
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const result = await createRoomFromWorkItem({ workItemKey: x.k });
                  if (result.ok) go('session', { key: result.value });
                  return result;
                }, t('A room was opened for it.', 'فُتح اجتماع له.'))
              }
            />
            <Btn
              type="danger"
              label={t('Delete', 'حذف')}
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const result = await deleteWorkItem({ key: x.k });
                  if (result.ok) onClose();
                  return result;
                }, t('Work item deleted.', 'حُذف بند العمل.'))
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
