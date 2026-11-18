"use client";

import { useState, useTransition } from "react";

import { useAgents, useMay, usePeople } from "@/components/shared/directory";
import { changeReportingLine } from "@/features/organisation/actions";
import { type OrgNode } from "@/features/organisation/types";
import { useGo } from "@/lib/routes";
import { PageHead } from "@/components/shared/page-head";
import { AgentTag } from "@/components/shared/status-tags";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, Seg } from "@/components/ui/tabs";
import { Drawer, Modal } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { DataTable, FilterBar } from "@/components/shared/layout";

/** One person or agent on the chart, an agent on the brand surface, outlined when selected. */
function OrgNodeCard({ o, sel, onSelect, isA }: { o: OrgNode; sel: OrgNode | null; onSelect: (o: OrgNode) => void; isA: (id: string) => boolean }) {
  const { t, aName } = useAwp();
  return (
    <button onClick={() => onSelect(o)} className="awp-card" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', minWidth: 190, cursor: 'pointer', textAlign: 'start', background: isA(o.id) ? 'var(--surface-brand-subtle)' : 'var(--surface-raised)', boxShadow: sel && sel.id === o.id ? '0 0 0 2px var(--border-selected)' : undefined }}>
      <Who id={o.id} s={32} />
      <div>
        <div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{aName(o.id)}</div>
        <div className="awp-small awp-muted">{t(o.sub[0], o.sub[1])}</div>
      </div>
    </button>
  );
}

