"use client";

import { useState } from "react";

import { useProjects } from "@/components/shared/directory";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { Pager } from "@/components/shared/pager";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/tabs";
import { Kpi } from "@/components/ui/metrics";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { SessionRows, useSesAr } from "@/features/rooms/components/session-rows";
import type { RoomCounts, Session } from "@/features/rooms/types";
import type { ServerPage } from "@/lib/paging";

/**
 * S-22: the rooms list, a page at a time, filtered on the server.
 *
 * `UC-23.3-07`: the filters live in the address rather than in this component's state, so
 * coming back from a room returns to the list the person was looking at. The default is
 * Status = Active (`UC-22.1-01`).
 */
export function SessionsList({
  rooms,
  counts,
  page,
  filters,
}: {
  rooms: Session[];
  counts: RoomCounts;
  page: ServerPage;
  filters: { status: string; project: string; q: string };
}) {
  const { t } = useAwp();
  const ar = useSesAr();
  const { open } = useModals();
  const projects = useProjects();
  const filter = useFilterQuery();
  const [q, setQ] = useState(filters.q);
  const proj = filters.project || "any";

  return (
    <div className="awp-page">
      <PageHead title={t('Discussion Rooms', 'اجتماعات العمل')} sub={t('Topic-scoped rooms inside a project where people and agents work together.', 'اجتماعات مخصصة لموضوعات داخل مشروع يعمل فيها الموظفون والوكلاء معاً.')}>
        <Btn label={t('New Discussion Room', 'اجتماع عمل جديد')} icon="AddCircle" onClick={() => open('room')} />
      </PageHead>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(180px,100%),1fr))', gap: 16 }}>
        <Kpi label={t('Total', 'الإجمالي')} value={counts.total.toLocaleString()} />
        <Kpi label={t('Active', 'نشط')} value={counts.active.toLocaleString()} tone="success" />
        <Kpi label={t('Archived', 'مؤرشف')} value={counts.archived.toLocaleString()} />
        <Kpi label={t('Messages', 'الرسائل')} value={counts.messages.toLocaleString()} />
      </div>
      <Card pad={false}>
        <div className="awp-row" style={{ padding: '14px 20px', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border-divider)' }}>
          <input
            className="awp-input"
            style={{ maxWidth: 260 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') filter.set('q', q.trim());
            }}
            onBlur={() => {
              if (q.trim() !== filters.q) filter.set('q', q.trim());
            }}
            placeholder={t('Search by title or key', 'ابحث بالعنوان أو المفتاح')}
            aria-label={t('Search by title or key', 'ابحث بالعنوان أو المفتاح')}
          />
          <PopSelect className="awp-input" style={{ maxWidth: 240 }} value={proj} onChange={(e) => filter.set('project', e.target.value === 'any' ? '' : e.target.value)}>
            <option value="any">{t('All projects', 'كل المشاريع')}</option>
            {projects.map((p) => (
              <option key={p.k} value={p.k}>
                {p.k} — {t(p.n, p.nAr)}
              </option>
            ))}
          </PopSelect>
          <span className="awp-small awp-muted">{t('Status', 'الحالة')}</span>
          {/* Active is the default, so choosing it clears the parameter; `any` is kept, because no parameter means Active. */}
          <Chips value={filters.status} onChange={(id) => filter.set('status', id === 'Active' ? '' : id)} items={[...['Active', 'Idle', 'Paused', 'Closed', 'Archived'].map((k) => ({ id: k, label: ar(k) })), { id: 'any', label: t('Any', 'الكل') }]} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <SessionRows rows={rooms} />
        </div>
        {!rooms.length && (
          <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: 'center' }}>
            {t('No discussion rooms match these filters.', 'لا توجد اجتماعات عمل تطابق عوامل التصفية.')}
          </p>
        )}
        <Pager
          page={page.page - 1}
          last={Math.max(0, Math.ceil(page.total / page.size) - 1)}
          total={page.total}
          size={page.size}
          onPage={(next) => filter.set('page', String(next + 1))}
        />
      </Card>
    </div>
  );
}
