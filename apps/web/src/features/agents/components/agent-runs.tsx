"use client";

import { useState, useTransition } from "react";

import { useMay } from "@/components/shared/directory";
import { cancelRun } from "@/features/agents/actions";
import { type Run } from "@/features/agents/types";
import { type Agent } from "@/types/directory";
import { formatDay, formatTime } from "@/i18n";
import { runStatus } from "@/i18n/vocabulary";
import { type Go } from "@/lib/routes";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { DataTable } from "@/components/shared/layout";
import { useFilterQuery } from "@/hooks/use-filter-query";
import type { ServerPage } from "@/lib/paging";
import { RUN_PERIODS } from "../run-periods";
import { RunTag } from "./run-tag";

/** Whether a run is still going, which is the only state anyone can stop (`UC-52.1-11`). */
const cancellable = (st: string) => st === "Running" || st === "Waiting";

/** The Runs tab's filters as the URL holds them: a status or `all`, a period in hours (0 is any time), and search text. */
export type AgentRunFilters = { status: string; period: number; q: string };

/** One page of an agent's runs, which page it is, and the filters that chose it. */
export type AgentRunsPage = { rows: Run[]; page: ServerPage; filters: AgentRunFilters };

/**
 * An agent's Runs tab: its runs filtered on the server (D349) by status, a search over key and
 * the work item or room it ran for, and how long ago they started, one page at a time, with a
 * link to where a waiting run's decision is taken and a confirmed Cancel for a running or
 * waiting run when the person holds `agents:invoke`. A row opens the run viewer.
 */
export function AgentRuns({ a, runs, go }: { a: Agent; runs: AgentRunsPage; go: Go }) {
  const { t, lang, why } = useAwp();
  const { say } = useToast();
  const may = useMay();
  const filter = useFilterQuery();
  const [search, setSearch] = useState(runs.filters.q);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const rows = runs.rows;

  // `UC-52.1-05`: the same cancel the run viewer offers, reachable from the list as well —
  // an operator should not have to open a run just to stop one that is taking too long.
  const cancel = (key: string) =>
    start(async () => {
      setProblem(null);
      const result = await cancelRun({ key });
      if (result.ok) {
        setCancelling(null);
        say(t(`${key} was cancelled.`, `أُلغيت ${key}.`));
      } else setProblem(why(result));
    });

  return (
    <Card pad={false}>
      <div className="awp-row" style={{ padding: '14px 20px', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border-divider)' }}>
        <span className="awp-small awp-muted">{t('Status', 'الحالة')}</span>
        <Chips value={runs.filters.status} onChange={(id) => filter.set('runStatus', id)} items={[{ id: 'all', label: t('All', 'الكل') }, ...Object.keys(runStatus).map((k) => ({ id: k, label: t(runStatus[k][1], runStatus[k][2]) }))]} />
        <span style={{ flex: 1 }} />
        <span className="awp-small awp-muted">{t('Newest first', 'الأحدث أولاً')}</span>
      </div>
      <div className="awp-row" style={{ padding: '10px 20px', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border-divider)' }}>
        <input
          className="awp-input"
          style={{ flex: '1 1 220px', maxWidth: 360 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') filter.set('runQ', search.trim());
          }}
          onBlur={() => filter.set('runQ', search.trim())}
          placeholder={t('Search by run, goal or what it was for', 'ابحث بالعملية أو الهدف أو ما كانت له')}
          aria-label={t('Search runs', 'البحث في العمليات')}
        />
        <PopSelect className="awp-input" style={{ width: 180 }} value={String(runs.filters.period)} onChange={(e) => filter.set('runPeriod', e.target.value === '0' ? '' : e.target.value)} aria-label={t('Started', 'البدء')}>
          {RUN_PERIODS.map(([hours, en, ar]) => (
            <option key={hours} value={String(hours)}>{t(en, ar)}</option>
          ))}
        </PopSelect>
        <span className="awp-small awp-muted">{t(`${runs.page.total} runs`, `${runs.page.total} عملية`)}</span>
      </div>
      <DataTable
        onRow={(r) => go('run', { agent: a.id, id: r.id })}
        rows={rows}
        rowKey={(r) => r.id}
        server={{ ...runs.page, onPage: (next) => filter.set('page', String(next)) }}
        // `UC-51.4-02`: the table says it, rather than a second message below an empty one.
        empty={t('No runs match these filters.', 'لا توجد عمليات تطابق هذه المرشحات.')}
        cols={[
          { h: t('Run', 'العملية'), r: (r) => (<div><div style={{ fontWeight: 500 }}>{t(r.goal, r.goalAr)}</div><div className="awp-small awp-muted awp-mono">{r.id} · {r.by}</div></div>) },
          {
            h: t('Status', 'الحالة'),
            r: (r) => (
              <div className="awp-col" style={{ gap: 4, alignItems: 'flex-start' }}>
                <RunTag s={r.st} waitingOn={r.waitingOn} />
                {/* `UC-12.1-01`: the decision is taken where the work is, so the row
                    points at the room or the work item rather than only reporting that
                    something, somewhere, is waiting. */}
                {r.waitingOn === 'Approval' || r.waitingOn === 'Question' ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Lnk
                      onClick={() =>
                        r.roomKey
                          ? go('session', { key: r.roomKey })
                          : r.workItemKey
                            ? go('tasks', { open: r.workItemKey })
                            : go('inbox')
                      }
                    >
                      {r.roomKey
                        ? t(`Decide in ${r.roomKey}`, `القرار في ${r.roomKey}`)
                        : r.workItemKey
                          ? t(`Decide in ${r.workItemKey}`, `القرار في ${r.workItemKey}`)
                          : t('Decide in the Inbox', 'القرار في صندوق الوارد')}
                    </Lnk>
                  </div>
                ) : null}
              </div>
            ),
          },
          { h: t('Started', 'البدء'), r: (r) => <span className="awp-mono">{formatDay(lang, new Date(r.at))} {formatTime(lang, new Date(r.at))}</span> },
          { h: t('Duration', 'المدة'), end: true, r: (r) => (r.durationMs === null ? '—' : `${(r.durationMs / 1000).toFixed(1)}s`) },
          {
            h: '',
            end: true,
            r: (r) =>
              cancellable(r.st) && may('agents:invoke') ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <Lnk danger onClick={() => setCancelling(r.id)}>{t('Cancel', 'إلغاء')}</Lnk>
                </div>
              ) : null,
          },
        ]}
      />
      {cancelling && (
        <Modal
          title={t('Cancel this run?', 'إلغاء هذه العملية؟')}
          onClose={() => setCancelling(null)}
          footer={
            <>
              <Btn type="secondary" label={t('Keep running', 'متابعة')} onClick={() => setCancelling(null)} />
              <Btn type="danger" label={t('Cancel run', 'إلغاء العملية')} disabled={busy} onClick={() => cancel(cancelling)} />
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {t(
              'The run stops after its current step. Anything it has already done stays done.',
              'تتوقف العملية بعد خطوتها الحالية. ما أنجزته بالفعل يبقى كما هو.',
            )}
          </p>
          {problem && (
            <p role="alert" style={{ margin: '12px 0 0', color: 'var(--feedback-danger-text)' }}>
              {problem}
            </p>
          )}
        </Modal>
      )}
    </Card>
  );
}
