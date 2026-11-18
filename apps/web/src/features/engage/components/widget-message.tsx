"use client";

import { useState } from "react";

import { MsgBody } from "@/components/shared/message";
import type { Action, Block, Chip, Lang, WidgetMessage } from "@/features/engage/protocol";

/** One message of the embedded widget and the blocks it is drawn from (widget specification 6). */

const time = (lang: Lang, iso: string) =>
  new Date(iso).getTime() > 0 ? new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn" : "en-AE", { hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "";

/**
 * One message bubble with its blocks, and under it read aloud, the time, and thumbs on an
 * assistant message. Only the active message's controls are enabled.
 */
export function MessageView({
  message,
  active,
  busy,
  lang,
  t,
  readAloud,
  onAct,
  onSpeak,
  onFeedback,
}: {
  message: WidgetMessage;
  active: boolean;
  busy: boolean;
  lang: Lang;
  t: (en: string, ar: string) => string;
  readAloud: boolean;
  onAct: (action: Action) => void;
  onSpeak: (text: string) => void;
  onFeedback: (value: "up" | "down") => void;
}) {
  const side = message.role === "user" ? "awp-wf-user" : "awp-wf-bot";
  return (
    <div className={`awp-wf-msg ${side}`}>
      {message.role === "human_agent" && <div className="awp-wf-meta">{t("A person", "موظف")}</div>}
      <div className="awp-wf-bubble">
        {message.blocks.map((block, index) => (
          <BlockView key={index} block={block} active={active} busy={busy} lang={lang} t={t} onAct={onAct} />
        ))}
      </div>
      <div className="awp-wf-meta awp-wf-row">
        {message.role !== "user" && readAloud && message.speakable && (
          <button type="button" className="awp-wf-icon awp-wf-small" aria-label={t("Read aloud", "قراءة بصوت عالٍ")} onClick={() => onSpeak(message.speakable ?? "")}>
            <span aria-hidden="true">🔊</span>
          </button>
        )}
        <span>{time(lang, message.ts)}</span>
        {message.role === "assistant" && (
          <>
            <button type="button" className={"awp-wf-icon awp-wf-small" + (message.feedback === "up" ? " on" : "")} aria-pressed={message.feedback === "up"} aria-label={t("Helpful", "مفيد")} onClick={() => onFeedback("up")}>
              <span aria-hidden="true">👍</span>
            </button>
            <button type="button" className={"awp-wf-icon awp-wf-small" + (message.feedback === "down" ? " on" : "")} aria-pressed={message.feedback === "down"} aria-label={t("Not helpful", "غير مفيد")} onClick={() => onFeedback("down")}>
              <span aria-hidden="true">👎</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** A row of chips, each sending its action when enabled. */
function Chips({ items, enabled, onAct }: { items: Chip[]; enabled: boolean; onAct: (action: Action) => void }) {
  return (
    <div className="awp-wf-chips">
      {items.map((chip) => (
        <button key={chip.id} type="button" className="awp-wf-chip" disabled={!enabled} onClick={() => onAct(chip.action)}>
          {chip.label}
        </button>
      ))}
    </div>
  );
}

/** Lists show five rows a page, with Show more (specification 7.1, List). */
const LIST_PAGE = 5;

/**
 * One block as the widget draws it. Its controls work only on the active message and while no
 * call is in flight; persistent chips, a receipt's actions and a notice's actions stay usable on
 * older messages.
 */
function BlockView({
  block,
  active,
  busy,
  lang,
  t,
  onAct,
}: {
  block: Block;
  active: boolean;
  busy: boolean;
  lang: Lang;
  t: (en: string, ar: string) => string;
  onAct: (action: Action) => void;
}) {
  const [shown, setShown] = useState(LIST_PAGE);
  const enabled = active && !busy;
  switch (block.type) {
    case "text":
      return <MsgBody text={block.text} />;
    case "chips":
      return <Chips items={block.items} enabled={(block.persist || active) && !busy} onAct={onAct} />;
    case "list":
      return (
        <div className="awp-wf-list-block">
          {block.filters?.length ? <Chips items={block.filters} enabled={enabled} onAct={onAct} /> : null}
          {block.items.slice(0, shown).map((item) => (
            <button key={item.id} type="button" className="awp-wf-row-item" disabled={!enabled || !item.action} onClick={() => item.action && onAct(item.action)}>
              <span className="awp-wf-col">
                <b>{item.title}</b>
                {item.subtitle && <span className="awp-wf-muted">{item.subtitle}</span>}
              </span>
              {item.meta && <span className="awp-wf-muted">{item.meta}</span>}
              {item.badge && <span className="awp-wf-badge">{item.badge}</span>}
            </button>
          ))}
          <div className="awp-wf-row awp-wf-muted">
            <span>{t(`${Math.min(shown, block.items.length)} of ${block.total ?? block.items.length}`, `${Math.min(shown, block.items.length)} من ${block.total ?? block.items.length}`)}</span>
            {shown < block.items.length && (
              <button type="button" className="awp-wf-link" onClick={() => setShown(shown + LIST_PAGE)}>
                {t("Show more", "عرض المزيد")}
              </button>
            )}
          </div>
        </div>
      );
    case "card":
      return <Card card={block} enabled={enabled} onAct={onAct} />;
    case "carousel":
      return (
        <div className="awp-wf-carousel">
          {block.cards.map((card, index) => (
            <Card key={index} card={card} enabled={enabled} onAct={onAct} />
          ))}
        </div>
      );
    case "summary":
      return (
        <div className="awp-wf-card">
          <dl className="awp-wf-fields">
            {block.rows.map((row) => (
              <div key={row.field} className="awp-wf-field">
                <dt>{row.label}</dt>
                <dd>
                  {row.value}
                  {row.editable && enabled && (
                    <button type="button" className="awp-wf-link" onClick={() => onAct({ type: "edit_field", field: row.field })}>
                      {t("Edit", "تعديل")}
                    </button>
                  )}
                </dd>
              </div>
            ))}
            {block.total && (
              <div className="awp-wf-field awp-wf-total">
                <dt>{t("Total", "الإجمالي")}</dt>
                <dd>{block.total}</dd>
              </div>
            )}
          </dl>
          <Chips items={block.actions} enabled={enabled} onAct={onAct} />
        </div>
      );
    case "receipt":
      return (
        <div className="awp-wf-card awp-wf-receipt">
          <div className="awp-wf-badge awp-wf-ok">{block.status}</div>
          <div>
            {t("Reference", "المرجع")}: <b>{block.reference}</b>
          </div>
          {block.amount && <div>{block.amount}</div>}
          <div className="awp-wf-muted">{new Date(block.date).toLocaleString(lang === "ar" ? "ar-AE-u-nu-latn" : "en-AE")}</div>
          {block.fields.map((field) => (
            <div key={field.label} className="awp-wf-field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
          <Chips items={block.actions} enabled onAct={onAct} />
        </div>
      );
    case "timeline":
      return (
        <ol className="awp-wf-timeline">
          {block.events.map((event, index) => (
            <li key={index} className={`awp-wf-${event.state}`}>
              <span>{event.label}</span>
              {event.ts && <span className="awp-wf-muted">{event.ts}</span>}
            </li>
          ))}
        </ol>
      );
    case "notice":
      return (
        <div className={`awp-wf-inline-notice awp-wf-${block.level}`} role={block.level === "error" ? "alert" : "status"}>
          <span>{block.text}</span>
          {block.actions?.length ? <Chips items={block.actions} enabled={!busy} onAct={onAct} /> : null}
        </div>
      );
    case "progress":
      return (
        <div className="awp-wf-progress" role="progressbar" aria-valuemin={1} aria-valuemax={block.total} aria-valuenow={block.current} aria-label={block.label}>
          <span className="awp-wf-muted">{t(`Step ${block.current} of ${block.total}`, `الخطوة ${block.current} من ${block.total}`)}</span>
          <span className="awp-wf-bar">
            <span style={{ width: `${Math.round((block.current / Math.max(1, block.total)) * 100)}%` }} />
          </span>
        </div>
      );
    case "handoff":
      return (
        <div className="awp-wf-inline-notice awp-wf-info" role="status">
          {block.state === "connected"
            ? t(`You are chatting with ${block.agentName ?? "a person"}.`, `أنت تتحدث مع ${block.agentName ?? "موظف"}.`)
            : block.state === "ended"
              ? t("The person has closed this conversation.", "أغلق الموظف هذه المحادثة.")
              : t(`Connecting you to a person.${block.position ? ` You are number ${block.position} in line.` : ""}`, `جارٍ تحويلك إلى موظف.${block.position ? ` ترتيبك ${block.position} في الانتظار.` : ""}`)}
        </div>
      );
    case "link_out":
      return (
        <a className="awp-wf-chip awp-wf-linkout" href={block.url} target="_blank" rel="noopener noreferrer">
          {block.label} ↗
        </a>
      );
    case "attachment":
      return (
        <a className="awp-wf-link" href={block.url} target="_blank" rel="noopener noreferrer" download={block.name}>
          {block.name}
        </a>
      );
  }
}

/** A result card: title, badge, subtitle, its fields, and its action chips. */
function Card({ card, enabled, onAct }: { card: Extract<Block, { type: "card" }>; enabled: boolean; onAct: (action: Action) => void }) {
  return (
    <div className="awp-wf-card">
      <div className="awp-wf-row">
        <b style={{ flex: 1 }}>{card.title}</b>
        {card.badge && <span className="awp-wf-badge">{card.badge}</span>}
      </div>
      {card.subtitle && <div className="awp-wf-muted">{card.subtitle}</div>}
      <dl className="awp-wf-fields">
        {card.fields.map((field) => (
          <div key={field.label} className="awp-wf-field">
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      {card.actions?.length ? <Chips items={card.actions} enabled={enabled} onAct={onAct} /> : null}
    </div>
  );
}
