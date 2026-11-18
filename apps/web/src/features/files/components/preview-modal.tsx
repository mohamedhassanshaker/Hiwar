"use client";

import { orThrow } from "@/lib/outcome";
import { useEffect, useState, useTransition } from "react";

import { useDirectory, useMay } from "@/components/shared/directory";
import { MsgBody } from "@/components/shared/message";
import type { ModalProps } from "@/components/shared/modal-host";
import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { Tg } from "@/components/ui/tag";
import { deleteItem, loadPreview, setFileStatus, setScopeOfUse } from "@/features/files/actions";
import type { Preview } from "@/features/files/types";
import { useAwp } from "@/hooks/use-awp";
import { ScopeOfUseFields, useScopeLabel } from "./file-modals";

/**
 * The preview dialog of one file, artifact or attachment: the content as the server's
 * `loadPreview` says to draw it (framed, as parsed text, or a download notice), its details,
 * Activate or Deactivate, Delete and Download. The file's uploader, holding `files:write`, edits
 * its scope of use here, as the server allows only them; anybody else reads it. `viewOnly`, used
 * from a room, offers Download only.
 */
export function PreviewModal({ onClose, item, owner, viewOnly }: ModalProps) {
  const { t, aName, why } = useAwp();
  const may = useMay();
  const { me } = useDirectory();
  const scopeLabel = useScopeLabel();
  const [st, setSt] = useState(item?.st || "Active");
  const [scope, setScope] = useState(item?.scope ?? "");
  const [grants, setGrants] = useState<string[]>(item?.grantIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const kind = item ? (item.kind ?? (item.scope ? "file" : "artifact")) : "file";
  // `UC-33.1-07`: only the uploader may change a file's scope (D183); an unknown uploader is nobody.
  const mayChangeScope = kind === "file" && !!item?.scope && may("files:write") && !!item.w && item.w === me.id;
  // `UC-32.1-02`: the server says what can be drawn, from the stored type; `UC-32.1-06`: a
  // format it cannot draw gets its file-type icon and Download.
  const [preview, setPreview] = useState<Preview | null>(null);
  const ownerType = owner?.type;
  const ownerKey = owner?.key;
  useEffect(() => {
    if (!item) return;
    let current = true;
    void loadPreview({ name: item.n, kind, ...(ownerType && ownerKey ? { owner: { type: ownerType, key: ownerKey } } : {}) }).then((outcome) => {
      if (current) setPreview(outcome.ok ? outcome.value : { mode: "none", reason: outcome.reason, reasonAr: outcome.reasonAr });
    });
    return () => {
      current = false;
    };
  }, [item, kind, ownerType, ownerKey]);
  if (!item) return null;
  // The bytes come through the console, which is where the scope of use is decided.
  const contentUrl =
    `/api/files?name=${encodeURIComponent(item.n)}&kind=${kind}` +
    (owner ? `&ownerType=${owner.type}&ownerKey=${encodeURIComponent(owner.key)}` : "");

  const setStatus = (active: boolean) =>
    start(async () => {
      setError(null);
      try {
        orThrow(await setFileStatus({ name: item.n, kind, active }));
        setSt(active ? "Active" : "Inactive");
      } catch (problem) {
        setError(why(problem));
      }
    });

  /**
   * `UC-33.1-07`: the scope changes where the file is opened, and takes effect at once. Offered
   * to the uploader only, whom the server also requires.
   */
  const changeScope = (nextScope: string, nextGrants: string[]) =>
    start(async () => {
      setError(null);
      try {
        orThrow(await setScopeOfUse({ name: item.n, scope: nextScope, grants: nextScope === "Selected" ? nextGrants : [] }));
        setScope(nextScope);
        setGrants(nextGrants);
      } catch (problem) {
        setError(why(problem));
      }
    });

  const remove = () =>
    start(async () => {
      setError(null);
      try {
        orThrow(await deleteItem({ name: item.n, kind, active: false }));
        onClose();
      } catch (problem) {
        setError(why(problem));
      }
    });

  return (
    <Modal
      w={960}
      title={item.n}
      onClose={onClose}
      footer={
        <>
          {/* An attachment has no life of its own: it belongs to the item it is on. */}
          {!viewOnly &&
            kind !== "attachment" &&
            (st === "Active" ? (
              <Btn type="secondary" label={t("Deactivate", "تعطيل")} disabled={pending} onClick={() => setStatus(false)} />
            ) : (
              <Btn type="secondary" label={t("Activate", "تفعيل")} disabled={pending} onClick={() => setStatus(true)} />
            ))}
          {!viewOnly && kind !== "attachment" && <Btn type="danger" label={t("Delete", "حذف")} disabled={pending} onClick={remove} />}
          <Btn label={t("Download", "تنزيل")} onClick={() => window.open(`${contentUrl}&download=1`, "_blank", "noopener")} />
        </>
      }
    >
      <div
        style={{
          height: "min(68vh, 760px)",
          borderRadius: 12,
          background: "var(--surface-sunken)",
          display: "grid",
          placeItems: preview?.mode === "text" ? "stretch" : "center",
          overflow: "hidden",
        }}
      >
        {preview === null ? (
          <span className="awp-small awp-muted" role="status">
            {t("Loading the preview…", "جارٍ تحميل المعاينة…")}
          </span>
        ) : preview.mode === "inline" ? (
          // `UC-32.1-02`: the preview shows the file itself, through the same guarded read
          // the download uses.
          <iframe src={contentUrl} title={item.n} style={{ width: "100%", height: "100%", border: 0, background: "var(--surface-card)" }} />
        ) : preview.mode === "text" ? (
          // A Word, Excel or PowerPoint file, read by the document parser.
          <div style={{ overflow: "auto", padding: 20, background: "var(--surface-card)" }}>
            <MsgBody text={preview.text} />
          </div>
        ) : (
          <div className="awp-col" style={{ alignItems: "center", gap: 8, padding: 20, textAlign: "center" }}>
            <Ic n="File01" s={44} c="var(--icon-tertiary)" />
            <span className="awp-small awp-muted">
              {t("This format cannot be previewed. Download it to read it.", "لا يمكن معاينة هذا التنسيق. نزّله لقراءته.")}
            </span>
            {preview.reason && <span className="awp-small awp-muted">{t(preview.reason, preview.reasonAr ?? preview.reason)}</span>}
          </div>
        )}
      </div>
      {!viewOnly && kind !== "attachment" && (
        <p className="awp-small awp-muted" style={{ margin: 0 }} role="note">
          {t("Deleting removes it from the project. Audit records are kept.", "الحذف يزيله من المشروع. تُحفظ سجلات التدقيق.")}
        </p>
      )}
      {!viewOnly && (
        <dl className="awp-kv" style={{ margin: 0 }}>
        <dt>{t("Status", "الحالة")}</dt>
        <dd>
          <Tg
            tone={st === "Active" ? "success" : st === "Quarantined" ? "danger" : "neutral"}
            dot
            label={st === "Active" ? t("Active", "نشط") : st === "Quarantined" ? t("Quarantined", "محجوز") : t("Inactive", "معطّل")}
          />
        </dd>
        <dt>{t("Project", "المشروع")}</dt>
        <dd className="awp-mono">{item.p}</dd>
        <dt>{item.scope ? t("Uploaded by", "رفعه") : t("Produced by", "أنتجه")}</dt>
        <dd>{aName(item.w)}</dd>
        {item.scope && !mayChangeScope && (
          <>
            <dt>{t("Scope of use", "نطاق الاستخدام")}</dt>
            <dd>{scopeLabel(item)}</dd>
          </>
        )}
        {item.l && (
          <>
            <dt>{t("Linked to", "مرتبط بـ")}</dt>
            <dd className="awp-mono">{item.l}</dd>
          </>
        )}
        <dt>{t("Size", "الحجم")}</dt>
        <dd>{item.s}</dd>
        </dl>
      )}
      {!viewOnly && mayChangeScope && (
        <ScopeOfUseFields
          scope={scope}
          grants={grants}
          disabled={pending}
          onScope={(next) => changeScope(next, grants)}
          onGrants={(next) => changeScope("Selected", next)}
        />
      )}
      {error && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
