"use client";

import { useState, useTransition } from "react";

import { useAgents, useMay } from "@/components/shared/directory";
import {
  activateVersion,
  deleteAgent,
  resetBuiltinToDefaults,
  saveDraft,
  setKnowledgeAccess,
  setMemoryAccess,
  setSkill,
  changeSkills,
  type ToolConfiguration,
} from "@/features/agents/actions";
import { BUILTIN_AGENT_CODE } from "@/features/agents/builtin";
import { ConnectorTools } from "@/features/agents/components/connector-tools";
import { GrantPicker } from "@/features/agents/components/grant-picker";
import { AGENT_STATUSES } from "@/db/schema/enums";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { type AgentDetail } from "@/features/agents/types";
import { formatDay } from "@/i18n";
import { useGo, useScreenParams } from "@/lib/routes";
import { DataTable } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { AgentTag, StTag } from "@/components/shared/status-tags";
import { AgentAv } from "@/components/ui/avatar";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, Tabs } from "@/components/ui/tabs";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { useAwp } from "@/hooks/use-awp";
import { orThrow } from "@/lib/outcome";
import { AgentRuns, type AgentRunsPage } from "./agent-runs";
import { NewAgentModal } from "./new-agent-modal";
import { PublishModal } from "./publish-modal";
import { ConfigurationModal } from "./configuration-modal";

/**
 * The Agents screen (S-50, S-51). With no agent in the address it lists the agents, filtered by
 * status and name from the address, and offers New agent. With one it renders that agent's
 * detail: overview, instructions, skills, connector tools, knowledge, memory, runs and versions
 * tabs, and the publish, delete and reset actions the person's permissions allow (D382: no
 * playground button; `agent_test_run_create` still tests an agent from the Assistant). A
 * system agent is not listed unless it is the built-in Assistant, and editing that also needs
 * `agents:configure`. Server refusals are shown in place rather than swallowed.
 */
