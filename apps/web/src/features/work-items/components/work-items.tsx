"use client";

import { useState } from "react";

import { Pager } from "@/components/shared/pager";

import { useAgents, usePeople } from "@/components/shared/directory";
import { changeStatus, saveView as saveViewAction } from "@/features/work-items/actions";
import { COLUMNS, type SavedView, type Task, type WorkItemDetail, type WorkItemScope } from "@/features/work-items/types";
import { formatDay } from "@/i18n";
import { priAr, priTone, stTone2 } from "@/i18n/vocabulary";
import { useModals } from "@/components/shared/modal-host";
import { useGo } from "@/lib/routes";
import type { ServerPage } from "@/lib/paging";
import { PageHead } from "@/components/shared/page-head";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, Seg } from "@/components/ui/tabs";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { PopDate } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { Refused } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery, useOpenQuery } from "@/hooks/use-filter-query";
import { useProjOpts } from "@/components/shared/forms";
import { Sel } from "@/components/shared/layout";
import { useColLbl, useTypeLbl } from "./work-item-labels";
import { AskName } from "./ask-name";
import { TaskCard } from "./task-card";
import { TaskDrawer } from "./task-drawer";

/** The advanced filters as the address carries them. */
export type WorkItemListFilters = { scope: WorkItemScope; q: string; project: string; type: string; status: string; pri: string; who: string; from: string; to: string };

const BLANK = { q: '', project: '', type: '', status: '', pri: '', who: '', from: '', to: '' };
type Criteria = typeof BLANK;

/** A saved view's criteria, as saved now or under the names views were saved with before (`p`, `ty`, `st`, `any`). */
function criteriaOf(filter: Record<string, unknown>): Criteria {
  const read = (...names: string[]) => {
    const value = names.map((name) => filter[name]).find((one) => typeof one === 'string' && one !== '');
    return typeof value === 'string' && value !== 'any' ? value : '';
  };
  return { q: read('q'), project: read('project', 'p'), type: read('type', 'ty'), status: read('status', 'st'), pri: read('pri'), who: read('who'), from: read('from'), to: read('to') };
}

/**
 * The Work Items screen: a board or a paged list, scoped to hot items, items from comments or
 * all, with advanced filters and saved views (D349). The scope, the filters, the view, the page
 * and the open drawer are in the address and applied on the server: the board shows the newest
 * cards of each column with the column's count, the list one page with the total, and `?open=`
 * opens its item whether or not it is shown. Dragging a card moves it through `changeStatus`.
 */
