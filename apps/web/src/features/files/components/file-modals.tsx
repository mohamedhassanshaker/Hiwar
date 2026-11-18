"use client";

import { orThrow } from "@/lib/outcome";
import { useState, useTransition } from "react";

import { useAgents, usePeople, useProjects } from "@/components/shared/directory";
import type { ModalProps } from "@/components/shared/modal-host";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Seg } from "@/components/ui/tabs";
import { Who } from "@/components/ui/avatar";
import { attachFile, attachHeld, uploadFile } from "@/features/files/actions";
import { HeldPicker } from "./held-picker";
import { useAwp } from "@/hooks/use-awp";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, uploadRefusal } from "@/lib/uploads";

/**
 * S-33 uploading a file, and the preview both S-32 and S-33 open.
 *
 * The scope is chosen before the bytes leave the browser because it is stored with them:
 * a file uploaded first and scoped afterwards is readable by the whole project in between.
 */

/** The three scopes of use, as the data model names them. */
const SCOPES: [id: string, en: string, ar: string][] = [
  ["OnlyMe", "Only me", "أنا فقط"],
  ["Selected", "Selected", "محدد"],
  ["AllProject", "All", "الكل"],
];

/** Data model section 9: how a file's scope of use reads in a list or a preview. */
export function useScopeLabel(): (item: { scope?: string; grants?: string[] }) => string {
  const { t } = useAwp();
  return (item) =>
    item.scope === "OnlyMe"
      ? t("Only me", "أنا فقط")
      : item.scope === "AllProject"
        ? t("All project members & agents", "كل أعضاء المشروع ووكلائه")
        : t("Selected: ", "محدد: ") + (item.grants ?? []).join(", ");
}

/**
 * `UC-33.1-01` … `-03` and `-07`: the scope of use and, for Selected, who may use the file.
 * The upload and the preview offer the same choices. `grants` are person ids and agent codes.
 */
export function ScopeOfUseFields({
  scope,
  grants,
  onScope,
  onGrants,
  disabled,
}: {
  scope: string;
  grants: string[];
  onScope: (scope: string) => void;
  onGrants: (grants: string[]) => void;
  disabled?: boolean;
}) {
  const { t, nm } = useAwp();
  const principals = [...usePeople(), ...useAgents()];
  const toggle = (id: string) => onGrants(grants.includes(id) ? grants.filter((x) => x !== id) : [...grants, id]);
  return (
    <>
      <Field label={t("Scope of use", "نطاق الاستخدام")}>
        <Seg
          value={scope}
          onChange={onScope}
          items={SCOPES.map(([id, en, ar]) => ({ id, label: t(en, ar), disabled }))}
        />
      </Field>
      {scope === "Selected" && (
        <Field label={t("Who can use it", "من يمكنه استخدامه")}>
          <div className="awp-row" style={{ flexWrap: "wrap", gap: 8 }}>
            {principals.map((principal) => (
              <button
                key={principal.id}
                className={"awp-chip" + (grants.includes(principal.id) ? " on" : "")}
                disabled={disabled}
                onClick={() => toggle(principal.id)}
                style={{ paddingInlineStart: 4 }}
              >
                <Who id={principal.id} s={24} />
                {nm(principal)}
              </button>
            ))}
          </div>
        </Field>
      )}
      <p className="awp-small awp-muted" style={{ margin: 0 }}>
        {scope === "OnlyMe"
          ? t("Only you, and agents acting on your behalf, can read this file.", "أنت فقط والوكلاء الذين يعملون نيابة عنك يمكنهم قراءة الملف.")
          : scope === "AllProject"
            ? t("Every member and agent of the project can read this file.", "كل أعضاء المشروع ووكلائه يمكنهم قراءة الملف.")
            : t("Only the people and agents selected above can read this file.", "فقط الموظفين والوكلاء المحددون أعلاه يمكنهم قراءة الملف.")}
      </p>
    </>
  );
}

/**
 * `UC-33.1-01` and `UC-25.1-03`: a file into a project, or onto one item.
 *
 * Opened from the Files screen it asks for a project and a scope of use. Opened on a
 * request, a work item or a room it attaches to that item instead, from this computer or
 * from the files and artifacts the person may read, searched on the server: an attachment
 * belongs to the thing it is on, so it has no scope of its own to ask about.
 */
