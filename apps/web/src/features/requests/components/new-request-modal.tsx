"use client";

import { useEffect, useState, useTransition } from "react";

import { useAgents, useProjects } from "@/components/shared/directory";
import type { ModalProps } from "@/components/shared/modal-host";
import { AgentAv } from "@/components/ui/avatar";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Seg } from "@/components/ui/tabs";
import { attachFile, attachHeld } from "@/features/files/actions";
import { HeldPicker } from "@/features/files/components/held-picker";
import { createRequest } from "@/features/requests/actions";
import { attributeProblem } from "@/features/requests/attributes";
import {
  agenticEntryAvailable,
  classifyRequest,
  extractAttachment,
  type Proposal,
} from "@/features/requests/classification";
import { loadPublishedTypes, type PublishedType } from "@/features/requests/directory";
import { orThrow } from "@/lib/outcome";
import { useAwp } from "@/hooks/use-awp";
import { useGo } from "@/lib/routes";
import { uploadRefusal } from "@/lib/uploads";
import { AttributeFields } from "./attribute-input";

/**
 * S-28: raising a request, by filling the type's form or by saying what is needed.
 *
 * The two entry modes are the same act: a request of a published type with that type's
 * attributes. The agentic mode proposes those values rather than asking for them one field
 * at a time, and nothing is submitted until the person agrees to the proposal.
 */