export function Tasks({
  items,
  board,
  page,
  columns,
  scopes,
  filters,
  views,
  opened,
}: {
  items: Task[];
  board: boolean;
  page: ServerPage;
  columns: Record<string, number>;
  scopes: { hot: number; comments: number; all: number };
  filters: WorkItemListFilters;
  views: SavedView[];
  opened: { item: Task; detail: WorkItemDetail } | null;
}) {
  const { t, lang, nm, aName, why } = useAwp();
  const { open: openModal } = useModals();
  const go = useGo();
  const filter = useFilterQuery();
  const show = useOpenQuery();
  const projOpts = useProjOpts();
  const colLbl = useColLbl();
  const typeLbl = useTypeLbl();
  const agents = useAgents();
  const people = usePeople();
  const scope = filters.scope;
  const applied: Criteria = { q: filters.q, project: filters.project, type: filters.type, status: filters.status, pri: filters.pri, who: filters.who, from: filters.from, to: filters.to };
  const [adv, setAdv] = useState(false);
  // The advanced panel edits a draft; Search applies it on the server.
  const [f, setF] = useState<Criteria>(applied);
  const set = (k: keyof Criteria) => (v: string) => setF({ ...f, [k]: v === 'any' ? '' : v });
  const [saved, setSaved] = useState<SavedView[]>(views);
  const [run] = useAction();
  // `UC-24.2-04`: a window that ends before it starts matches nothing, and the search is
  // blocked rather than answered with an empty list.
  const badWindow = f.from !== '' && f.to !== '' && f.from > f.to;
  const search = (criteria: Criteria) => filter.assign({ ...criteria, scope: 'every' });

  const [naming, setNaming] = useState(false);

  /** `UC-24.2-02`: keep these criteria under a name, and show it beside the filters. */
  const keepView = (name: string) =>
    run(async () => {
      const outcome = await saveViewAction({ name, filter: f });
      if (!outcome.ok) throw new Refused(outcome);
      setSaved((before: SavedView[]) => [...before.filter((view) => view.name !== name), { name, filter: f }]);
      return t(`The view ${name} was saved.`, `حُفظ العرض ${name}.`);
    });

  /** `UC-24.1-07`: the move the board asked for, or the reason it may not happen. */
  const move = (key: string, status: string) =>
    run(async () => {
      const item = items.find((x) => x.k === key);
      if (!item || item.st === status) return null;
      const result = await changeStatus({ key, status, version: item.version });
      if (!result.ok) throw new Refused({ reason: why(result) });
      return t(`${key} moved to ${colLbl(status)}.`, `نُقل ${key} إلى ${colLbl(status)}.`);
    });
  const isHot = (x: Task) => x.hot;
  /**
   * Why an item is hot, or nothing when the card already says it.
   *
   * The priority tag on every card already reads "High", so a second tag beside the key
   * saying "High priority" is the same fact twice. Blocked and due-soon are not on the
   * card anywhere else, so those still earn their tag.
   */
  const hotWhy = (x: Task) =>
    x.st === 'Blocked' ? t('Blocked', 'معطّل') : x.pri === 'High' ? null : t('Due soon', 'مستحق قريباً');
  const advCount = (Object.keys(BLANK) as (keyof Criteria)[]).filter((k) => applied[k] !== '').length;
  const clearCriteria = () => {
    setF(BLANK);
    filter.assign(BLANK);
  };
  return (
    <div className="awp-page" style={{ maxWidth: 'none' }}>
      <PageHead title={t('Work Items', 'بنود العمل')} sub={t('Tasks, sub items and bugs assigned to people and agents, grouped by project.', 'المهام والبنود الفرعية والأخطاء المُسندة إلى الموظفين والوكلاء حسب المشروع.')}>
        <Seg value={board ? 'board' : 'list'} onChange={(id) => filter.set('view', id === 'list' ? 'list' : '')} items={[{ id: 'board', label: t('Board', 'لوحة') }, { id: 'list', label: t('List', 'قائمة') }]} />
        <Btn label={t('New Work Item', 'بند عمل جديد')} icon="AddCircle" onClick={() => openModal('workitem')} />
      </PageHead>
      <div className="awp-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <Chips
          value={scope}
          onChange={(id) => filter.set('scope', id === 'all' ? 'every' : id === 'hot' ? '' : id)}
          items={[
            { id: 'hot', label: t('Hot items', 'البنود العاجلة') + ' · ' + scopes.hot },
            ...(scopes.comments > 0
              ? [{ id: 'comments', label: t('From comments', 'من التعليقات') + ' · ' + scopes.comments }]
              : []),
            { id: 'all', label: t('All work items', 'كل بنود العمل') + ' · ' + scopes.all },
          ]}
        />
        <span style={{ flex: 1 }} />
        <button className={'awp-chip' + (adv || advCount ? ' on' : '')} onClick={() => setAdv(!adv)}>
          <Ic n="Search" s={16} c="currentColor" />
          {t('Advanced search', 'بحث متقدم')}
          {advCount > 0 && ' · ' + advCount}
        </button>
      </div>
      {scope === 'hot' && <div className="awp-small awp-muted">{t('Hot items are open work that is high priority, blocked, or due within 2 days.', 'البنود العاجلة هي الأعمال المفتوحة ذات الأولوية العالية أو المعطّل أو المستحق خلال يومين.')}</div>}
      {/* `UC-24.1-06` and `UC-24.2-05`: nothing to show, with the way out of it. */}
      {page.total === 0 && (
        <Card>
          <p style={{ margin: 0 }} role="status">
            {scope === 'hot' && advCount === 0
              ? t('Nothing is hot right now.', 'لا يوجد عاجل الآن.')
              : t('No work items match.', 'لا توجد بنود عمل مطابقة.')}{' '}
            {advCount > 0 ? (
              <button className="awp-lnk" onClick={clearCriteria}>
                {t('Clear', 'مسح')}
              </button>
            ) : (
              <button className="awp-lnk" onClick={() => filter.set('scope', 'every')}>
                {t('All work items', 'كل بنود العمل')}
              </button>
            )}
          </p>
        </Card>
      )}
      {adv && (
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(200px,100%),1fr))', gap: 12 }}>
            <Field label={t('Keyword', 'كلمة مفتاحية')}>
              <input
                className="awp-input"
                value={f.q}
                onChange={(e) => set('q')(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !badWindow) search(f);
                }}
                placeholder={t('Title or key', 'العنوان أو المفتاح')}
              />
            </Field>
            <Field label={t('Project', 'المشروع')}><Sel value={f.project || 'any'} onChange={set('project')} w={9999} opts={projOpts()} /></Field>
            <Field label={t('Type', 'النوع')}>
              <Sel value={f.type || 'any'} onChange={set('type')} w={9999} opts={[['any', t('Any', 'الكل')], ...['Task', 'SubItem', 'Bug'].map((k) => [k, typeLbl(k)] as [string, string])]} />
            </Field>
            <Field label={t('Status', 'الحالة')}>
              <Sel value={f.status || 'any'} onChange={set('status')} w={9999} opts={[['any', t('Any', 'الكل')], ...COLUMNS.map(([k]) => [k, colLbl(k)] as [string, string])]} />
            </Field>
            <Field label={t('Priority', 'الأولوية')}>
              <Sel value={f.pri || 'any'} onChange={set('pri')} w={9999} opts={[['any', t('Any', 'الكل')], ...['High', 'Medium', 'Low'].map((k) => [k, t(k, priAr[k])] as [string, string])]} />
            </Field>
            <Field label={t('Assignee', 'المُسند إليه')}>
              <Sel value={f.who || 'any'} onChange={set('who')} w={9999} opts={[['any', t('Anyone', 'أي شخص')], ['none', t('Unassigned', 'غير مُسند')], ...[...people, ...agents].map((x) => [x.id, nm(x)] as [string, string])]} />
            </Field>
            <Field label={t('Due from', 'الاستحقاق من')}>
              <PopDate className="awp-input" value={f.from} onChange={(e) => set('from')(e.target.value)} />
            </Field>
            <Field label={t('Due to', 'الاستحقاق إلى')}>
              <PopDate className="awp-input" value={f.to} onChange={(e) => set('to')(e.target.value)} />
            </Field>
          </div>
          {badWindow && (
            <p role="alert" className="awp-small" style={{ margin: '10px 0 0', color: 'var(--text-danger)' }}>
              {t('Due from must be on or before due to.', 'يجب أن يكون تاريخ الاستحقاق من قبل أو يساوي إلى.')}
            </p>
          )}
          <div className="awp-row" style={{ gap: 10, marginTop: 14 }}>
            <Btn
              label={t('Search all work items', 'البحث في كل بنود العمل')}
              disabled={badWindow}
              onClick={() => { search(f); setAdv(false); }}
            />
            <Btn type="secondary" label={t('Clear', 'مسح')} onClick={clearCriteria} />
            <Btn type="ghost" label={t('Save as view', 'حفظ كعرض')} disabled={badWindow} onClick={() => setNaming(true)} />
          </div>
          {naming && (
            <AskName
              title={t('Save as view', 'حفظ كعرض')}
              label={t('Name this view', 'سمِّ هذا العرض')}
              onClose={() => setNaming(false)}
              onDone={(name) => {
                setNaming(false);
                keepView(name);
              }}
            />
          )}
          {saved.length > 0 && (
            <div className="awp-row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              <span className="awp-small awp-muted">{t('Saved views', 'العروض المحفوظة')}:</span>
              {saved.map((view: SavedView) => (
                <button
                  key={view.name}
                  className="awp-chip"
                  onClick={() => {
                    const criteria = criteriaOf(view.filter);
                    setF(criteria);
                    search(criteria);
                  }}
                >
                  {view.name}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
      {board ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(240px,1fr))', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
          {COLUMNS.map(([id]) => {
            const cards = items.filter((x) => x.st === id);
            const count = columns[id] ?? 0;
            return (
              <div
                key={id}
                // `UC-24.1-07`: the card is dropped here and the platform decides whether
                // that move is one it allows.
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  move(event.dataTransfer.getData('text/plain'), id);
                }}
                style={{ background: 'var(--surface-sunken)', borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 320 }}
              >
                <div className="awp-row" style={{ padding: '2px 4px' }}>
                  <b style={{ flex: 1 }}>{colLbl(id)}</b>
                  <span className="awp-small awp-muted">{count}</span>
                </div>
                {cards.map((x) => (
                  <TaskCard key={x.k} x={x} onOpen={(task) => show(task.k)} hot={isHot(x) ? hotWhy(x) : null} />
                ))}
                {count > cards.length && (
                  // A column shows its newest cards; the list pages through all of them.
                  <button className="awp-lnk awp-small" style={{ alignSelf: 'center' }} onClick={() => filter.assign({ view: 'list', status: id })}>
                    {t(`${count - cards.length} more in the list`, `${count - cards.length} أخرى في القائمة`)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Card pad={false}>
          <div style={{ overflowX: 'auto' }}>
            <table className="awp-tbl">
              <thead>
                <tr>
                  <th>{t('Key', 'المفتاح')}</th>
                  <th>{t('Project', 'المشروع')}</th>
                  <th>{t('Title', 'العنوان')}</th>
                  <th>{t('Type', 'النوع')}</th>
                  <th>{t('Status', 'الحالة')}</th>
                  <th>{t('Priority', 'الأولوية')}</th>
                  <th>{t('Assignee', 'المُسند إليه')}</th>
                  <th>{t('Due', 'الاستحقاق')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.k} className="click" onClick={() => show(x.k)}>
                    <td className="awp-mono awp-muted">{x.k}</td>
                    <td className="awp-mono">{x.p}</td>
                    <td style={{ fontWeight: 500 }}>{t(x.t, x.tAr)}</td>
                    <td>{typeLbl(x.type)}</td>
                    <td><Tg tone={stTone2[x.st]} dot label={colLbl(x.st)} /></td>
                    <td><Tg tone={priTone[x.pri]} label={t(x.pri, priAr[x.pri])} /></td>
                    <td>
                      <div className="awp-row">{x.who ? <><Who id={x.who} s={24} />{aName(x.who)}</> : <span className="awp-muted">{t('Unassigned', 'غير مُسند')}</span>}</div>
                    </td>
                    <td className="awp-muted">{x.dueAt ? formatDay(lang, new Date(x.dueAt)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page.page - 1} last={Math.max(0, Math.ceil(page.total / page.size) - 1)} total={page.total} size={page.size} onPage={(next) => filter.set('page', String(next + 1))} />
        </Card>
      )}
      {opened && (
        <TaskDrawer
          key={opened.item.k}
          x={opened.item}
          detail={opened.detail}
          onClose={() => show(null)}
          go={go}
          onOpenKey={(k) => show(k)}
        />
      )}
    </div>
  );
}