export function Agents({
  details,
  units,
  routes,
  toolConfiguration,
  runs,
  runCount,
}: {
  details: Record<string, AgentDetail>;
  units: { id: string; nameEn: string; nameAr: string }[];
  routes: string[];
  /** #20b: the open agent's platform-tool grant, read for that agent alone. Null when no
   * agent is open, or when it has no active version to read a grant from. */
  toolConfiguration: ToolConfiguration | null;
  /** D349: one page of the open agent's runs, read only while its Runs tab is open. */
  runs?: AgentRunsPage | null;
  /** How many runs the open agent has, for its Runs tab. */
  runCount?: number;
}) {
  const { t, lang, nm, aName, aed, why } = useAwp();
  const go = useGo();
  // A system agent is configured natively and carries no screen of its own. The
  // built-in Assistant does: D65 keeps its skills, tools, knowledge, memory, model and
  // budgets configurable, and section 9 of the runtime specification puts them here.
  const agents = useAgents().filter((agent) => !agent.isSystem || agent.id === BUILTIN_AGENT_CODE);
  const may = useMay();
  const p = useScreenParams();
  // Read from the URL, not mirrored into state. Which agent is open and which tab it is on
  // are addressable: the org chart links straight to one, a run viewer links back, and a
  // reload has to land where the person was. A copy in state meant the card could open an
  // agent the URL did not name, so those entry points disagreed.
  const sel = p.agent || null;
  // An address naming the `grant` tab opens Connector tools, where the Platform connector is (D228).
  const tab = p.tab === 'grant' ? 'tools' : p.tab || 'overview';
  const openAgent = (code: string | null, onTab = 'overview') =>
    code ? go('agents', { agent: code, tab: onTab }) : go('agents');
  const openTab = (next: string) => (sel ? go('agents', { agent: sel, tab: next }) : undefined);
  const [creating, setCreating] = useState(false);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pickingSkills, setPickingSkills] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [saving, startSave] = useTransition();

  /**
   * Run a change against the server and show what came back.
   *
   * Every one of these is a draft edit, and every one of them can be refused for a reason
   * the person needs to read — a tool mode looser than its tier allows, a route that no
   * longer exists. Swallowing that would leave the control looking as though it worked.
   */
  const save = (run: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: () => void) =>
    startSave(async () => {
      setProblem(null);
      const result = await run();
      if (result.ok) done?.();
      else setProblem(why(result));
    });
  // An agent that has never been used is gone; one that has is refused, with what is still
  // using it (`service.deleteAgent`), the same as the org units screen refuses a unit still
  // in use rather than silently keeping it.
  const removeAgent = (code: string) =>
    startSave(async () => {
      setProblem(null);
      try {
        orThrow(await deleteAgent({ code }));
        openAgent(null);
      } catch (refusal) {
        setProblem(refusal instanceof Error ? refusal.message : String(refusal));
      }
    });
  const filter = useFilterQuery();
  const status = p.status || 'all';
  const query = p.q || '';

  // `UC-50.1-02`: the list filters by status and by name. Every agent is already here — the
  // directory is the whole set, not a page of it — so this is the complete answer, and the
  // choice lives in the URL so a reload keeps it.
  const shown = agents.filter(
    (agent) =>
      (status === 'all' || agent.status.toLowerCase() === status) &&
      (!query || nm(agent).toLowerCase().includes(query.toLowerCase())),
  );
  // `UC-50.2-05`: counted over every agent, not the filtered view, so the figure does not
  // change as someone narrows the list.
  const inError = agents.filter((agent) => agent.status === 'Error').length;
  const trustOptions: [string, string][] = [['Restricted', 'مقيد'], ['Standard', 'قياسي'], ['Elevated', 'مرتفع'], ['Coordinator', 'منسق'], ['System', 'النظام']];
  const a = sel ? agents.find((x) => x.id === sel) : undefined;
  const d = a ? details[a.id] : undefined;
  if (a && d) {
    // D65 and Q-A: the built-in Assistant is the one agent the platform itself depends
    // on, so changing it needs `agents:configure` on top of the right to design an agent.
    // Both, because that is what the server asks for: the per-field writes still check
    // `agents:write`, and only "Reset to defaults" checks `agents:configure`. The server
    // decides either way; this stops offering a control that would be refused.
    const builtin = a.id === BUILTIN_AGENT_CODE;
    const canEdit = may('agents:write') && (!builtin || may('agents:configure'));
    // D65: back to the configuration the platform shipped with, onto the draft like every
    // other change here. Runs, memory and the audit trail are history, and are left alone.
    const restoreDefaults = () =>
      startSave(async () => {
        setProblem(null);
        const result = await resetBuiltinToDefaults({ code: a.id });
        if (result.ok) setResetting(false);
        else setProblem(why(result));
      });
    const stats: [string, string][] = [
      [t('Runs', 'العمليات'), d.stats.runs.toLocaleString()],
      [t('Success rate', 'معدل النجاح'), `${d.stats.successRatePct}%`],
      [t('Estimated cost', 'التكلفة التقديرية'), aed(d.stats.cost)],
      [t('Eval score', 'درجة التقييم'), d.stats.evalScore === null ? '—' : String(d.stats.evalScore)],
    ];
    return (
      <div className="awp-page">
        <PageHead
          crumb={<Lnk onClick={() => openAgent(null)}>{t('AI Capabilities / Agents', 'قدرات الذكاء الاصطناعي / الوكلاء')}</Lnk>}
          title={<span className="awp-row" style={{ gap: 14 }}><AgentAv a={a} s={48} />{nm(a)}</span>}
          sub={t(a.unit, a.unitAr) + ' · ' + a.ver + ' ' + t('active', 'نشط')}
        >
          <AgentTag s={a.status} />
          {/* D65: the built-in Assistant has no delete action at all. The server refuses
              it, and a button that only ever produces a refusal is not a control. */}
          {builtin && may('agents:configure') && (
            <Btn
              type="secondary"
              label={t('Reset to defaults', 'إعادة الضبط إلى الافتراضي')}
              disabled={saving}
              onClick={() => setResetting(true)}
            />
          )}
          {/* `UC-51.3-05`: publishing is a different right from designing. Deleting is gated
              the same way: it is at least as consequential as publishing. */}
          {!builtin && may('agents:publish') && (
            <Btn type="danger" label={t('Delete agent', 'حذف الوكيل')} disabled={saving} onClick={() => removeAgent(a.id)} />
          )}
          {may('agents:publish') && (
            <Btn label={t('Publish new version', 'نشر إصدار جديد')} onClick={() => setPublishing(true)} />
          )}
        </PageHead>
        <Tabs
          value={tab}
          onChange={openTab}
          items={[
            { id: 'overview', label: t('Overview', 'نظرة عامة') },
            { id: 'instr', label: t('Instructions', 'التعليمات') },
            { id: 'skills', label: t('Skills', 'المهارات'), count: d.skills.length },
            { id: 'tools', label: t('Connector tools', 'أدوات التكامل'), count: d.tools.length + (toolConfiguration?.granted.length ?? 0) },
            { id: 'knowledge', label: t('Knowledge', 'المعرفة'), count: d.knowledge.filter((collection) => collection.granted).length },
            { id: 'memory', label: t('Memory', 'الذاكرة'), count: d.memory.filter((scope) => scope.granted).length },
            { id: 'runs', label: t('Agent run list', 'قائمة عمليات الوكيل'), count: runCount },
            { id: 'versions', label: t('Versions', 'الإصدارات'), count: d.versions.length },
          ]}
        />
        {/* `UC-51.2-01`: the tabs show the draft an edit lands on, which runs do not use yet. */}
        {d.draft && (
          <p className="awp-small awp-muted" role="status" style={{ margin: '0 0 12px' }}>
            {t(
              `Showing draft ${d.draft}. Runs use ${a.ver} until you publish it.`,
              `تُعرض المسودة ${d.draft}. تستخدم العمليات ${a.ver} حتى تنشرها.`,
            )}
          </p>
        )}
        {problem && (
          <p role="alert" style={{ margin: 0, color: 'var(--feedback-danger-text)' }}>
            {problem}
          </p>
        )}
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }} className="awp-two">
            <Card
              title={t('Configuration', 'الإعدادات')}
              actions={
                canEdit ? (
                  <Lnk onClick={() => setConfiguring(true)}>{t('Edit', 'تعديل')}</Lnk>
                ) : undefined
              }
            >
              <dl className="awp-kv" style={{ margin: 0 }}>
                <dt>{t('Execution profile', 'ملف التنفيذ')}</dt>
                <dd className="awp-mono">{d.profile}</dd>
                <dt>{t('Primary model', 'النموذج الأساسي')}</dt>
                <dd className="awp-mono">{d.model}</dd>
                <dt>{t('Fallback route', 'مسار بديل')}</dt>
                <dd className="awp-mono">{d.fallbackModel ?? t('None', 'لا يوجد')}</dd>
                <dt>{t('Reports to', 'يتبع')}</dt>
                <dd>{d.reportsTo ?? '—'}</dd>
                <dt>{t('Agent trust', 'ثقة الوكيل')}</dt>
                <dd>{t(d.trust, trustOptions.find(([v]) => v === d.trust)?.[1] ?? d.trust)}</dd>
                <dt>{t('Memory', 'الذاكرة')}</dt>
                <dd>{d.memoryEnabled ? t('Agent memory on', 'ذاكرة الوكيل مفعلة') : t('Off', 'معطلة')}</dd>
                <dt>{t('Run budget', 'ميزانية العملية')}</dt>
                <dd>{t(`${aed(d.budgetSoft ?? 0)} soft · ${aed(d.budgetHard ?? 0)} hard`, `${aed(d.budgetSoft ?? 0)} مرن · ${aed(d.budgetHard ?? 0)} صارم`)}</dd>
              </dl>
            </Card>
            <Card title={t('Last 30 days', 'آخر 30 يوماً')} actions={<Lnk onClick={() => openTab('runs')}>{t('View runs', 'عرض العمليات')}</Lnk>}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {stats.map(([k, v]) => (
                  <div key={k}>
                    <div className="awp-small awp-muted">{k}</div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{v}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
        {tab === 'instr' && (
          <Card
            title={t('System instructions', 'تعليمات النظام')}
            actions={
              canEdit ? (
                editingInstructions ? (
                  <div className="awp-row" style={{ gap: 8 }}>
                    <Btn type="secondary" label={t('Cancel', 'إلغاء')} onClick={() => setEditingInstructions(false)} />
                    <Btn
                      label={t('Save', 'حفظ')}
                      disabled={saving}
                      onClick={() =>
                        save(() => saveDraft({ code: a.id, instructions: draftText }), () => setEditingInstructions(false))
                      }
                    />
                  </div>
                ) : (
                  <Btn
                    type="secondary"
                    label={t('Edit', 'تعديل')}
                    onClick={() => {
                      setDraftText(d.instructions);
                      setEditingInstructions(true);
                    }}
                  />
                )
              ) : undefined
            }
          >
            {editingInstructions ? (
              <textarea
                className="awp-input awp-mono"
                rows={16}
                dir="ltr"
                style={{ width: '100%', lineHeight: 1.7 }}
                aria-label={t('System instructions', 'تعليمات النظام')}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
              />
            ) : (
              <pre className="awp-mono" style={{ margin: 0, whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', lineHeight: 1.7 }}>{d.instructions}</pre>
            )}
            {/* `UC-51.2-01`: an edit is a draft revision, not a change to what is running. */}
            <p className="awp-small awp-muted" style={{ marginTop: 10 }}>
              {t('Saved as a draft revision. Publishing makes it the version new runs use.', 'يُحفظ كمسودة. النشر يجعلها الإصدار المستخدم في العمليات الجديدة.')}
            </p>
          </Card>
        )}
        {tab === 'skills' && (
          <Card pad={false}>
            {canEdit && (
              <div className="awp-row" style={{ padding: '12px 20px', justifyContent: 'flex-end', borderBottom: '1px solid var(--border-divider)' }}>
                <Btn type="secondary" label={t('Add or remove skills', 'إضافة مهارات أو إزالتها')} icon="AddCircle" disabled={saving} onClick={() => setPickingSkills(true)} />
              </div>
            )}
            {d.skills.map((skill) => (
              <div key={skill.name} className="awp-row" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-divider)' }}>
                <Ic n="Notebook" s={18} />
                <Lnk onClick={() => go('skills')}>{skill.name}</Lnk>
                {/* `UC-51.2-05`: the skill needs a connector this agent cannot reach, so
                    it would fail at the first tool call. Said here, with the way to fix it. */}
                {skill.missingConnectors.length > 0 && (
                  <span className="awp-small" style={{ color: 'var(--feedback-warning-text)' }} role="alert">
                    {t(
                      `Needs ${skill.missingConnectors.join(', ')} — this agent is not granted its tools.`,
                      `يحتاج ${skill.missingConnectors.join('، ')} — لم تُمنح أدواته لهذا الوكيل.`,
                    )}{' '}
                    <Lnk onClick={() => openTab('tools')}>{t('Connector tools', 'أدوات التكامل')}</Lnk>
                  </span>
                )}
                {/* A pinned skill a run leaves out, so nobody assumes the agent follows it. */}
                {skill.notApplied && (
                  <span className="awp-small" style={{ color: 'var(--feedback-warning-text)' }} role="status">
                    {skill.notApplied === 'unpublished'
                      ? t('Not applied to runs: this version is not published.', 'لا يُطبَّق في التشغيل: هذا الإصدار غير منشور.')
                      : skill.notApplied === 'unscanned'
                        ? t('Not applied to runs: it has not passed a security scan.', 'لا يُطبَّق في التشغيل: لم يجتز الفحص الأمني بعد.')
                        : t(
                            'Not applied to runs: its security scan found a credential or prompt-injection text.',
                            'لا يُطبَّق في التشغيل: وجد الفحص الأمني بيانات اعتماد أو نصاً لحقن الأوامر.',
                          )}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <Toggle
                  on={skill.enabled}
                  onChange={
                    canEdit
                      ? (next) => save(() => setSkill({ code: a.id, skillVersionId: skill.id, enabled: next }))
                      : undefined
                  }
                />
              </div>
            ))}
            {!d.skills.length && <p className="awp-muted" style={{ padding: 20, margin: 0 }}>{t('No skills attached.', 'لا توجد مهارات مرفقة.')}</p>}
            {/* `UC-51.2-02`, D238: skills are chosen from what the platform has published, in
                one popup, and the change lands on the draft like every other change here. */}
            {pickingSkills && (
              <GrantPicker
                title={t('Add or remove skills', 'إضافة مهارات أو إزالتها')}
                groups={[
                  {
                    id: 'skills',
                    label: null,
                    items: [
                      ...d.skills.map((skill) => ({ key: skill.id, name: skill.name })),
                      ...d.skillShelf.map((skill) => ({
                        key: skill.id,
                        name: skill.name,
                        note: skill.versionLabel + (skill.missingConnectors.length ? ` · ${t('needs', 'يحتاج')} ${skill.missingConnectors.join(', ')}` : ''),
                      })),
                    ],
                  },
                ]}
                initial={new Set(d.skills.map((skill) => skill.id))}
                saving={saving}
                onClose={() => setPickingSkills(false)}
                onSave={(picked) =>
                  save(
                    () =>
                      changeSkills({
                        code: a.id,
                        add: d.skillShelf.filter((skill) => picked.has(skill.id)).map((skill) => skill.id),
                        remove: d.skills.filter((skill) => !picked.has(skill.id)).map((skill) => skill.id),
                      }),
                    () => setPickingSkills(false),
                  )
                }
              />
            )}
          </Card>
        )}
        {tab === 'tools' && (
          <ConnectorTools code={a.id} detail={d} configuration={toolConfiguration} editable={canEdit} />
        )}
        {tab === 'knowledge' && (
          <Card pad={false}>
            {d.knowledge.map((collection) => (
              <div key={collection.id} className="awp-row" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-divider)' }}>
                <Ic n="InformationDiamond" s={18} />
                <Lnk onClick={() => go('knowledge')}>{collection.name}</Lnk>
                <StTag s={collection.status === 'Ingesting' ? 'In Progress' : collection.status === 'Ready' ? 'Healthy' : 'Degraded'} />
                <span style={{ flex: 1 }} />
                <Toggle
                  on={collection.granted}
                  onChange={
                    canEdit
                      ? (next) => save(() => setKnowledgeAccess({ code: a.id, collectionId: collection.id, enabled: next }))
                      : undefined
                  }
                />
              </div>
            ))}
            {!d.knowledge.length && (
              <p className="awp-muted" style={{ padding: 20, margin: 0 }}>{t('No knowledge collections exist yet.', 'لا توجد مجموعات معرفة بعد.')}</p>
            )}
          </Card>
        )}
        {tab === 'memory' && (
          <Card pad={false}>
            {d.memory.map((scope) => (
              <div key={scope.id} className="awp-row" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-divider)' }}>
                <Ic n="Bank" s={18} />
                <span style={{ flex: 1 }}>{scope.name}</span>
                <Tg tone="neutral" label={scope.kind} />
                {canEdit ? (
                  <PopSelect
                    className="awp-input"
                    style={{ width: 130 }}
                    value={scope.granted ? (scope.writable ? 'ReadWrite' : 'Read') : 'None'}
                    aria-label={scope.name}
                    disabled={saving}
                    onChange={(e) =>
                      save(() =>
                        setMemoryAccess({
                          code: a.id,
                          memoryScopeId: scope.id,
                          access: e.target.value === 'None' ? null : (e.target.value as 'Read' | 'ReadWrite'),
                        }),
                      )
                    }
                  >
                    <option value="None">{t('No access', 'بلا صلاحية')}</option>
                    <option value="Read">{t('Read', 'قراءة')}</option>
                    <option value="ReadWrite">{t('Read and write', 'قراءة وكتابة')}</option>
                  </PopSelect>
                ) : (
                  <Tg tone={scope.granted ? 'brand' : 'neutral'} label={scope.granted ? (scope.writable ? t('Read and write', 'قراءة وكتابة') : t('Read', 'قراءة')) : t('No access', 'بلا صلاحية')} />
                )}
              </div>
            ))}
            {!d.memory.length && (
              <p className="awp-muted" style={{ padding: 20, margin: 0 }}>{t('No memory scopes exist yet.', 'لا توجد نطاقات ذاكرة بعد.')}</p>
            )}
          </Card>
        )}
        {tab === 'runs' && runs && <AgentRuns a={a} runs={runs} go={go} />}
        {resetting && (
          <Modal
            title={t('Reset to defaults?', 'إعادة الضبط إلى الافتراضي؟')}
            onClose={() => setResetting(false)}
            footer={
              <>
                <Btn type="secondary" label={t('Keep my changes', 'الإبقاء على تغييراتي')} onClick={() => setResetting(false)} />
                <Btn type="danger" label={t('Reset', 'إعادة الضبط')} disabled={saving} onClick={restoreDefaults} />
              </>
            }
          >
            <p style={{ margin: 0 }}>
              {t(
                'The instructions, the platform-tool grant, the skills and the budgets go back to the ones the platform shipped. Runs, memory and the audit trail are left alone.',
                'تعود التعليمات ومنح أدوات المنصة والمهارات والميزانيات إلى ما شحنته المنصة. تبقى العمليات والذاكرة وسجل الإجراءات كما هي.',
              )}
            </p>
            <p className="awp-small awp-muted" style={{ margin: '12px 0 0' }}>
              {t('Saved as a draft revision, like every other change here.', 'يُحفظ كمسودة، مثل أي تغيير آخر هنا.')}
            </p>
          </Modal>
        )}
        {configuring && (
          <ConfigurationModal
            code={a.id}
            detail={d}
            routes={routes}
            onClose={() => setConfiguring(false)}
          />
        )}
        {publishing && <PublishModal code={a.id} onClose={() => setPublishing(false)} />}
        {tab === 'versions' && (
          <Card pad={false}>
            <DataTable
              rows={d.versions}
              cols={[
                { h: t('Version', 'الإصدار'), cls: 'awp-mono', r: (version) => version.v },
                { h: t('Published', 'تاريخ النشر'), r: (version) => (version.publishedAt ? formatDay(lang, new Date(version.publishedAt)) : '—') },
                { h: t('By', 'بواسطة'), r: (version) => (version.by ? aName(version.by) : '—') },
                { h: t('Eval', 'التقييم'), r: (version) => (version.evalScore === null ? '—' : version.evalScore) },
                {
                  h: '',
                  end: true,
                  r: (version) =>
                    version.isActive ? (
                      <Tg tone="success" dot label={t('Active', 'نشط')} />
                    ) : (
                      <Lnk onClick={() => save(() => activateVersion({ code: a.id, versionNumber: Number(version.v.replace(/\D/g, '')) }))}>
                        {t('Roll back', 'التراجع')}
                      </Lnk>
                    ),
                },
              ]}
            />
          </Card>
        )}
      </div>
    );
  }
  return (
    <div className="awp-page">
      <PageHead crumb={t('AI Capabilities', 'قدرات الذكاء الاصطناعي')} title={t('Agents', 'الوكلاء')} sub={t('Versioned workers with skills, tools, memory and an org position.', 'عاملون بإصدارات لهم مهارات وأدوات وذاكرة وموقع تنظيمي.')}>
        {may('agents:write') && (
          <Btn label={t('New Agent', 'وكيل جديد')} icon="AddCircle" onClick={() => setCreating(true)} />
        )}
      </PageHead>
      <div className="awp-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <input
          className="awp-input"
          style={{ maxWidth: 260 }}
          defaultValue={query}
          placeholder={t('Search agents', 'ابحث عن وكيل')}
          aria-label={t('Search agents', 'ابحث عن وكيل')}
          onChange={(e) => filter.set('q', e.target.value.trim())}
        />
        <Chips
          value={status}
          onChange={(id) => filter.set('status', id)}
          items={[
            { id: 'all', label: t('All', 'الكل') },
            ...AGENT_STATUSES.map((value) => ({ id: value.toLowerCase(), label: value })),
          ]}
        />
        {inError > 0 && (
          <Lnk onClick={() => filter.set('status', 'error')}>
            {t(`${inError} agents in error`, `${inError} وكلاء في حالة خطأ`)}
          </Lnk>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(280px,100%),1fr))', gap: 16 }}>
        {shown.map((x) => (
          <button key={x.id} className="awp-card" onClick={() => openAgent(x.id)} style={{ padding: 20, textAlign: 'start', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="awp-row" style={{ gap: 12 }}>
              <AgentAv a={x} s={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{nm(x)}</div>
                <div className="awp-small awp-muted">{t(x.unit, x.unitAr)} · {x.ver}</div>
              </div>
            </div>
            <div
              className="awp-row"
              style={{ flexWrap: 'wrap' }}
              // `UC-50.2-05`: the failure reason on hover, from the agent's last errored run.
              title={x.status === 'Error' ? details[x.id]?.lastFailure ?? undefined : undefined}
            >
              <AgentTag s={x.status} />
              <Tg label={x.profile} />
            </div>
            <div className="awp-row awp-small awp-muted" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border-divider)', paddingTop: 12 }}>
              <span className="awp-mono">{x.model}</span>
              <span>
                {x.runs.toLocaleString()} {t('runs', 'عملية')} · {aed(x.cost)}
              </span>
            </div>
          </button>
        ))}
      </div>
      {!shown.length && (
        <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: 'center' }}>
          {t('No agents match these filters.', 'لا يوجد وكلاء يطابقون هذه المرشحات.')}{' '}
          <button className="awp-chip" onClick={filter.clear}>{t('Clear', 'مسح')}</button>
        </p>
      )}
      {creating && (
        <NewAgentModal
          units={units}
          routes={routes}
          onClose={() => setCreating(false)}
          onCreated={(code) => {
            setCreating(false);
            // `UC-50.2-01`: the new agent's detail, on Instructions.
            openAgent(code, 'instr');
          }}
        />
      )}
    </div>
  );
}
