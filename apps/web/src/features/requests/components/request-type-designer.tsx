"use client";

import { useOptimistic, useState } from "react";

import { useAgents, useMay, usePeople } from "@/components/shared/directory";
import {
  removeRequestTypeAttribute,
  removeRequestTypeAudience,
  removeRequestTypeRule,
  addRequestTypeAudience,
  addRequestTypeRule,
  addRequestTypeStep,
  deleteRequestType,
  deleteRequestTypeStep,
  moveRequestTypeStep,
  saveRequestTypeDraft,
  publishRequestType,
  setRequestTypeStepSla,
  setRequestTypeStepTerminal,
  updateRequestTypeAttribute,
  updateRequestTypeRule,
} from "@/features/requests/actions";
import { ATTRIBUTE_TYPE_LABELS } from "@/features/requests/attributes";
import { parseRuleLabel } from "@/features/requests/routing";
import { type AttributeDefinition, type RequestType, type RequestTypeDetail, type SlaUnit } from "@/features/requests/types";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { PopSelect } from "@/components/ui/pop-select";
import { Tabs } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { orThrow, Refused } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { ProjectSelect } from "@/components/shared/forms";
import { DataTable } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { AttributeModal } from "./attribute-modal";
import { RequestTypeFlow } from "./request-type-flow";

/** The SLA intervals the designer offers, in the order they read as durations. */
const SLA_UNIT_OPTIONS: [SlaUnit, string, string][] = [
  ["Minutes", "Minutes", "دقائق"],
  ["Hours", "Hours", "ساعات"],
  ["Days", "Days", "أيام"],
  ["BusinessDays", "Business days", "أيام عمل"],
];

/** What an audience may do at a step, as the designer writes it. */
const ACCESS_LABEL: Record<string, [string, string]> = {
  CanAct: ['Can act', 'يمكنه التنفيذ'],
  NotifyOnly: ['Notify only', 'إشعار فقط'],
  ViewOnly: ['View only', 'عرض فقط'],
};

/**
 * The request type designer (S-30): a header with Copy embed code (published widget types),
 * Save draft, Delete and Publish (enabled only on a draft), and tabs for the transition steps
 * with their SLA, audiences and routing rules, the attributes in their order, and the general
 * settings. Every change goes to the server and the page re-reads the type; the General tab's
 * values are read once when the designer opens.
 */