/** A node under the root and its direct reports beneath it; the chart draws two levels below the root. */
function OrgBranch({ o, sel, onSelect, isA, kids }: { o: OrgNode; sel: OrgNode | null; onSelect: (o: OrgNode) => void; isA: (id: string) => boolean; kids: (id: string) => OrgNode[] }) {
  const k = kids(o.id);
  return (
    <div className="awp-col" style={{ alignItems: 'center', gap: 0 }}>
      <OrgNodeCard o={o} sel={sel} onSelect={onSelect} isA={isA} />
      {k.length > 0 && (
        <>
          <div style={{ width: 2, height: 20, background: 'var(--border-divider)' }} />
          <div className="awp-col" style={{ gap: 10, borderInlineStart: '2px solid var(--border-divider)', paddingInlineStart: 16 }}>
            {k.map((c) => (
              <OrgNodeCard key={c.id} o={c} sel={sel} onSelect={onSelect} isA={isA} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * `UC-40.2-01`: pick a new manager for the selected node.
 *
 * Everyone in the hierarchy is offered, people and agents alike, because both can manage
 * and be managed. The subject's own descendants are left in the list: refusing them here
 * would hide the reason, and `UC-40.2-02` requires the loop to be named.
 */
function ReportingLineModal({
  subject,
  nodes,
  onClose,
}: {
  subject: OrgNode;
  nodes: OrgNode[];
  onClose: () => void;
}) {
  const { t, aName, why } = useAwp();
  const { say } = useToast();
  const [manager, setManager] = useState(subject.parent ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await changeReportingLine({
        subjectNodeId: subject.id,
        managerNodeId: manager || null,
      });
      // `UC-40.2-02`: a reporting loop comes back as a message on the form.
      if (result.ok) {
        say(t("The reporting line was changed.", "تم تغيير خط التبعية."));
        onClose();
      } else setProblem(why(result));
    });

  return (
    <Modal
      title={t("Change reporting line", "تغيير خط التبعية")}
      onClose={onClose}
      dirty={manager !== (subject.parent ?? "")}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={t("Save", "حفظ")} disabled={pending} onClick={submit} />
        </>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <Field label={t("Reports to", "يتبع")} hint={aName(subject.id)}>
          <PopSelect className="awp-input" value={manager} onChange={(event) => setManager(event.target.value)}>
            <option value="">{t("Nobody — top of the organisation", "بدون — أعلى الهيكل")}</option>
            {nodes
              .filter((node) => node.id !== subject.id)
              .map((node) => (
                <option key={node.id} value={node.id}>{aName(node.id)}</option>
              ))}
          </PopSelect>
        </Field>
        {problem && <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{problem}</p>}
      </div>
    </Modal>
  );
}

/**
 * S-40: people and agents in one hierarchy, as a chart from the root or as a list filtered by
 * name and kind. Selecting a node opens a drawer with its unit, manager and direct reports: an
 * agent links to its screen and runs, and a person's reporting line can be changed by a holder
 * of `organisation:write`. Renders nothing when there are no nodes.
 */
export function OrgChart({ nodes }: { nodes: OrgNode[] }) {
  const { t, aName } = useAwp();
  const go = useGo();
  const agents = useAgents();
  const people = usePeople();
  const isA = (id: string) => agents.some((x) => x.id === id);
  const kids = (id: string) => nodes.filter((o) => o.parent === id);
  const [view, setView] = useState('chart');
  const [sel, setSel] = useState<OrgNode | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [changing, setChanging] = useState(false);
  const may = useMay();
  const root = nodes.find((o) => o.parent === null) ?? nodes[0];
  const list = nodes.filter((o) => (kind === 'all' || (kind === 'agent' ? isA(o.id) : !isA(o.id))) && (!q || aName(o.id).toLowerCase().includes(q.toLowerCase())));
  const a = sel && agents.find((x) => x.id === sel.id);
  const pp = sel && people.find((x) => x.id === sel.id);
  if (!root) return null;
  return (
    <div className="awp-page" style={{ maxWidth: 'none' }}>
      <PageHead title={t('Org chart', 'الهيكل التنظيمي')} sub={t('People and agents in one hierarchy. Agents are shown in blue. Select anyone to see details.', 'الموظفين والوكلاء في هيكل واحد. يظهر الوكلاء باللون الأزرق. اختر أي شخص لعرض التفاصيل.')}>
        <Seg value={view} onChange={setView} items={[{ id: 'chart', label: t('Chart', 'مخطط') }, { id: 'list', label: t('List', 'قائمة') }]} />
      </PageHead>
      {view === 'chart' ? (
        <Card>
          <div style={{ overflowX: 'auto', padding: '8px 0' }}>
            <div className="awp-col" style={{ alignItems: 'center', gap: 0, minWidth: 900 }}>
              <OrgNodeCard o={root} sel={sel} onSelect={setSel} isA={isA} />
              <div style={{ width: 2, height: 24, background: 'var(--border-divider)' }} />
              <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', borderTop: '2px solid var(--border-divider)', paddingTop: 24 }}>
                {kids(root.id).map((o) => (
                  <OrgBranch key={o.id} o={o} sel={sel} onSelect={setSel} isA={isA} kids={kids} />
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card pad={false}>
          <FilterBar>
            <input className="awp-input" style={{ maxWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by name', 'ابحث بالاسم')} />
            <Chips value={kind} onChange={setKind} items={[{ id: 'all', label: t('All', 'الكل') }, { id: 'human', label: t('People', 'الأشخاص') }, { id: 'agent', label: t('Agents', 'الوكلاء') }]} />
          </FilterBar>
          <DataTable
            onRow={setSel}
            rows={list}
            cols={[
              { h: t('Name', 'الاسم'), r: (o) => (<div className="awp-row" style={{ gap: 10 }}><Who id={o.id} s={30} /><b>{aName(o.id)}</b></div>) },
              { h: t('Kind', 'النوع'), r: (o) => <Tg tone={isA(o.id) ? 'brand' : 'neutral'} label={isA(o.id) ? t('Agent', 'وكيل') : t('Person', 'شخص')} /> },
              { h: t('Role / version', 'الدور / الإصدار'), r: (o) => t(o.sub[0], o.sub[1]) },
              { h: t('Org unit', 'الوحدة'), r: (o) => o.unit },
              { h: t('Reports to', 'يتبع'), r: (o) => (o.parent ? aName(o.parent) : '—') },
              { h: t('Direct reports', 'التابعون المباشرون'), end: true, r: (o) => kids(o.id).length },
            ]}
          />
        </Card>
      )}
      {sel && (
        <Drawer
          title={aName(sel.id)}
          sub={a ? t('Agent', 'وكيل') + ' · ' + a.ver : pp ? t(pp.role, pp.roleAr) : undefined}
          onClose={() => setSel(null)}
          footer={
            a ? (
              <>
                <Btn label={t('Open agent', 'فتح الوكيل')} onClick={() => go('agents', { agent: a.id })} />
                <Btn type="secondary" label={t('Agent run list', 'قائمة عمليات الوكيل')} onClick={() => go('agents', { agent: a.id, tab: 'runs' })} />
              </>
            ) : may('organisation:write') ? (
              <Btn
                type="secondary"
                label={t('Change reporting line', 'تغيير خط التبعية')}
                onClick={() => setChanging(true)}
              />
            ) : undefined
          }
        >
          <div className="awp-row" style={{ gap: 14 }}>
            <Who id={sel.id} s={56} />
            <div>{a ? <AgentTag s={a.status} /> : <Tg tone="success" dot label={t('Active', 'نشط')} />}</div>
          </div>
          <dl className="awp-kv" style={{ margin: 0 }}>
            <dt>{t('Org unit', 'الوحدة')}</dt>
            <dd>{sel.unit}</dd>
            <dt>{t('Reports to', 'يتبع')}</dt>
            <dd>{sel.parent ? <Lnk onClick={() => setSel(nodes.find((o) => o.id === sel.parent) || null)}>{aName(sel.parent)}</Lnk> : '—'}</dd>
            {a && (
              <>
                <dt>{t('Model', 'النموذج')}</dt>
                <dd className="awp-mono">{a.model}</dd>
                <dt>{t('Runs (30d)', 'العمليات (30ي)')}</dt>
                <dd>{a.runs.toLocaleString()}</dd>
              </>
            )}
            {pp && (
              <>
                <dt>{t('Email', 'البريد')}</dt>
                <dd>{pp.email}</dd>
              </>
            )}
          </dl>
          <div>
            <div className="awp-small awp-muted" style={{ marginBottom: 8 }}>{t('Direct reports', 'التابعون المباشرون')}</div>
            {kids(sel.id).length ? (
              kids(sel.id).map((k) => (
                <button key={k.id} className="awp-nav-i" onClick={() => setSel(k)}>
                  <Who id={k.id} s={24} />
                  {aName(k.id)}
                </button>
              ))
            ) : (
              <span className="awp-muted">{t('None', 'لا أحد')}</span>
            )}
          </div>
        </Drawer>
      )}
      {changing && sel && (
        <ReportingLineModal subject={sel} nodes={nodes} onClose={() => setChanging(false)} />
      )}
    </div>
  );
}
