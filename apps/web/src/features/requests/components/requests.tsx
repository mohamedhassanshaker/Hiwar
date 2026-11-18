"use client";

import { useState } from "react";

import { usePeople } from "@/components/shared/directory";
import { type Request, type RequestDetail, type RequestType } from "@/features/requests/types";
import { formatDay } from "@/i18n";
import { useModals } from "@/components/shared/modal-host";
import { useGo } from "@/lib/routes";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PopDate } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery, useOpenQuery } from "@/hooks/use-filter-query";
import { useProjOpts } from "@/components/shared/forms";
import { DataTable, FilterBar, Sel } from "@/components/shared/layout";
import { StTag, useTr } from "@/components/shared/status-tags";
import type { ServerPage } from "@/lib/paging";
import { useRtName, RequestView } from "./request-view";

export type RequestListFilters = { q: string; project: string; by: string; type: string; status: string; from: string; to: string };

/**
 * The request list (S-27) with filters for title or key, project, requester, type, status and
 * submission period, or the detail of the open request. The filters, the page and the open
 * request are in the address and applied on the server (D349); `?project=` presets the project,
 * and `?open=` opens that request whether or not it is on the page.
 */
export function Requests({
  requests,
  page,
  types,
  filters,
  opened,
}: {
  requests: Request[];
  page: ServerPage;
  types: RequestType[];
  filters: RequestListFilters;
  opened: { request: Request; detail: RequestDetail } | null;
}) {
  const { t, lang, nm, aName } = useAwp();
  const { open } = useModals();
  const go = useGo();
  const filter = useFilterQuery();
  const tr = useTr();
  const rtName = useRtName(types);
  const projOpts = useProjOpts();
  const people = usePeople();
  const [text, setText] = useState(filters.q);
  // Opening a request keeps the list's filters and page, so Back returns to the same place.
  const show = useOpenQuery();
  if (opened) {
    return <RequestView key={opened.request.k} r={opened.request} detail={opened.detail} types={types} back={() => show(null)} go={go} />;
  }
  const set = (key: string) => (value: string) => filter.set(key, value === "any" ? "" : value);
  return (
    <div className="awp-page">
      <PageHead
        title={t('Requests', 'الطلبات')}
        sub={t("Every request belongs to a project and a request type, and moves through the type's transition steps.", 'ينتمي كل طلب إلى مشروع ونوع طلب، ويمر عبر خطوات الانتقال الخاصة بالنوع.')}
      >
        <Btn label={t('New Request', 'طلب جديد')} icon="AddCircle" onClick={() => open('request')} />
      </PageHead>
      <Card pad={false}>
        <FilterBar>
          <input
            className="awp-input"
            style={{ maxWidth: 220 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') filter.set('q', text.trim());
            }}
            onBlur={() => filter.set('q', text.trim())}
            placeholder={t('Title or key', 'العنوان أو المفتاح')}
          />
          <Sel value={filters.project || 'any'} onChange={set('project')} opts={projOpts()} />
          <Sel value={filters.by || 'any'} onChange={set('by')} w={180} opts={[['any', t('Any requester', 'أي مقدم طلب')], ...people.map((x) => [x.id, nm(x)] as [string, string]), ['ext', t('External contact', 'جهة خارجية')]]} />
          <Sel value={filters.type || 'any'} onChange={set('type')} w={180} opts={[['any', t('Any type', 'أي نوع')], ...types.map((x) => [x.c, t(x.n, x.nAr)] as [string, string])]} />
          <Sel value={filters.status || 'any'} onChange={set('status')} w={160} opts={[['any', t('Any status', 'أي حالة')], ...['Triage', 'Submitted', 'InReview', 'Approved', 'Rejected', 'Completed'].map((s) => [s, tr(s)] as [string, string])]} />
          <div className="awp-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="awp-small awp-muted">{t('Period', 'الفترة')}</span>
            <PopDate className="awp-input" style={{ width: 150, maxWidth: '100%' }} value={filters.from} onChange={(e) => set('from')(e.target.value)} />
            <span className="awp-muted">–</span>
            <PopDate className="awp-input" style={{ width: 150, maxWidth: '100%' }} value={filters.to} onChange={(e) => set('to')(e.target.value)} />
          </div>
          <Lnk
            onClick={() => {
              setText('');
              filter.clear();
            }}
          >
            {t('Clear', 'مسح')}
          </Lnk>
        </FilterBar>
        <DataTable
          rows={requests}
          rowKey={(r) => r.k}
          server={{ ...page, onPage: (next) => filter.set('page', String(next)) }}
          empty={t('No requests match these filters.', 'لا توجد طلبات تطابق عوامل التصفية.')}
          cols={[
            { h: t('Request', 'الطلب'), r: (r) => (<div><button className="awp-lnk-t" onClick={() => show(r.k)}>{t(r.t, r.tAr)}</button><div className="awp-small awp-muted awp-mono">{r.k}</div></div>) },
            { h: t('Project', 'المشروع'), r: (r) => <span className="awp-mono">{r.p}</span> },
            { h: t('Type', 'النوع'), r: (r) => rtName(r.ty) },
            { h: t('Requester', 'مقدم الطلب'), r: (r) => (r.by === 'ext' ? <span className="awp-muted">{t('External contact', 'جهة خارجية')}</span> : aName(r.by)) },
            { h: t('Submitted', 'التقديم'), r: (r) => <span className="awp-mono">{formatDay(lang, new Date(r.submittedAt))}</span> },
            { h: t('Status', 'الحالة'), r: (r) => <StTag s={r.st} /> },
          ]}
        />
      </Card>
    </div>
  );
}