export function RequestTypeDesigner({
  r,
  detail,
  appUrl,
  back,
}: {
  r: RequestType;
  detail: RequestTypeDetail | undefined;
  /** The platform origin the embed snippet points at. */
  appUrl: string;
  back: () => void;
}) {
  const { t } = useAwp();
  const may = useMay();
  const people = usePeople();
  const designerAgents = useAgents();
  const [tab, setTab] = useState("steps");
  const [sel, setSel] = useState(0);
  const [run, pending] = useAction();
  const { act: confirmAction } = useModals();
  const [newStep, setNewStep] = useState("");
  const [newAudience, setNewAudience] = useState("");
  const [newAccess, setNewAccess] = useState("CanAct");
  const [newWhen, setNewWhen] = useState("");
  const [newTarget, setNewTarget] = useState("");
  /** D309: the routing rule being edited in place, by step and 1-based position. */
  const [ruleEdit, setRuleEdit] = useState<{ step: string; position: number; when: string; target: string } | null>(null);
  /** D304: the attribute open in the Add or Edit form; null adds one, undefined is no form. */
  const [attributeForm, setAttributeForm] = useState<AttributeDefinition | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [stepSlaEdit, setStepSlaEdit] = useState<{ step: string; value: number | null; unit: SlaUnit | null } | null>(null);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [showFlow, setShowFlow] = useState(false);
  // The draft's stored settings are what the General tab opens on. Read once, because the
  // designer is mounted afresh for each request type it is opened on.
  const [general, setGeneral] = useState(() => ({
    categoryEn: r.cat || "Finance",
    decomposition: detail?.decomposition ?? "None",
    slaValue: detail?.slaValue ?? null,
    slaUnit: detail?.slaUnit ?? null,
    defaultProjectKey: detail?.defaultProject ?? null,
    intakeChannels: detail?.intakeChannels.length ? detail.intakeChannels : ["Console"],
    entryModes: detail?.entryModes.length ? detail.entryModes : ["TemplateForm"],
  }));
  const steps = detail?.steps ?? [];
  // The published version is what the endpoint serves, so the offer follows the published
  // channels rather than whatever the draft currently lists.
  const widgetIntake = r.st === 'Published' && r.ch.split(',').some((channel) => channel.trim() === 'Widget');
  const embedSnippet = `<div data-awp-request-form></div>\n<script src="${appUrl}/api/request-widget/${r.c}/embed.js" async></script>`;

  /** Runs one designer change and shows whatever the server said about it. */
  const change = (act: () => Promise<void>, done: string) =>
    run(async () => {
      await act();
      return done;
    });
  const s = steps[Math.min(sel, Math.max(0, steps.length - 1))] ?? { n: '—', nAr: '—', slaValue: null, slaUnit: null, aud: [], out: [] };
  // The SLA edit belongs to one step: selecting another drops back to that step's stored
  // values rather than carrying the previous step's half-typed number across.
  const stepSla = stepSlaEdit?.step === s.n ? stepSlaEdit : { step: s.n, value: s.slaValue, unit: s.slaUnit };
  const attributes = detail?.attributes ?? [];
  // D316: a dragged attribute takes its new place at once; the server's order replaces it.
  const [orderedAttributes, moveAttribute] = useOptimistic(attributes, (list, move: { key: string; to: number }) => {
    const moved = list.find((one) => one.key === move.key);
    const rest = list.filter((one) => one.key !== move.key);
    if (moved) rest.splice(move.to, 0, moved);
    return rest;
  });
  const typeLabel = (type: string) => {
    const found = ATTRIBUTE_TYPE_LABELS.find(([one]) => one === type);
    return found ? t(found[1], found[2]) : type;
  };
  const stepLabel = (name: string | null) => {
    if (name === null) return t('Request form', 'نموذج الطلب');
    const step = steps.find((one) => one.n === name);
    return step ? t(step.n, step.nAr) : name;
  };
  // D302: the version the designer edits is what its header shows and what Publish publishes.
  const isDraft = detail?.status === 'Draft';
  return (
    <div className="awp-page">
      <PageHead crumb={<Lnk onClick={back}>{t('Requests / Request types', 'الطلبات / أنواع الطلبات')}</Lnk>} title={t(r.n, r.nAr)} sub={<span className="awp-mono">{r.c} · {detail ? `v${detail.version}` : r.v}</span>}>
        <StTag s={detail?.status ?? r.st} />
        {/* `UC-30.1-04`: a published type that takes widget intake can be raised from an
            external site, and the snippet that does it is copied from here. A draft has
            no published version for the endpoint to read, so there is nothing to embed
            until it is published. */}
        {widgetIntake && (
          <Btn
            type="secondary"
            icon="Copy01"
            label={copiedEmbed ? t('Copied', 'تم النسخ') : t('Copy embed code', 'نسخ كود التضمين')}
            onClick={() => {
              void navigator.clipboard.writeText(embedSnippet);
              setCopiedEmbed(true);
            }}
          />
        )}
        <Btn
          type="secondary"
          label={t('Save draft', 'حفظ المسودة')}
          disabled={pending}
          onClick={() =>
            change(
              async () =>
                orThrow(await saveRequestTypeDraft({
                  code: r.c,
                  categoryEn: general.categoryEn,
                  decomposition: general.decomposition,
                  slaValue: general.slaValue,
                  slaUnit: general.slaUnit,
                  defaultProjectKey: general.defaultProjectKey,
                  intakeChannels: general.intakeChannels,
                  entryModes: general.entryModes,
                })),
              t('Draft saved.', 'تم حفظ المسودة.'),
            )
          }
        />
        {/* D293: the type and every version of it; its requests only when asked. */}
        {may('request_types:write') && (
          <Btn
            type="secondary"
            label={t('Delete', 'حذف')}
            disabled={pending}
            onClick={() => {
              const withRequests = t('Also delete its requests and their history', 'حذف طلباته وسجلها أيضاً');
              confirmAction({
                title: t('Delete request type', 'حذف نوع الطلب'),
                desc: t(
                  'Deletes this type with every version, draft and published. A type with requests is refused unless its requests are deleted with it, which cannot be undone. Work items, schedules, storyline steps and approvals that still use it block the delete.',
                  'يحذف هذا النوع بكل إصداراته، المسودة والمنشورة. يُرفض حذف نوع له طلبات ما لم تُحذف طلباته معه، ولا يمكن التراجع عن ذلك. تمنع بنود العمل والجدولات وخطوات القصص والموافقات التي لا تزال تستخدمه الحذف.',
                ),
                danger: true,
                confirm: t('Delete', 'حذف'),
                fields: [[t('Requests', 'الطلبات'), t('Keep them: refuse if any', 'إبقاؤها: يُرفض إن وُجدت'), 'select', [t('Keep them: refuse if any', 'إبقاؤها: يُرفض إن وُجدت'), withRequests]]],
                onDone: (values) =>
                  run(async () => {
                    orThrow(await deleteRequestType({ code: r.c, withRequests: values?.[0] === withRequests }));
                    back();
                    return t('Request type deleted.', 'حُذف نوع الطلب.');
                  }),
              });
            }}
          />
        )}
        {/* `UC-30.4-02`: a person who may not publish is still offered Save draft. */}
        {may('request_types:publish') && (
          <Btn
            label={t('Publish', 'نشر')}
            disabled={pending || !isDraft}
            title={isDraft ? undefined : t('Nothing to publish: this version is already published. A change opens a new draft.', 'لا شيء للنشر: هذا الإصدار منشور. أي تغيير يفتح مسودة جديدة.')}
            onClick={() =>
              change(
                async () => orThrow(await publishRequestType({ code: r.c })),
                t('Published.', 'تم النشر.'),
              )
            }
          />
        )}
      </PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[{ id: 'steps', label: t('Transition steps', 'خطوات الانتقال'), count: steps.length }, { id: 'attrs', label: t('Attributes', 'السمات'), count: attributes.length }, { id: 'general', label: t('General', 'عام') }]}
        end={tab === 'steps' && <Btn type="secondary" label={t('View workflow', 'عرض سير العمل')} onClick={() => setShowFlow(true)} />}
      />
      {showFlow && <RequestTypeFlow steps={steps} onClose={() => setShowFlow(false)} />}
      {tab === 'steps' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,340px) minmax(0,1fr)', gap: 16 }} className="awp-two">
          <Card
            title={t('Steps', 'الخطوات')}
            actions={
              <Btn
                type="secondary"
                label={t('Add step', 'إضافة خطوة')}
                disabled={pending || newStep.trim() === ''}
                onClick={() =>
                  change(async () => {
                    orThrow(await addRequestTypeStep({ code: r.c, nameEn: newStep, nameAr: newStep }));
                    setNewStep('');
                  }, t('Step added.', 'تمت إضافة الخطوة.'))
                }
              />
            }
            pad={false}
          >
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-divider)' }}>
              <input
                className="awp-input"
                value={newStep}
                onChange={(e) => setNewStep(e.target.value)}
                placeholder={t('New step name', 'اسم الخطوة الجديدة')}
                aria-label={t('New step name', 'اسم الخطوة الجديدة')}
              />
            </div>
            {steps.map((x, i) => (
              <button key={x.n} onClick={() => setSel(i)} style={{ width: '100%', border: 0, borderBottom: '1px solid var(--border-divider)', background: sel === i ? 'var(--surface-brand-subtle)' : 'transparent', padding: '12px 16px', textAlign: 'start', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="awp-mono awp-muted" style={{ width: 18 }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{t(x.n, x.nAr)}</div>
                  <div className="awp-small awp-muted">{x.aud.length ? t(x.aud[0][0], x.aud[0][1]) : t('Terminal', 'نهائية')}</div>
                </div>
                <span className="awp-small awp-muted">{x.out.length} →</span>
              </button>
            ))}
          </Card>
          <div className="awp-col" style={{ gap: 16 }}>
            <Card title={t('Step', 'الخطوة') + ' · ' + t(s.n, s.nAr)}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label={t('Step name', 'اسم الخطوة')}>
                  <input className="awp-input" defaultValue={t(s.n, s.nAr)} key={s.n} readOnly />
                </Field>
                {/* `UC-30.1-01`: the step's own clock — a count and the interval it
                    counts, saved as one change so neither half can stand alone. */}
                <Field label={t('Step SLA', 'اتفاقية الخطوة')}>
                  <div className="awp-row" style={{ gap: 8 }}>
                    <input
                      className="awp-input"
                      type="number"
                      min={1}
                      value={stepSla.value ?? ''}
                      onChange={(e) => setStepSlaEdit({ step: s.n, value: e.target.value === '' ? null : Number(e.target.value), unit: stepSla.unit })}
                      aria-label={t('Step SLA', 'اتفاقية الخطوة')}
                    />
                    <PopSelect
                      className="awp-input"
                      style={{ width: 160 }}
                      value={stepSla.unit ?? ''}
                      onChange={(e) => setStepSlaEdit({ step: s.n, value: stepSla.value, unit: (e.target.value || null) as SlaUnit | null })}
                      aria-label={t('Step SLA unit', 'وحدة اتفاقية الخطوة')}
                    >
                      <option value="">—</option>
                      {SLA_UNIT_OPTIONS.map(([unit, en, ar]) => (
                        <option key={unit} value={unit}>{t(en, ar)}</option>
                      ))}
                    </PopSelect>
                    <Btn
                      type="secondary"
                      label={t('Set', 'تعيين')}
                      disabled={pending}
                      onClick={() =>
                        change(
                          async () =>
                            orThrow(
                              await setRequestTypeStepSla({
                                code: r.c,
                                stepName: s.n,
                                slaValue: stepSla.value,
                                slaUnit: stepSla.unit,
                              }),
                            ),
                          t('Step SLA saved.', 'تم حفظ اتفاقية الخطوة.'),
                        )
                      }
                    />
                  </div>
                </Field>
              </div>
              <div className="awp-row" style={{ gap: 12, marginTop: 10, alignItems: 'center' }}>
                {/* `UC-30.2-04`: marking a step terminal clears what a terminal step may not have. */}
                <Lnk
                  onClick={() =>
                    change(
                      async () =>
                        orThrow(
                          await setRequestTypeStepTerminal({
                            code: r.c,
                            stepName: s.n,
                            terminal: s.aud.length > 0 || s.out.length > 0,
                            outcome: 'Completed',
                          }),
                        ),
                      t('Step updated.', 'تم تحديث الخطوة.'),
                    )
                  }
                >
                  {s.aud.length === 0 && s.out.length === 0 ? t('Make it a normal step', 'جعلها خطوة عادية') : t('Mark terminal', 'جعلها نهائية')}
                </Lnk>
                {/* A terminal step says what a request is left as: a Reject action routed
                    here must leave the request Rejected, not indistinguishable from one a
                    flow actually completed. */}
                {s.aud.length === 0 && s.out.length === 0 && (
                  <Lnk
                    onClick={() =>
                      change(
                        async () =>
                          orThrow(
                            await setRequestTypeStepTerminal({
                              code: r.c,
                              stepName: s.n,
                              terminal: true,
                              outcome: s.terminalOutcome === 'Rejected' ? 'Completed' : 'Rejected',
                            }),
                          ),
                        t('Step updated.', 'تم تحديث الخطوة.'),
                      )
                    }
                  >
                    {s.terminalOutcome === 'Rejected'
                      ? t('Ends as: Rejected', 'تنتهي بـ: مرفوض')
                      : t('Ends as: Completed', 'تنتهي بـ: مكتمل')}
                  </Lnk>
                )}
                {/* `UC-30.2-01`: the order is the flow's; the first step is where a request starts. */}
                {[
                  [-1, t('Move up', 'نقل للأعلى')],
                  [1, t('Move down', 'نقل للأسفل')],
                ].map(([delta, label]) => {
                  const position = steps.indexOf(s) + 1 + (delta as number);
                  return position >= 1 && position <= steps.length ? (
                    <Lnk
                      key={label as string}
                      onClick={() =>
                        change(async () => {
                          orThrow(await moveRequestTypeStep({ code: r.c, stepName: s.n, position }));
                          setSel(position - 1);
                        }, t('Step moved.', 'تم نقل الخطوة.'))
                      }
                    >
                      {label}
                    </Lnk>
                  ) : null;
                })}
                {/* `UC-30.2-09`: deleting names the rules that point at the step first. */}
                <Lnk
                  danger
                  onClick={() =>
                    run(async () => {
                      const outcome = orThrow(await deleteRequestTypeStep({ code: r.c, stepName: s.n, confirmed: deleting === s.n }));
                      if (outcome.removed) {
                        setDeleting(null);
                        return t('Step deleted.', 'تم حذف الخطوة.');
                      }
                      // `UC-30.2-09`: the rules that point at it are named, and the second
                      // click is the confirmation.
                      setDeleting(s.n);
                      throw new Refused({
                        reason: `These rules point at it: ${outcome.referencedBy.join('; ')}. Delete anyway?`,
                        reasonAr: `تشير إليها هذه القواعد: ${outcome.referencedBy.join('؛ ')}. هل تُحذف على أي حال؟`,
                      });
                    })
                  }
                >
                  {t('Delete step', 'حذف الخطوة')}
                </Lnk>
              </div>
            </Card>
            <Card
              title={t('Audiences', 'الجمهور')}
              actions={
                <Btn
                  type="secondary"
                  label={t('Add audience', 'إضافة جمهور')}
                  disabled={pending || newAudience === ''}
                  onClick={() =>
                    change(async () => {
                      // `agent:<code>` marks an agent audience; `UC-30.2-02` treats it as
                      // one more principal, and at run time the step starts it.
                      const isAgent = newAudience.startsWith('agent:');
                      orThrow(await addRequestTypeAudience({
                        code: r.c,
                        stepName: s.n,
                        principalType: newAudience === 'requester' ? 'Requester' : isAgent ? 'Agent' : 'Person',
                        principalId: newAudience === 'requester' ? null : isAgent ? newAudience.slice('agent:'.length) : newAudience,
                        access: newAccess,
                      }));
                      setNewAudience('');
                    }, t('Audience added.', 'تمت إضافة الجمهور.'))
                  }
                />
              }
              pad={false}
            >
              <div className="awp-row" style={{ padding: '10px 20px', gap: 8, borderBottom: '1px solid var(--border-divider)' }}>
                <PopSelect className="awp-input" value={newAudience} onChange={(e) => setNewAudience(e.target.value)} aria-label={t('Audience', 'الجمهور')}>
                  <option value="">{t('Choose…', 'اختر…')}</option>
                  <option value="requester">{t('The requester', 'مقدم الطلب')}</option>
                  <optgroup label={t('People', 'الأشخاص')}>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                  {/* An agent audience works the step itself: when the request lands here
                      the platform starts a run for it (`triggerAgentAudience`). */}
                  <optgroup label={t('Agents', 'الوكلاء')}>
                    {designerAgents.map((agent) => (
                      <option key={agent.id} value={`agent:${agent.id}`}>{t(agent.name, agent.nameAr)}</option>
                    ))}
                  </optgroup>
                </PopSelect>
                <PopSelect className="awp-input" style={{ width: 160 }} value={newAccess} onChange={(e) => setNewAccess(e.target.value)} aria-label={t('Access', 'الصلاحية')}>
                  <option value="CanAct">{t('Can act', 'يمكنه التنفيذ')}</option>
                  <option value="NotifyOnly">{t('Notify only', 'إشعار فقط')}</option>
                  <option value="ViewOnly">{t('View only', 'عرض فقط')}</option>
                </PopSelect>
              </div>
              {s.aud.length ? (
                s.aud.map(([en, ar, access], index) => (
                  <div key={en} className="awp-row" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-divider)', gap: 10 }}>
                    <Ic n={en.includes('agent') ? 'User' : 'UsersFill'} s={18} />
                    <span style={{ flex: 1 }}>{t(en, ar)}</span>
                    {/* `UC-30.2-02`: the access is chosen when the audience is added. */}
                    <Tg label={t(ACCESS_LABEL[access]?.[0] ?? access, ACCESS_LABEL[access]?.[1] ?? access)} />
                    <Btn
                      type="ghost"
                      label={t('Remove', 'إزالة')}
                      disabled={pending}
                      onClick={() =>
                        change(
                          async () => orThrow(await removeRequestTypeAudience({ code: r.c, stepName: s.n, position: index + 1 })),
                          t('Audience removed.', 'تمت إزالة الجمهور.'),
                        )
                      }
                    />
                  </div>
                ))
              ) : (
                <p className="awp-muted" style={{ margin: 0, padding: 20 }}>{t('Terminal step — no audience.', 'خطوة نهائية — بلا جمهور.')}</p>
              )}
            </Card>
            <Card
              title={t('Routing rules to next steps', 'قواعد التوجيه للخطوات التالية')}
              actions={
                <Btn
                  type="secondary"
                  label={t('Add rule', 'إضافة قاعدة')}
                  disabled={pending || newWhen.trim() === '' || newTarget === ''}
                  title={newWhen.trim() === ''
                    ? t('Type the action or condition first.', 'اكتب الإجراء أو الشرط أولاً.')
                    : newTarget === '' ? t('Choose the step to go to.', 'اختر الخطوة التالية.') : undefined}
                  onClick={() =>
                    change(async () => {
                      orThrow(await addRequestTypeRule({ code: r.c, stepName: s.n, ...parseRuleLabel(newWhen), toStepName: newTarget }));
                      setNewWhen('');
                    }, t('Rule added.', 'تمت إضافة القاعدة.'))
                  }
                />
              }
              pad={false}
            >
              <div className="awp-row" style={{ padding: '10px 20px', gap: 8, borderBottom: '1px solid var(--border-divider)' }}>
                <input
                  className="awp-input"
                  value={newWhen}
                  onChange={(e) => setNewWhen(e.target.value)}
                  // Suggests the type's own actions and attributes; the placeholder must not read as a filled rule.
                  placeholder={t('Action or condition, e.g. Approve if amount_aed >= 5000', 'إجراء أو شرط، مثل Approve if amount_aed >= 5000')}
                  list="awp-rule-when"
                  aria-label={t('When', 'عندما')}
                />
                <datalist id="awp-rule-when">
                  {[...new Set(['Approve', 'Reject', ...steps.flatMap((step) => step.out.map(([when]) => parseRuleLabel(when).actionName ?? '')).filter(Boolean)])].map((action) => (
                    <option key={action} value={action} />
                  ))}
                  {(detail?.attributes ?? []).map((a) => (
                    <option key={a.key} value={`${a.key} = `}>{t(a.labelEn, a.labelAr)}</option>
                  ))}
                </datalist>
                <PopSelect className="awp-input" style={{ width: 200 }} value={newTarget} onChange={(e) => setNewTarget(e.target.value)} aria-label={t('Go to step', 'الانتقال إلى')}>
                  <option value="">{t('Go to step…', 'الانتقال إلى…')}</option>
                  {steps.map((step) => (
                    <option key={step.n} value={step.n}>{t(step.n, step.nAr)}</option>
                  ))}
                </PopSelect>
              </div>
              {s.out.length ? (
                <DataTable
                  rows={s.out}
                  cols={[
                    {
                      h: t('When', 'عندما'),
                      r: (o) => {
                        const editing = ruleEdit?.step === s.n && ruleEdit.position === s.out.indexOf(o) + 1 ? ruleEdit : null;
                        return editing ? (
                          <input
                            className="awp-input"
                            value={editing.when}
                            onChange={(e) => setRuleEdit({ ...editing, when: e.target.value })}
                            list="awp-rule-when"
                            aria-label={t('When', 'عندما')}
                          />
                        ) : (
                          <span className="awp-mono">{t(o[0], o[1])}</span>
                        );
                      },
                    },
                    {
                      h: t('Go to step', 'الانتقال إلى'),
                      r: (o) => {
                        const editing = ruleEdit?.step === s.n && ruleEdit.position === s.out.indexOf(o) + 1 ? ruleEdit : null;
                        return editing ? (
                          <PopSelect className="awp-input" value={editing.target} onChange={(e) => setRuleEdit({ ...editing, target: e.target.value })} aria-label={t('Go to step', 'الانتقال إلى')}>
                            {steps.map((step) => (
                              <option key={step.n} value={step.n}>{t(step.n, step.nAr)}</option>
                            ))}
                          </PopSelect>
                        ) : (
                          <b>{o[2]}</b>
                        );
                      },
                    },
                    {
                      h: '',
                      r: (o) => {
                        const position = s.out.indexOf(o) + 1;
                        const editing = ruleEdit?.step === s.n && ruleEdit.position === position ? ruleEdit : null;
                        return editing ? (
                          <div className="awp-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <Btn
                              type="secondary"
                              label={t('Save', 'حفظ')}
                              disabled={pending || editing.when.trim() === ''}
                              onClick={() =>
                                change(async () => {
                                  orThrow(await updateRequestTypeRule({ code: r.c, stepName: s.n, position, ...parseRuleLabel(editing.when), toStepName: editing.target || null }));
                                  setRuleEdit(null);
                                }, t('Rule saved.', 'تم حفظ القاعدة.'))
                              }
                            />
                            <Btn type="ghost" label={t('Cancel', 'إلغاء')} disabled={pending} onClick={() => setRuleEdit(null)} />
                          </div>
                        ) : (
                          <div className="awp-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <Btn
                              type="ghost"
                              label={t('Edit', 'تعديل')}
                              disabled={pending}
                              onClick={() => setRuleEdit({ step: s.n, position, when: o[0], target: o[2] })}
                            />
                            <Btn
                              type="ghost"
                              label={t('Remove', 'إزالة')}
                              disabled={pending}
                              onClick={() =>
                                change(
                                  async () => orThrow(await removeRequestTypeRule({ code: r.c, stepName: s.n, position })),
                                  t('Rule removed.', 'تمت إزالة القاعدة.'),
                                )
                              }
                            />
                          </div>
                        );
                      },
                    },
                  ]}
                />
              ) : (
                <p className="awp-muted" style={{ margin: 0, padding: 20 }}>{t('No outgoing transitions.', 'لا توجد انتقالات صادرة.')}</p>
              )}
            </Card>
          </div>
        </div>
      )}
      {tab === 'attrs' && (
        <Card
          title={t('Attributes', 'السمات')}
          pad={false}
          actions={<Btn type="secondary" label={t('Add attribute', 'إضافة سمة')} disabled={pending} onClick={() => setAttributeForm(null)} />}
        >
          <DataTable
            rows={orderedAttributes}
            rowKey={(a) => a.key}
            // D316: the order here is the order the request form and each step ask them in.
            onMove={(a, to) =>
              run(async () => {
                moveAttribute({ key: a.key, to });
                orThrow(await updateRequestTypeAttribute({ code: r.c, key: a.key, position: to + 1 }));
              })
            }
            cols={[
              {
                h: t('Attribute', 'السمة'),
                r: (a) => (
                  <div>
                    <div>{t(a.labelEn, a.labelAr)}</div>
                    <div className="awp-small awp-muted awp-mono">{a.key}</div>
                  </div>
                ),
              },
              { h: t('Type', 'النوع'), r: (a) => typeLabel(a.dataType) },
              { h: t('Asked on', 'يُطلب في'), r: (a) => stepLabel(a.stepName) },
              { h: '', r: (a) => (a.required ? t('Required', 'إلزامي') : t('Optional', 'اختياري')) },
              { h: t('Choices', 'الخيارات'), r: (a) => (a.enumValues ?? []).map((option) => t(option.labelEn, option.labelAr)).join(', ') },
              {
                h: '',
                // `UC-30.3-03`: removing one takes it out of the draft, so new requests stop
                // asking for it. What open requests already answered is theirs and stays.
                r: (a) => (
                  <div className="awp-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <Btn type="ghost" label={t('Edit', 'تعديل')} disabled={pending} onClick={() => setAttributeForm(a)} />
                    <Btn
                      type="ghost"
                      label={t('Remove', 'إزالة')}
                      disabled={pending}
                      onClick={() =>
                        change(
                          async () => orThrow(await removeRequestTypeAttribute({ code: r.c, key: a.key })),
                          t('Attribute removed.', 'تمت إزالة السمة.'),
                        )
                      }
                    />
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}
      {attributeForm !== undefined && (
        <AttributeModal code={r.c} attribute={attributeForm} attributes={attributes} steps={steps} onClose={() => setAttributeForm(undefined)} />
      )}
      {tab === 'general' && (
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: 16 }}>
            <Field label={t('Category', 'الفئة')}>
              <PopSelect
                className="awp-input"
                value={general.categoryEn}
                onChange={(e) => setGeneral({ ...general, categoryEn: e.target.value })}
              >
                {['Finance', 'Procurement', 'Customer', 'HR', 'IT'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </PopSelect>
            </Field>
            <Field label={t('Decomposition', 'التجزئة')}>
              <PopSelect
                className="awp-input"
                value={general.decomposition}
                onChange={(e) => setGeneral({ ...general, decomposition: e.target.value })}
              >
                {['None', 'Template', 'Agent', 'Hybrid'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </PopSelect>
            </Field>
            <Field label={t('SLA', 'اتفاقية الخدمة')}>
              <div className="awp-row" style={{ gap: 8 }}>
                <input
                  className="awp-input"
                  type="number"
                  min={1}
                  value={general.slaValue ?? ''}
                  onChange={(e) => setGeneral({ ...general, slaValue: e.target.value === '' ? null : Number(e.target.value) })}
                  aria-label={t('SLA', 'اتفاقية الخدمة')}
                />
                <PopSelect
                  className="awp-input"
                  style={{ width: 160 }}
                  value={general.slaUnit ?? ''}
                  onChange={(e) => setGeneral({ ...general, slaUnit: (e.target.value || null) as SlaUnit | null })}
                  aria-label={t('SLA unit', 'وحدة الاتفاقية')}
                >
                  <option value="">—</option>
                  {SLA_UNIT_OPTIONS.map(([unit, en, ar]) => (
                    <option key={unit} value={unit}>{t(en, ar)}</option>
                  ))}
                </PopSelect>
              </div>
            </Field>
            <Field label={t('Default project', 'المشروع الافتراضي')}>
              <ProjectSelect
                value={general.defaultProjectKey ?? detail?.defaultProject ?? undefined}
                onChange={(key: string) => setGeneral({ ...general, defaultProjectKey: key })}
              />
            </Field>
            {/* D306: of the intake channels only the external widget is offered; the others keep what is stored. */}
            <Field label={t('Embed on a website', 'التضمين في موقع إلكتروني')} hint={t('Lets an external site raise this type through the request widget once it is published.', 'يتيح لموقع خارجي رفع هذا النوع عبر أداة الطلبات بعد نشره.')}>
              <Toggle
                on={general.intakeChannels.includes('Widget')}
                onChange={(on) =>
                  setGeneral({
                    ...general,
                    // A type always takes at least one channel; without the widget that is the console.
                    intakeChannels: on
                      ? [...general.intakeChannels, 'Widget']
                      : general.intakeChannels.filter((one) => one !== 'Widget').concat(general.intakeChannels.length === 1 ? ['Console'] : []),
                  })
                }
              />
            </Field>
            {/* `UC-30.1-02`: a type nobody can enter a request through cannot be saved. */}
            <Field group label={t('Entry modes', 'طرق الإدخال')}>
              <div className="awp-row" style={{ gap: 6 }}>
                {(
                  [
                    ['TemplateForm', t('Template form', 'نموذج القالب')],
                    ['AgenticInteractive', t('Agentic interactive', 'تفاعلي بالوكيل')],
                  ] as [string, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={'awp-chip' + (general.entryModes.includes(id) ? ' on' : '')}
                    onClick={() =>
                      setGeneral({
                        ...general,
                        entryModes: general.entryModes.includes(id)
                          ? general.entryModes.filter((one) => one !== id)
                          : [...general.entryModes, id],
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {general.entryModes.length === 0 && (
                <p className="awp-small" style={{ margin: '6px 0 0', color: 'var(--text-danger)' }} role="alert">
                  {t('Select at least one entry mode', 'اختر طريقة إدخال واحدة على الأقل')}
                </p>
              )}
            </Field>
          </div>
        </Card>
      )}
    </div>
  );
}