export function NewRequestModal({ onClose, owner, prefill }: ModalProps) {
  // Opened on a request, it raises a sub request of it.
  const parentKey = owner?.type === "Request" ? owner.key : undefined;
  // Opened on a room message, the request keeps that room as its origin.
  const originRoomKey = owner?.type === "Room" ? owner.key : undefined;
  const { t, why } = useAwp();
  const projects = useProjects();
  const agents = useAgents();
  const go = useGo();

  const [types, setTypes] = useState<PublishedType[]>([]);
  const [agenticAvailable, setAgenticAvailable] = useState(false);
  const [mode, setMode] = useState("form");
  const [typeCode, setTypeCode] = useState("");
  const [projectKey, setProjectKey] = useState(prefill?.projectKey ?? projects[0]?.k ?? "");
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [attachments, setAttachments] = useState<{ name: string; dataUrl: string }[]>([]);
  /** What each attachment turned out to say, which the classifier reads with the words. */
  const [read, setRead] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  // `UC-28.1-04`: files and artifacts the platform already holds, attached by id once the
  // request exists, as the uploads are.
  const [held, setHeld] = useState<{ kind: "File" | "Artifact"; id: string; name: string }[]>([]);
  const [heldSource, setHeldSource] = useState<"Local" | "File" | "Artifact">("Local");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** The agentic conversation: what was said, and what the assistant is proposing. */
  const [said, setSaid] = useState<[who: "u" | "a", text: string][]>([]);
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  /** Why the conversation handed over to the form, shown on the form. */
  const [fallback, setFallback] = useState<string | null>(null);

  useEffect(() => {
    void loadPublishedTypes().then((published) => {
      setTypes(published);
      setTypeCode((current) => current || published[0]?.code || "");
    });
    void agenticEntryAvailable().then(setAgenticAvailable);
  }, []);

  const selected = types.find((type) => type.code === typeCode);
  // `UC-28.1-05`: a type that allows only the agentic mode cannot be filled in as a form,
  // unless the agentic mode is not offered at all (D310).
  const formAllowed = selected === undefined || selected.entryModes.includes("TemplateForm") || !agenticAvailable;
  const agenticAllowed = agenticAvailable && (selected === undefined || selected.entryModes.includes("AgenticInteractive"));
  const effectiveMode = formAllowed ? mode : "agent";

  // `UC-28.1-03`: the rule the server applies, so the form refuses what the server would.
  const problemOf = (attribute: PublishedType["attributes"][number]) => {
    const problem = attributeProblem(attribute, values[attribute.key]);
    return problem ? t(problem.en, problem.ar) : null;
  };
  const problems = (selected?.attributes ?? [])
    .map((attribute) => [attribute.key, problemOf(attribute)] as const)
    .filter((entry): entry is [string, string] => entry[1] !== null);

  const submit = (attributes: Record<string, string>, entryMode: "Form" | "Agentic") =>
    start(async () => {
      setError(null);
      try {
        const key = orThrow(await createRequest({
          projectKey,
          requestTypeCode: typeCode,
          titleEn: title,
          titleAr: title,
          entryMode,
          attributes,
          ...(parentKey ? { parentKey } : {}),
          ...(originRoomKey ? { originRoomKey } : {}),
          ...(prefill?.description ? { descriptionEn: prefill.description } : {}),
        }));
        // `UC-28.1-04`: attached once the request exists for it to belong to — the earlier
        // upload only ever held the bytes in the browser, waiting for this key.
        for (const attachment of attachments) {
          orThrow(await attachFile({ ownerType: "Request", ownerKey: key, name: attachment.name, dataUrl: attachment.dataUrl }));
        }
        for (const item of held) {
          orThrow(await attachHeld({ ownerType: "Request", ownerKey: key, kind: item.kind, id: item.id }));
        }
        onClose();
        // A sub request is listed on its parent, which is where the person goes back to.
        go("requests", { open: parentKey ?? key });
      } catch (problem) {
        setError(why(problem));
      }
    });

  /**
   * `UC-28.1-04`: an attachment the platform may not store is refused with a reason.
   *
   * `UC-28.2-08`: one it may store is read, and what it says joins the conversation, so the
   * next proposal is filled from the receipt rather than from the sentence beside it.
   */
  const attach = (chosen: File | undefined) =>
    start(async () => {
      setAttachmentError(null);
      if (!chosen) return;
      const refusal = uploadRefusal({ name: chosen.name, mimeType: chosen.type, size: chosen.size });
      if (refusal) {
        setAttachmentError(t(refusal.en, refusal.ar));
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The file could not be read."));
        reader.readAsDataURL(chosen);
      });
      // `UC-28.1-04`: kept so a form-mode submit can attach it to the request it creates —
      // the only record of this upload until then, since nothing is stored until that request
      // exists for it to belong to.
      setAttachments((current) => [...current, { name: chosen.name, dataUrl }]);

      const read = await extractAttachment(chosen.name, dataUrl);
      if (!read.ok) {
        setAttachmentError(t(read.reason, read.reasonAr));
        return;
      }
      setRead((current) => [...current, `${chosen.name}: ${read.text}`]);
      setSaid((current) => [...current, ["a", t(`I have read ${chosen.name}.`, `قرأت ${chosen.name}.`)]]);
    });

  /**
   * `UC-28.2-01` and `-03`: say something, and get a proposal back to confirm or correct.
   *
   * Takes an explicit `override` so a quick-reply chip can speak a ready-made sentence without
   * first routing it through the `message` field it would otherwise have to fill and clear.
   */
  const send = (override?: string) =>
    start(async () => {
      const spoken = (override ?? message).trim();
      if (spoken === "") return;
      setSaid((current) => [...current, ["u", spoken]]);
      setMessage("");
      // Everything said so far is sent, so a correction reads as a correction rather than a
      // new request in its own right.
      // What the attachments said goes in with what was typed, which is what lets the
      // proposal carry an amount and a date nobody wrote out.
      const outcome = await classifyRequest([...read, ...said.map(([, text]) => text), spoken].join("\n"));
      if (!outcome.ok) {
        // `UC-28.2-06`: the form takes over, carrying whatever was understood so far, and says why.
        setSaid((current) => [...current, ["a", t(outcome.reason, outcome.reasonAr)]]);
        setFallback(t(outcome.reason, outcome.reasonAr));
        setMode("form");
        return;
      }
      setProposal(outcome.proposal);
      setTypeCode(outcome.proposal.typeCode || typeCode);
      setTitle(outcome.proposal.title || title);
      setValues((current) => ({ ...current, ...outcome.proposal.attributes }));
      const named = types.find((type) => type.code === outcome.proposal.typeCode);
      setSaid((current) => [
        ...current,
        [
          "a",
          outcome.proposal.question ||
            (named
              ? t(
                  `This looks like a ${named.nameEn}. Shall I submit it to ${projectKey}?`,
                  `يبدو هذا ${named.nameAr}. هل أقدمه إلى ${projectKey}؟`,
                )
              : t("Which type is this?", "ما نوع هذا الطلب؟")),
        ],
      ]);
    });

  // `UC-28.2-05`: nothing is submitted until the proposal is complete and names a type.
  const proposalReady = proposal !== null && proposal.typeCode !== "" && proposal.missing.length === 0;

  // `UC-25.1-03`: from this computer, or from the files and artifacts the person may read.
  const attachmentSources = (
    <div className="awp-col" style={{ gap: 8 }}>
      <Seg
        items={[
          { id: "Local", label: t("This computer", "هذا الجهاز"), icon: "Download04" },
          { id: "File", label: t("Files", "الملفات"), icon: "File01" },
          { id: "Artifact", label: t("Artifacts", "المخرجات"), icon: "File01" },
        ]}
        value={heldSource}
        onChange={(id) => setHeldSource(id as "Local" | "File" | "Artifact")}
      />
      {heldSource === "Local" ? (
        <input type="file" className="awp-input" onChange={(event) => attach(event.target.files?.[0])} />
      ) : (
        <HeldPicker
          key={heldSource}
          kind={heldSource}
          picked={held.map((one) => one.id)}
          onPick={(item) =>
            setHeld((chosen) =>
              chosen.some((one) => one.id === item.id) ? chosen.filter((one) => one.id !== item.id) : [...chosen, { kind: item.kind, id: item.id, name: item.name }],
            )
          }
        />
      )}
    </div>
  );

  return (
    <Modal
      w={640}
      title={parentKey ? t(`New sub request of ${parentKey}`, `طلب فرعي جديد لـ ${parentKey}`) : t("New Request", "طلب جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          {effectiveMode === "form" ? (
            <Btn
              label={t("Submit request", "تقديم الطلب")}
              disabled={pending || title.trim() === "" || typeCode === "" || problems.length > 0}
              onClick={() => submit(values, "Form")}
            />
          ) : (
            <Btn
              label={t("Submit request", "تقديم الطلب")}
              disabled={pending || !proposalReady}
              onClick={() => submit(values, "Agentic")}
            />
          )}
        </>
      }
    >
      {agenticAllowed && (
        <Field group label={t("Entry mode", "طريقة الإدخال")}>
          <Seg
            value={effectiveMode}
            onChange={setMode}
            items={[
              { id: "form", label: t("Template form", "نموذج القالب"), disabled: !formAllowed },
              { id: "agent", label: t("Agentic interactive", "تفاعلي بالوكيل") },
            ]}
          />
        </Field>
      )}
      {!formAllowed && (
        <p className="awp-small awp-muted" style={{ margin: 0 }} role="status">
          {t("This type is only raised by describing it.", "يُقدَّم هذا النوع بالوصف فقط.")}
        </p>
      )}
      <Field label={t("Project", "المشروع")}>
        <PopSelect className="awp-input" value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
          {projects.map((project) => (
            <option key={project.k} value={project.k}>
              {project.k} — {t(project.n, project.nAr)}
            </option>
          ))}
        </PopSelect>
      </Field>

      {effectiveMode === "form" ? (
        <>
          {fallback && (
            <p className="awp-small awp-muted" style={{ margin: 0 }} role="status">
              {fallback}
            </p>
          )}
          <Field label={t("Request type", "نوع الطلب")}>
            {/* `UC-28.1-02`: changing the type changes the fields, and clears what was typed. */}
            <PopSelect
              className="awp-input"
              value={typeCode}
              onChange={(event) => {
                setTypeCode(event.target.value);
                setValues({});
                setTouched(false);
              }}
            >
              {types.map((type) => (
                <option key={type.code} value={type.code}>
                  {t(type.nameEn, type.nameAr)}
                </option>
              ))}
            </PopSelect>
          </Field>
          <Field label={t("Title", "العنوان")}>
            <input className="awp-input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <AttributeFields
            attributes={selected?.attributes ?? []}
            valueOf={(key) => values[key] ?? ""}
            onChange={(key, value) => {
              setTouched(true);
              setValues({ ...values, [key]: value });
            }}
            problemOf={(attribute) => (touched ? problemOf(attribute) : null)}
          />
          <Field label={t("Attachments", "المرفقات")}>
            {attachmentSources}
            {[...attachments.map((a) => a.name), ...held.map((item) => item.name)].length > 0 && (
              <p className="awp-small awp-muted" style={{ margin: "6px 0 0" }}>
                {[...attachments.map((a) => a.name), ...held.map((item) => item.name)].join(", ")}
              </p>
            )}
            {attachmentError && (
              <p className="awp-small" style={{ margin: "4px 0 0", color: "var(--text-danger)" }} role="alert">
                {attachmentError}
              </p>
            )}
          </Field>
        </>
      ) : (
        <div className="awp-card" style={{ background: "var(--surface-card)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {said.length === 0 && (
            <>
              <div className="awp-row" style={{ alignItems: "flex-start", gap: 10 }}>
                {agents[0] && <AgentAv a={agents[0]} s={28} />}
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "8px 12px",
                    borderRadius: 12,
                    background: "var(--surface-raised)",
                    color: "var(--text-primary)",
                  }}
                >
                  {t(
                    "Tell me what you need. I will pick the request type and fill the details with you.",
                    "أخبرني بما تحتاجه. سأختار نوع الطلب وأعبئ التفاصيل معك.",
                  )}
                </div>
              </div>
              {/* A choice as fast as typing it: the same classification `send()` already
                  does, started from a ready sentence instead of a blank box. */}
              <div className="awp-row" style={{ gap: 8, flexWrap: "wrap", paddingInlineStart: 38 }}>
                {types
                  .filter((type) => type.entryModes.includes("AgenticInteractive"))
                  .slice(0, 6)
                  .map((type) => (
                    <button
                      key={type.code}
                      className="awp-chip"
                      disabled={pending}
                      onClick={() => send(t(`I need to raise a ${type.nameEn}.`, `أحتاج إلى تقديم ${type.nameAr}.`))}
                    >
                      {t(type.nameEn, type.nameAr)}
                    </button>
                  ))}
              </div>
            </>
          )}
          {said.map(([who, text], index) => (
            <div key={index} className="awp-row" style={{ alignItems: "flex-start", gap: 10, justifyContent: who === "u" ? "flex-end" : "flex-start" }}>
              {who === "a" && agents[0] && <AgentAv a={agents[0]} s={28} />}
              <div
                style={{
                  maxWidth: "80%",
                  padding: "8px 12px",
                  borderRadius: 12,
                  background: who === "u" ? "var(--action-primary-bg)" : "var(--surface-raised)",
                  color: who === "u" ? "var(--text-on-action)" : "var(--text-primary)",
                }}
              >
                {text}
              </div>
            </div>
          ))}
          {/* `UC-28.2-04`: it would not choose, so the person does. */}
          {proposal && proposal.typeCode === "" && proposal.candidates.length > 0 && (
            <div className="awp-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {proposal.candidates.map((code) => (
                <button
                  key={code}
                  className={"awp-chip" + (typeCode === code ? " on" : "")}
                  onClick={() => {
                    setTypeCode(code);
                    setProposal({ ...proposal, typeCode: code });
                  }}
                >
                  {t(types.find((type) => type.code === code)?.nameEn ?? code, types.find((type) => type.code === code)?.nameAr ?? code)}
                </button>
              ))}
            </div>
          )}
          {proposal && proposal.missing.length > 0 && (
            <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="status">
              {t(`Still needed: ${proposal.missing.join(", ")}`, `ما زال مطلوباً: ${proposal.missing.join("، ")}`)}
            </p>
          )}
          <div className="awp-row" style={{ gap: 8 }}>
            <input
              className="awp-input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && send()}
              placeholder={t("e.g. Reimburse my taxi fares from 3 Oct, AED 186", "مثال: تعويض أجرة التاكسي من 3 أكتوبر بقيمة 186 د.إ")}
              aria-label={t("Message", "الرسالة")}
            />
            <Btn label={t("Send", "إرسال")} disabled={pending || message.trim() === ""} onClick={() => send()} />
          </div>
          {/* `UC-28.2-08`: a receipt is read the same way as the words. */}
          <Field label={t("Attachments", "المرفقات")}>
            {attachmentSources}
            {held.length > 0 && (
              <p className="awp-small awp-muted" style={{ margin: "6px 0 0" }}>{held.map((item) => item.name).join(", ")}</p>
            )}
            {attachmentError && (
              <p className="awp-small" style={{ margin: "4px 0 0", color: "var(--text-danger)" }} role="alert">
                {attachmentError}
              </p>
            )}
          </Field>
        </div>
      )}
      {error && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