export function UploadFileModal({ onClose, owner }: ModalProps) {
  const { t, why } = useAwp();
  const projects = useProjects();

  const [source, setSource] = useState<"Local" | "File" | "Artifact">("Local");
  const [picked, setPicked] = useState<string | null>(null);

  const [projectKey, setProjectKey] = useState(projects[0]?.k ?? "");
  const [scope, setScope] = useState("OnlyMe");
  const [grants, setGrants] = useState<string[]>([]);
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const choose = async (chosen: File | undefined) => {
    setError(null);
    setFile(null);
    if (!chosen) return;
    // `UC-33.1-04`: the size and type are refused here as well as on the server, so the
    // person is told before a large file is read at all.
    const refusal = uploadRefusal({ name: chosen.name, mimeType: chosen.type, size: chosen.size });
    if (refusal) {
      setError(t(refusal.en, refusal.ar));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: chosen.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(chosen);
  };

  const upload = () =>
    start(async () => {
      setError(null);
      if (owner && source !== "Local") {
        if (!picked) return;
        try {
          orThrow(await attachHeld({ ownerType: owner.type, ownerKey: owner.key, kind: source, id: picked }));
          onClose();
        } catch (problem) {
          setError(why(problem));
        }
        return;
      }
      if (!file) return;
      try {
        if (owner) {
          orThrow(await attachFile({ ownerType: owner.type, ownerKey: owner.key, name: file.name, dataUrl: file.dataUrl }));
          onClose();
          return;
        }
        const outcome = orThrow(await uploadFile({ projectKey, name: file.name, dataUrl: file.dataUrl, scope, grants }));
        // `UC-33.1-05`: a flagged file is stored but not usable, and the person is told why.
        if (outcome.quarantined) {
          setError(t(`Quarantined: ${outcome.quarantined}`, `محجوز: ${outcome.quarantined}`));
          return;
        }
        onClose();
      } catch (problem) {
        setError(why(problem));
      }
    });

  return (
    <Modal
      title={owner ? t("Add attachment", "إضافة مرفق") : t("Upload file", "رفع ملف")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          {/* `UC-33.1-04`: with no file chosen there is nothing to upload. */}
          <Btn
            label={owner ? t("Attach", "إرفاق") : t("Upload", "رفع")}
            disabled={pending || (source === "Local" ? !file || (!owner && projectKey === "") : !picked)}
            onClick={upload}
          />
        </>
      }
    >
      {owner && (
        <Seg
          items={[
            { id: "Local", label: t("This computer", "هذا الجهاز"), icon: "Download04" },
            { id: "File", label: t("Files", "الملفات"), icon: "File01" },
            { id: "Artifact", label: t("Artifacts", "المخرجات"), icon: "File01" },
          ]}
          value={source}
          onChange={(id) => {
            setSource(id as "Local" | "File" | "Artifact");
            setPicked(null);
            setError(null);
          }}
        />
      )}
      {source !== "Local" ? (
        <HeldPicker key={source} kind={source} picked={picked ? [picked] : []} onPick={(item) => setPicked(item.id)} />
      ) : (
        <Field
          label={t("File", "الملف")}
          hint={t(
            `Up to ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB. ${ALLOWED_UPLOAD_TYPES.size} file types are accepted.`,
            `حتى ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} ميغابايت. ${ALLOWED_UPLOAD_TYPES.size} نوع ملف مقبول.`,
          )}
        >
          <input type="file" className="awp-input" onChange={(event) => void choose(event.target.files?.[0])} />
        </Field>
      )}
      {owner ? (
        <p className="awp-small awp-muted" style={{ margin: 0 }}>
          {t(`Attached to ${owner.key}. Whoever may see it may read this file.`, `مرفق بـ ${owner.key}. من يمكنه رؤيته يمكنه قراءة الملف.`)}
        </p>
      ) : (
        <Field label={t("Project", "المشروع")}>
          <PopSelect className="awp-input" value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
            {projects.map((project) => (
              <option key={project.k} value={project.k}>
                {project.k} — {t(project.n, project.nAr)}
              </option>
            ))}
          </PopSelect>
        </Field>
      )}
      {!owner && <ScopeOfUseFields scope={scope} grants={grants} onScope={setScope} onGrants={setGrants} />}
      {error && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
