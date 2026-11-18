"use client";

import { type Task } from "@/features/work-items/types";
import { formatDay } from "@/i18n";
import { priAr, priTone } from "@/i18n/vocabulary";
import { Bar } from "@/components/ui/metrics";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { useAwp } from "@/hooks/use-awp";
import { useTypeLbl } from "./work-item-labels";

/**
 * One work item on the board: key and project, why it is hot, its title, sub-item progress,
 * priority, due date and assignee. Clicking opens it; dragging carries its key to a column.
 */
export function TaskCard({ x, onOpen, hot }: { x: Task; onOpen: (x: Task) => void; hot: string | null }) {
  const { t, lang } = useAwp();
  const typeLbl = useTypeLbl();
  return (
    <button
      className="awp-card"
      onClick={() => onOpen(x)}
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/plain', x.k)}
      style={{ padding: 14, textAlign: 'start', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
    >
      {/* The header row wraps: a comment-raised item can carry three tags beside its key,
          and a row that does not wrap pushes the last of them out of the card. */}
      <div className="awp-row" style={{ flexWrap: 'wrap', rowGap: 6 }}>
        <span className="awp-mono awp-muted" style={{ flex: 1, minWidth: 0 }}>{x.k} · {x.p}</span>
        {hot && <Tg tone="danger" dot label={hot} />}
        {x.fromComment && <Tg tone="brand" label={t('From comment', 'من تعليق')} />}
        {x.type !== 'Task' && <Tg tone={x.type === 'Bug' ? 'danger' : 'neutral'} label={typeLbl(x.type)} />}
      </div>
      <div style={{ fontWeight: 500, lineHeight: 1.35 }}>{t(x.t, x.tAr)}</div>
      {x.sub > 0 && (
        <div className="awp-row awp-small awp-muted" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}><Bar h={4} parts={[{ v: (x.done / x.sub) * 100, c: 'var(--action-primary-bg)' }]} /></div>
          {x.done}/{x.sub}
        </div>
      )}
      <div className="awp-row">
        <Tg tone={priTone[x.pri]} label={t(x.pri, priAr[x.pri])} />
        <span className="awp-small awp-muted" style={{ flex: 1 }}>{x.dueAt ? formatDay(lang, new Date(x.dueAt)) : "—"}</span>
        {x.who ? <Who id={x.who} s={26} /> : <span className="awp-small awp-muted">{t('Unassigned', 'غير مُسند')}</span>}
      </div>
    </button>
  );
}
