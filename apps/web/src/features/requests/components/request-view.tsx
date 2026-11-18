"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";

import { useAgents, useMay } from "@/components/shared/directory";
import {
  actionsForRequest,
  assignRequestToAgent,
  deleteRequest,
  releaseRequestStep,
  rejectRequest as rejectRequestAction,
  requestChanges as requestChangesAction,
  takeRequestStep,
  takeStepAction,
} from "@/features/requests/actions";
import { attributeDisplay, attributeProblem } from "@/features/requests/attributes";
import { type Request, type RequestDetail, type RequestType } from "@/features/requests/types";
import { createRoomFromRequest } from "@/features/rooms/actions";
import { formatDay, formatTime } from "@/i18n";
import { useModals } from "@/components/shared/modal-host";
import { type Go } from "@/lib/routes";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/overlay";
import { Ic } from "@/components/ui/icon";
import { PopSelect } from "@/components/ui/pop-select";
import { Tabs } from "@/components/ui/tabs";
import { Who } from "@/components/ui/avatar";
import { orThrow } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { DataTable } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { AttributeFields } from "./attribute-input";

/** A function that names a request type by its code in the console's language, or returns the code when unknown. */
export function useRtName(types: RequestType[]) {
  const { t } = useAwp();
  return (c: string) => {
    const r = types.find((x) => x.c === c);
    return r ? t(r.n, r.nAr) : c;
  };
}

/**
 * One request's page (S-28, S-29): the step tracker, description, facts, form attributes and
 * attachments, then History & audit, Sub requests and Work items. The actions offered are read
 * from the server on open and after each act. Taking the step opens the action window with the
 * step's attributes, a note, the files to attach, the step's own actions, Return and Reject (both
 * need a note) and Assign to agent.
 */
