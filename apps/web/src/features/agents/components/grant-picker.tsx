"use client";

import { useState } from "react";

import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { Tg } from "@/components/ui/tag";
import { useAwp } from "@/hooks/use-awp";

/**
 * D238: what an agent holds, chosen in one popup and saved as one change. Each group (a
 * connector) is collapsed and ticked as a whole; opening it lets single items be left out.
 * A group without a label (the Skills tab) lists its items directly.
 */

export type PickerItem = { key: string; name: string; tier?: string | null; note?: string };
export type PickerGroup = { id: string; label: string | null; items: PickerItem[] };

/**
 * The grant popup: a search box and the groups, each with a whole-group checkbox (indeterminate
 * when partly held) and an "n of m" count. A search expands every group that has a match. Save
 * is disabled until something changed; when `warnOf` has a warning for the additions, the first
 * Save shows it and the second calls `onSave` with every key picked.
 */
export function GrantPicker({
  title,
  groups,
  initial,
  saving,
  warnOf,
  onClose,
  onSave,
}: {
  title: string;
  groups: PickerGroup[];
  /** The keys held now. */
  initial: Set<string>;
  saving: boolean;
  /** The sentence that asks a person to confirm adding these items, when any needs it. */
  warnOf?: (added: PickerItem[]) => string | null;
  onClose: () => void;
  onSave: (picked: Set<string>) => void;
}) {
  const { t } = useAwp();
  const [picked, setPicked] = useState(() => new Set(initial));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);

  const all = groups.flatMap((group) => group.items);
  const added = all.filter((item) => picked.has(item.key) && !initial.has(item.key));
  const removed = all.filter((item) => !picked.has(item.key) && initial.has(item.key));
  const warning = confirming && warnOf ? warnOf(added) : null;
  const needle = query.trim().toLowerCase();

  const toggle = (keys: string[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const save = () => {
    if (!confirming && warnOf?.(added)) {
      setConfirming(true);
      return;
    }
    onSave(picked);
  };

  const item = (entry: PickerItem) => (
    <label key={entry.key} className="awp-row" style={{ gap: 10, padding: "6px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={picked.has(entry.key)} disabled={saving} onChange={(event) => toggle([entry.key], event.target.checked)} />
      <span className="awp-mono" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{entry.name}</span>
      {entry.note && <span className="awp-small awp-muted">{entry.note}</span>}
      {entry.tier && <Tg tone={entry.tier === "T2" || entry.tier === "T3" ? "warning" : "neutral"} label={entry.tier} />}
    </label>
  );

  return (
    <Modal
      w={720}
      title={title}
      onClose={onClose}
      dirty={added.length + removed.length > 0}
      footer={
        <>
          <span className="awp-small awp-muted" style={{ marginInlineEnd: "auto" }}>
            {t(`${added.length} to add · ${removed.length} to remove`, `${added.length} للإضافة · ${removed.length} للإزالة`)}
          </span>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            type={warning ? "danger" : "default"}
            label={warning ? t("Grant them and save", "امنحها واحفظ") : t("Save", "حفظ")}
            disabled={saving || added.length + removed.length === 0}
            onClick={save}
          />
        </>
      }
    >
      <input
        className="awp-input"
        type="search"
        value={query}
        placeholder={t("Search", "بحث")}
        aria-label={t("Search", "بحث")}
        onChange={(event) => setQuery(event.target.value)}
      />
      {warning && (
        <p role="alert" className="awp-small" style={{ margin: 0, color: "var(--feedback-warning-text)" }}>
          {warning}
        </p>
      )}
      <div style={{ maxHeight: "55vh", overflow: "auto" }}>
        {groups.map((group) => {
          const shown = needle ? group.items.filter((entry) => entry.name.toLowerCase().includes(needle)) : group.items;
          if (needle && shown.length === 0) return null;
          if (group.label === null) return <div key={group.id}>{shown.map(item)}</div>;
          const keys = group.items.map((entry) => entry.key);
          const held = keys.filter((key) => picked.has(key)).length;
          const expanded = open.has(group.id) || needle !== "";
          return (
            <div key={group.id} data-group={group.id} style={{ borderBottom: "1px solid var(--border-divider)" }}>
              <div className="awp-row" style={{ gap: 10, padding: "10px 0" }}>
                <input
                  type="checkbox"
                  aria-label={group.label}
                  checked={held === keys.length && keys.length > 0}
                  ref={(element) => {
                    if (element) element.indeterminate = held > 0 && held < keys.length;
                  }}
                  disabled={saving || keys.length === 0}
                  onChange={() => toggle(keys, held < keys.length)}
                />
                <b style={{ flex: 1 }}>{group.label}</b>
                <span className="awp-small awp-muted">{t(`${held} of ${keys.length} tools`, `${held} من ${keys.length} أداة`)}</span>
                <button
                  type="button"
                  className="awp-iconbtn"
                  style={{ width: 32, height: 32 }}
                  aria-expanded={expanded}
                  aria-label={t(`Choose ${group.label} tools`, `اختيار أدوات ${group.label}`)}
                  onClick={() =>
                    setOpen((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                >
                  <span style={{ display: "inline-flex", transform: expanded ? "none" : "rotate(-90deg)", transition: "transform .15s" }}>
                    <Ic n="ChevronDown" s={18} />
                  </span>
                </button>
              </div>
              {expanded && <div style={{ paddingInlineStart: 28, paddingBottom: 8 }}>{shown.map(item)}</div>}
            </div>
          );
        })}
        {groups.every((group) => group.items.length === 0) && (
          <p className="awp-muted" style={{ margin: 0, padding: "12px 0" }}>{t("Nothing to choose from.", "لا يوجد ما يمكن اختياره.")}</p>
        )}
      </div>
    </Modal>
  );
}