export function RequestView({ r, detail, types, back, go, parent }: { r: Request; detail: RequestDetail | undefined; types: RequestType[]; back: () => void; go: Go; parent?: Request }) {
  const { t, lang, aName, nm } = useAwp();
  const { open, act: confirmAction } = useModals();
  const agents = useAgents();
  const may = useMay();
  const rtName = useRtName(types);
  const [tab, setTab] = useState("history");
  /** `UC-29.2-01` and `-06`: what this person may do here, decided on the server. */
  const [offered, setOffered] = useState<Awaited<ReturnType<typeof actionsForRequest>>>({
    actions: [],
    reason: null,
    reasonAr: null,
    claim: { by: null, mine: false, mayTake: false },
  });
  const [comment, setComment] = useState("");
  /** The request's files chosen to go with the decision (D218). */
  const [chosen, setChosen] = useState<string[]>([]);
  /** Values typed for the attributes the current step asks (D304). */
  const [stepValues, setStepValues] = useState<Record<string, string>>({});
  /** The action window (D219): the decision, Return, Reject and Assign to agent, once the step is taken. */
  const [deciding, setDeciding] = useState(false);
  const decided = () => {
    setComment('');
    setChosen([]);
    setStepValues({});
    setDeciding(false);
  };
  const [agentCode, setAgentCode] = useState("");
  /** D314: the step attribute values open in their popup, and what they were collected with. */
  const [shown, setShown] = useState<{ about: string; attributes: [string, string][] } | null>(null);
  const [run, pending] = useAction();

  useEffect(() => {
    void actionsForRequest(r.k).then(setOffered);
  }, [r.k]);

  /** Runs one act on the request and reports whatever the server said about it. */
  const act = (work: () => Promise<string>) =>
    run(async () => {
      const said = await work();
      setOffered(await actionsForRequest(r.k));
      return said;
    });
  const d = detail;
  const who = r.by === 'ext' ? 'ext' : r.by;
  const steps = d?.steps ?? [];
  const cur = d?.currentStep ?? 0;
  const att = d?.attachments ?? [];
  const desc: [string, string] = d && d.descEn ? [d.descEn, d.descAr] : [r.t, r.tAr];
  const subs = d?.subRequests ?? [];
  const facts: [string, ReactNode][] = [
    [t('Project', 'المشروع'), <Lnk key="p" onClick={() => go('projects')}>{r.p}</Lnk>],
    [t('Request type', 'نوع الطلب'), rtName(r.ty)],
    [t('Requester', 'مقدم الطلب'), r.by === 'ext' ? t('External contact', 'جهة خارجية') : <span key="w" className="awp-row" style={{ gap: 6 }}><Who id={r.by} s={20} />{aName(r.by)}</span>],
    [t('Submitted', 'التقديم'), <span key="d" className="awp-mono">{formatDay(lang, new Date(r.submittedAt))}</span>],
    [t('Channel', 'القناة'), r.ch + ' · ' + (r.mode === 'agent' ? t('agentic', 'تفاعلي') : t('form', 'نموذج'))],
    [t('Current step', 'الخطوة الحالية'), steps[cur] ? t(steps[cur].n, steps[cur].nAr) : '—'],
    [
      t('SLA', 'اتفاقية الخدمة'),
      d?.dueAt ? (
        // `UC-29.1-06`: close to its deadline, the value itself says so.
        <span key="sla" style={{ color: d.slaAtRisk ? 'var(--text-danger)' : undefined }} role={d.slaAtRisk ? 'status' : undefined}>
          {formatDay(lang, new Date(d.dueAt))}, {formatTime(lang, new Date(d.dueAt))}
          {d.slaAtRisk ? ` · ${t('at risk', 'معرضة للخطر')}` : ''}
        </span>
      ) : (
        '—'
      ),
    ],
    ...(parent ? ([[t('Parent request', 'الطلب الأصل'), <Lnk key="pr" onClick={back}>{parent.k}</Lnk>]] as [string, ReactNode][]) : []),
  ];
  const history = d?.history ?? [];
  const work = d?.workItems ?? [];
  // D304: what the current step asks, filled from what the request already holds.
  const stored = Object.fromEntries(d?.attributes ?? []);
  const fieldOf = (key: string) => d?.fields.find((field) => field.key === key);
  // D314: the request shows what was asked on its form; a step's values open from the history
  // entry that supplied them, or, stored before entries recorded them, from the Attributes title.
  const recorded = new Set(history.flatMap((entry) => (entry.attributes ?? []).map(([key]) => key)));
  const formAttributes = (d?.attributes ?? []).filter(([key]) => !fieldOf(key)?.stepName);
  const unrecorded = (d?.attributes ?? []).filter(([key]) => fieldOf(key)?.stepName && !recorded.has(key));
  const stepFields = (d?.fields ?? []).filter((field) => steps[cur] && field.stepName === steps[cur].n);
  const stepValue = (key: string) => stepValues[key] ?? stored[key] ?? '';
  const stepProblems = stepFields
    .map((field) => attributeProblem(field, stepValue(field.key)))
    .filter((problem) => problem !== null);

  const confirmDelete = () =>
    confirmAction({
      title: t("Delete request", "حذف الطلب"),
      desc: t(
        "A request can only be deleted once nothing still points at it: no approval, deployment conversation, child request, schedule run or work item raised from it.",
        "لا يمكن حذف الطلب إلا إذا لم يعد يشير إليه شيء: لا موافقة ولا محادثة نشر ولا طلب فرعي ولا تشغيل جدولة ولا بند عمل منشأ منه.",
      ),
      danger: true,
      confirm: t("Delete", "حذف"),
      onDone: () =>
        act(async () => {
          orThrow(await deleteRequest({ key: r.k }));
          back();
          return t("Request deleted.", "حُذف الطلب.");
        }),
    });

  return (
    <div className="awp-page">
      <PageHead
        crumb={
          <span className="awp-row" style={{ gap: 6 }}>
            <Lnk onClick={back}>{t('Requests', 'الطلبات')}</Lnk>
            {parent && (<>/<Lnk onClick={back}>{parent.k}</Lnk></>)}
          </span>
        }
        title={t(r.t, r.tAr)}
        sub={<span className="awp-mono">{r.k} · {rtName(r.ty)} · {r.p}</span>}
      >
        {/* D147: one audience member takes the step, and the others wait until it moves on. */}
        {offered.claim.mayTake && (
          <Btn
            label={t('Take this step', 'تولَّ هذه الخطوة')}
            disabled={pending}
            onClick={() =>
              act(async () => {
                orThrow(await takeRequestStep({ key: r.k }));
                setDeciding(true);
                return t('The step is yours until it moves on.', 'الخطوة لك حتى تنتقل.');
              })
            }
          />
        )}
        {/* D219: the step's actions are in its action window, open once the step is taken. */}
        {offered.claim.mine && offered.actions.length > 0 && (
          <Btn label={t('Act on this step', 'تصرّف في هذه الخطوة')} disabled={pending} onClick={() => setDeciding(true)} />
        )}
        {offered.claim.mine && (
          <Btn
            type="secondary"
            label={t('Release step', 'إعادة الخطوة')}
            disabled={pending}
            onClick={() =>
              act(async () => {
                orThrow(await releaseRequestStep({ key: r.k }));
                return t('Released. Any audience may act on it now.', 'أُعيدت. يمكن لأي جمهور التصرف فيها الآن.');
              })
            }
          />
        )}
        {may("rooms:write") && (
          <Btn
            type="secondary"
            label={t("Discuss in a room", "مناقشة في اجتماع")}
            disabled={pending}
            onClick={() =>
              act(async () => {
                const key = orThrow(await createRoomFromRequest({ requestKey: r.k }));
                go("session", { key });
                return t(`Opened ${key}.`, `فُتح ${key}.`);
              })
            }
          />
        )}
        {/* D388: the request as a document, to print or save as PDF. */}
        <Btn type="secondary" label={t("Report", "التقرير")} icon="Download04" onClick={() => go("requestReport", { key: r.k })} />
        {may("requests:write") && (
          <Btn type="danger" label={t("Delete request", "حذف الطلب")} disabled={pending} onClick={confirmDelete} />
        )}
      </PageHead>
      {/* `UC-29.2-06` and `-08`: a reason instead of actions, rather than nothing at all. */}
      {offered.actions.length === 0 && offered.reason && (
        <Card>
          <p style={{ margin: 0 }} role="status">{t(offered.reason, offered.reasonAr ?? offered.reason)}</p>
        </Card>
      )}
      {deciding && offered.claim.mine && offered.actions.length > 0 && (
        <Modal w={720} title={t(`Act on ${r.k}`, `التصرف في ${r.k}`)} onClose={() => setDeciding(false)}>
          {/* D218: every decision carries a note and the request's files that go with it. */}
          <div className="awp-col" style={{ gap: 12 }}>
            {stepFields.length > 0 && (
              <AttributeFields
                attributes={stepFields}
                valueOf={stepValue}
                onChange={(key, value) => setStepValues((was) => ({ ...was, [key]: value }))}
                problemOf={(field) => {
                  const problem = stepValues[field.key] === undefined ? null : attributeProblem(field, stepValue(field.key));
                  return problem ? t(problem.en, problem.ar) : null;
                }}
              />
            )}
            <textarea
              className="awp-input"
              style={{ minHeight: 72, resize: 'vertical' }}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('A note on your decision, for the history. Return and Reject need one.', 'ملاحظة على قرارك، للسجل. الإعادة والرفض تتطلبان ملاحظة.')}
              aria-label={t('Note', 'ملاحظة')}
            />
            <div className="awp-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="awp-small awp-muted">{t('Attach to the decision:', 'إرفاق بالقرار:')}</span>
              {att.map(([n]) => (
                <button
                  key={n}
                  className="awp-chip"
                  aria-pressed={chosen.includes(n)}
                  onClick={() => setChosen((was) => (was.includes(n) ? was.filter((one) => one !== n) : [...was, n]))}
                >
                  {chosen.includes(n) ? '✓ ' : ''}{n}
                </button>
              ))}
              <Lnk onClick={() => open('upload', { owner: { type: 'Request', key: r.k } })}>{t('Add attachment', 'إضافة مرفق')}</Lnk>
            </div>
            <div className="awp-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {/* `UC-29.2-01`: the step's own actions, then Return and Reject, which every step offers. */}
              {offered.actions.map((action) => (
                <Btn
                  key={action}
                  type={/approve/i.test(action) ? undefined : 'secondary'}
                  label={action}
                  disabled={pending || stepProblems.length > 0}
                  title={stepProblems[0] ? t(stepProblems[0].en, stepProblems[0].ar) : undefined}
                  onClick={() =>
                    act(async () => {
                      const attributes = Object.fromEntries(stepFields.map((field) => [field.key, stepValue(field.key)]));
                      const outcome = orThrow(await takeStepAction({ key: r.k, action, comment: comment || undefined, attachments: chosen, ...(stepFields.length ? { attributes } : {}) }));
                      decided();
                      // `UC-29.2-09`: nothing routed it, so it stayed where it was and says so.
                      return outcome.noMatchingRoute
                        ? t('No matching route — the type owner has been told.', 'لا يوجد مسار مطابق — أُبلغ مالك النوع.')
                        : t(`Moved to ${outcome.toStepName ?? 'the end'}.`, `انتقل إلى ${outcome.toStepName ?? 'النهاية'}.`);
                    })
                  }
                />
              ))}
              {/* A step with a Return of its own routes it there; the built-in one is not offered beside it. */}
              {!offered.actions.some((action) => /^return$/i.test(action)) && (
              <Btn
                type="secondary"
                label={t('Return', 'إعادة')}
                disabled={pending || comment.trim() === ''}
                title={comment.trim() === '' ? t('Say what the requester has to change.', 'اذكر ما على مقدم الطلب تغييره.') : undefined}
                onClick={() =>
                  act(async () => {
                    const outcome = orThrow(await requestChangesAction({ key: r.k, comment, attachments: chosen }));
                    decided();
                    return t(`Returned to ${outcome.toStepName ?? 'the requester'}.`, `أُعيد إلى ${outcome.toStepName ?? 'مقدم الطلب'}.`);
                  })
                }
              />
              )}
              {!offered.actions.some((action) => /reject/i.test(action)) && (
                <Btn
                  type="secondary"
                  label={t('Reject', 'رفض')}
                  disabled={pending || comment.trim() === ''}
                  title={comment.trim() === '' ? t('Say why it is rejected.', 'اذكر سبب الرفض.') : undefined}
                  onClick={() =>
                    act(async () => {
                      orThrow(await rejectRequestAction({ key: r.k, comment, attachments: chosen }));
                      decided();
                      return t('Rejected.', 'رُفض.');
                    })
                  }
                />
              )}
            </div>
          </div>
          <div className="awp-row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {/* `UC-29.2-03`: an agent works the current step as a run. */}
            <PopSelect className="awp-input" style={{ width: 200 }} value={agentCode} onChange={(e) => setAgentCode(e.target.value)} aria-label={t('Agent', 'الوكيل')}>
              <option value="">{t('Assign to agent…', 'إسناد إلى وكيل…')}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{nm(agent)}</option>
              ))}
            </PopSelect>
            <Btn
              label={t('Assign to agent', 'إسناد إلى وكيل')}
              disabled={pending || agentCode === ''}
              onClick={() =>
                act(async () => {
                  const outcome = orThrow(await assignRequestToAgent({ key: r.k, agentCode }));
                  setDeciding(false);
                  return outcome.started
                    ? t(`${agentCode} is working this step.`, `${agentCode} يعمل على هذه الخطوة.`)
                    : t(`${agentCode} could not start: ${outcome.reason}`, `تعذّر تشغيل ${agentCode}: ${outcome.reason}`);
                })
              }
            />
          </div>
        </Modal>
      )}
      <Card>
        <div className="awp-col" style={{ gap: 20 }}>
          <div className="awp-row" style={{ gap: 0, flexWrap: 'wrap' }}>
            {steps.map((x, i) => (
              <div key={x.n} className="awp-row" style={{ gap: 8, flex: 1, minWidth: 130 }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900, flexShrink: 0, background: i < cur ? 'var(--feedback-success-bg)' : i === cur ? 'var(--action-primary-bg)' : 'var(--surface-sunken)', color: i < cur ? 'var(--feedback-success-text)' : i === cur ? 'var(--text-on-action)' : 'var(--text-secondary)' }}>
                  {i < cur ? '✓' : i + 1}
                </span>
                <span className="awp-small" style={{ fontWeight: i === cur ? 900 : 400, color: i === cur ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{t(x.n, x.nAr)}</span>
                {i < steps.length - 1 && <span style={{ flex: 1, height: 2, background: i < cur ? 'var(--icon-success)' : 'var(--border-divider)', marginInline: 8 }} />}
              </div>
            ))}
          </div>
          <div>
            <div className="awp-small awp-muted" style={{ marginBottom: 4 }}>{t('Description', 'الوصف')}</div>
            <p style={{ margin: 0, maxWidth: 820 }}>{t(desc[0], desc[1])}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(200px,100%),1fr))', gap: '14px 24px' }}>
            {facts.map(([k, v], i) => (
              <div key={i}>
                <div className="awp-small awp-muted">{k}</div>
                <div style={{ fontWeight: 500 }}>{v}</div>
              </div>
            ))}
          </div>
          {(formAttributes.length > 0 || unrecorded.length > 0) && (
            <div>
              <div className="awp-row" style={{ marginBottom: 8 }}>
                <span className="awp-small awp-muted" style={{ flex: 1 }}>
                  {t('Attributes', 'السمات')} · {d?.schemaLabel}
                </span>
                {unrecorded.length > 0 && (
                  <Lnk onClick={() => setShown({ about: t("Collected at the request's steps", 'جُمعت في خطوات الطلب'), attributes: unrecorded })}>
                    {t(`Collected at steps · ${unrecorded.length}`, `جُمعت في الخطوات · ${unrecorded.length}`)}
                  </Lnk>
                )}
              </div>
              {formAttributes.length > 0 && (
                <dl className="awp-kv" style={{ margin: 0, padding: 14, background: 'var(--surface-card)', borderRadius: 12 }}>
                  {formAttributes.map(([k, v]) => {
                    const field = fieldOf(k);
                    const [en, ar] = attributeDisplay(field, v);
                    return (
                      <Fragment key={k}>
                        <dt className={field ? undefined : 'awp-mono'}>{field ? t(field.labelEn, field.labelAr) : k}</dt>
                        <dd>{t(en, ar)}</dd>
                      </Fragment>
                    );
                  })}
                </dl>
              )}
            </div>
          )}
          <div>
            <div className="awp-row" style={{ marginBottom: 8 }}>
              <span className="awp-small awp-muted" style={{ flex: 1 }}>{t('Attachments', 'المرفقات')} · {att.length}</span>
              {/* `UC-25.1-03`: the file goes onto this request, not into the project's files. */}
              <Lnk onClick={() => open('upload', { owner: { type: 'Request', key: r.k } })}>{t('Add attachment', 'إضافة مرفق')}</Lnk>
            </div>
            <div className="awp-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {att.map(([n, sz]) => (
                <button key={n} className="awp-card" style={{ padding: '10px 14px', cursor: 'pointer', textAlign: 'start', display: 'flex', gap: 10, alignItems: 'center' }} onClick={() => open('preview', { item: { n, s: sz, p: r.p, w: who, l: r.k, kind: 'attachment' }, owner: { type: 'Request', key: r.k } })}>
                  <Ic n="File01" c="var(--icon-brand)" />
                  <div>
                    <b style={{ wordBreak: 'break-all' }}>{n}</b>
                    <div className="awp-small awp-muted">{sz}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[{ id: 'history', label: t('History & audit', 'السجل والتدقيق'), count: history.length }, ...(parent ? [] : [{ id: 'sub', label: t('Sub requests', 'الطلبات الفرعية'), count: subs.length }]), { id: 'work', label: t('Work items', 'بنود العمل'), count: work.length }]}
      />
      {tab === 'history' && (
        <Card>
          {history.map((entry) => (
            <div key={entry.at} className="awp-row" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-divider)', alignItems: 'flex-start' }}>
              <span className="awp-mono awp-muted" style={{ width: 120 }}>{formatDay(lang, new Date(entry.at))}, {formatTime(lang, new Date(entry.at))}</span>
              <Who id={entry.who} s={24} />
              <div style={{ flex: 1 }}>
                <b>{aName(entry.who)}</b>
                <div className="awp-muted">{t(entry.detailEn, entry.detailAr)}</div>
              </div>
              {entry.attributes && entry.attributes.length > 0 && (
                <Lnk
                  onClick={() =>
                    setShown({
                      about: `${aName(entry.who)} · ${formatDay(lang, new Date(entry.at))}, ${formatTime(lang, new Date(entry.at))} · ${t(entry.detailEn, entry.detailAr)}`,
                      attributes: entry.attributes ?? [],
                    })
                  }
                >
                  {t(`Attributes · ${entry.attributes.length}`, `السمات · ${entry.attributes.length}`)}
                </Lnk>
              )}
            </div>
          ))}
          {!history.length && <p className="awp-muted" style={{ margin: 0 }}>{t('Nothing has happened yet.', 'لم يحدث شيء بعد.')}</p>}
        </Card>
      )}
      {shown && (
        <Modal w={560} title={t('Attributes collected at the step', 'السمات المجمعة في الخطوة')} onClose={() => setShown(null)}>
          <p className="awp-small awp-muted" style={{ margin: '0 0 12px' }}>{shown.about}</p>
          <dl className="awp-kv" style={{ margin: 0 }}>
            {shown.attributes.map(([k, v]) => {
              const field = fieldOf(k);
              const [en, ar] = attributeDisplay(field, v);
              return (
                <Fragment key={k}>
                  <dt className={field ? undefined : 'awp-mono'}>{field ? t(field.labelEn, field.labelAr) : k}</dt>
                  <dd>{t(en, ar)}</dd>
                </Fragment>
              );
            })}
          </dl>
        </Modal>
      )}
      {tab === 'sub' && (
        <Card pad={false}>
          {may('requests:write') && (
            <div className="awp-row" style={{ padding: '12px 16px', justifyContent: 'flex-end' }}>
              <Btn type="secondary" label={t('New sub request', 'طلب فرعي جديد')} onClick={() => open('request', { owner: { type: 'Request', key: r.k } })} />
            </div>
          )}
          <DataTable
            rows={subs}
            cols={[
              { h: t('Key', 'المفتاح'), r: (x) => <span className="awp-mono">{x.k}</span> },
              { h: t('Title', 'العنوان'), r: (x) => t(x.t, x.tAr) },
              { h: t('Status', 'الحالة'), r: (x) => <StTag s={x.st} /> },
            ]}
          />
          {!subs.length && <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: 'center' }}>{t('No sub requests.', 'لا توجد طلبات فرعية.')}</p>}
        </Card>
      )}
      {tab === 'work' && (
        <Card pad={false}>
          {/* D312: work raised here is the request's own, in its project. */}
          {may('work_items:write') && (
            <div className="awp-row" style={{ padding: '12px 16px', justifyContent: 'flex-end' }}>
              <Btn type="secondary" label={t('New work item', 'بند عمل جديد')} onClick={() => open('workitem', { owner: { type: 'Request', key: r.k } })} />
            </div>
          )}
          <DataTable
            onRow={(x) => go('tasks', { open: x.k })}
            rows={work}
            cols={[
              { h: t('Key', 'المفتاح'), r: (x) => <span className="awp-mono">{x.k}</span> },
              { h: t('Title', 'العنوان'), r: (x) => t(x.t, x.tAr) },
              { h: t('Assignee', 'المُسند إليه'), r: (x) => (<div className="awp-row"><Who id={x.who} s={22} />{aName(x.who)}</div>) },
              { h: t('Status', 'الحالة'), r: (x) => <StTag s={x.st} /> },
            ]}
          />
          {!work.length && <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: 'center' }}>{t('No work items yet.', 'لا توجد بنود عمل بعد.')}</p>}
        </Card>
      )}
    </div>
  );
}
