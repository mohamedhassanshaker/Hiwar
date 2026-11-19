"use client";

import { useState, useTransition } from "react";

import { useAgents } from "@/components/shared/directory";
import type { ModalProps } from "@/components/shared/modal-host";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { createSkill, importSkill, updateSkillPackage, validateSkillPackage } from "@/features/skills/actions";
import type { PackageReview } from "@/lib/skill-package";
import { orThrow } from "@/lib/outcome";
import { useAwp } from "@/hooks/use-awp";
import { useGo } from "@/lib/routes";
import { CodeField } from "@/components/shared/forms";

/**
 * Specification 7.4.4: a skill the user writes, rather than one imported from a package.
 *
 * The description is required because it is what an agent reads to decide whether to load
 * the skill; the server says so too, and this says it before the round trip.
 */
export function NewSkillModal({ onClose }: ModalProps) {
  const { t, why } = useAwp();
  const go = useGo();
  const [n, setN] = useState("");
  const [about, setAbout] = useState("");
  const [skillName, setSkillName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = n.trim() !== "" && about.trim() !== "" && skillName.trim() !== "";

  const create = () =>
    start(async () => {
      setError(null);
      try {
        orThrow(
          await createSkill({
            skillName,
            titleEn: n.trim(),
            titleAr: n.trim(),
            descriptionEn: about.trim(),
            descriptionAr: about.trim(),
            sourceType: "Authored",
            versionLabel: "v1",
            tags: [],
          }),
        );
        onClose();
        go("skills");
      } catch (problem) {
        setError(why(problem));
      }
    });

  return (
    <Modal
      title={t("New skill", "مهارة جديدة")}
      onClose={onClose}
      dirty={n !== "" || about !== ""}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={t("Create skill", "إنشاء المهارة")} disabled={pending || !ready} onClick={create} />
        </>
      }
    >
      {error && (
        <p style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {error}
        </p>
      )}
      <Field label={t("Title", "العنوان")}>
        <input className="awp-input" value={n} onChange={(e) => setN(e.target.value)} placeholder={t("e.g. Vendor risk check", "مثال: فحص مخاطر المورد")} />
      </Field>
      <Field label={t("Description", "الوصف")} hint={t("Agents read this to decide when to load the skill.", "يقرأ الوكلاء هذا لتحديد متى تُحمّل المهارة.")}>
        <textarea
          className="awp-input"
          style={{ height: 80, padding: 12 }}
          value={about}
          aria-label={t("Description", "الوصف")}
          onChange={(e) => setAbout(e.target.value)}
        />
      </Field>
      <CodeField label={t("Skill name (SKILL.md)", "اسم المهارة (SKILL.md)")} from={n} onChange={setSkillName} />
    </Modal>
  );
}

/**
 * The two-step skill import. Step one takes a .zip or a Git URL (the URL wins when both are
 * given) and calls `validateSkillPackage`; step two shows the review (name, files, declared
 * tools, frontmatter and scan results, warnings, blockers) and, unless a blocker is found,
 * imports through `importSkill`, optionally enabling it for one agent.
 *
 * Opened with `name`, it updates that installed skill instead (`updateSkillPackage`): the
 * package becomes the skill's next version, and the agents using it move to it unless unticked.
 */
export function ImportSkillModal({ onClose, name: updating }: ModalProps) {
  const { t, nm, why } = useAwp();
  const agents = useAgents();
  const [step, setStep] = useState(0);
  const [zipBase64, setZipBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [review, setReview] = useState<PackageReview | null>(null);
  const [agentCode, setAgentCode] = useState("");
  const [moveAgents, setMoveAgents] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const source = () => (gitUrl.trim() ? { gitUrl: gitUrl.trim() } : { zipBase64: zipBase64 ?? undefined });

  const validate = () =>
    start(async () => {
      setProblem(null);
      const result = await validateSkillPackage(source());
      if (result.ok) {
        setReview(result.review);
        setStep(1);
      } else {
        setProblem(why(result));
      }
    });

  const confirm = () =>
    start(async () => {
      setProblem(null);
      const result = updating
        ? await updateSkillPackage({ ...source(), skillName: updating, moveAgents })
        : await importSkill({ ...source(), agentCodes: agentCode ? [agentCode] : [] });
      if (result.ok) onClose();
      else setProblem([why(result), ...(result.reasons ?? [])].join(" "));
    });

  const readable = Boolean(zipBase64 || gitUrl.trim());
  const blocked = (review?.blockers.length ?? 0) > 0;

  return (
    <Modal
      title={updating ? t(`Update ${updating} from a package`, `تحديث ${updating} من حزمة`) : t("Import skill package", "استيراد حزمة مهارة")}
      onClose={onClose}
      w={620}
      footer={
        step === 0 ? (
          <>
            <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
            <Btn
              label={t("Validate package", "التحقق من الحزمة")}
              disabled={!readable || pending}
              onClick={validate}
            />
          </>
        ) : (
          <>
            {/* `UC-53.2-08`: nothing was stored by the review, so this goes back clean. */}
            <Btn type="secondary" label={t("Back", "رجوع")} onClick={() => setStep(0)} />
            <Btn
              label={updating ? t("Update skill", "تحديث المهارة") : t("Import skill", "استيراد المهارة")}
              disabled={blocked || pending}
              onClick={confirm}
            />
          </>
        )
      }
    >
      {step === 0 ? (
        <>
          <p style={{ margin: 0 }}>
            {t(
              "Upload a standard Agent Skills package: a .zip with SKILL.md at its root, plus optional references/ and scripts/.",
              "ارفع حزمة Agent Skills قياسية تحتوي SKILL.md في الجذر.",
            )}
          </p>
          {updating && (
            <p className="awp-small awp-muted" style={{ margin: 0 }}>
              {t(
                `Its files replace ${updating}'s as a new version. The current version stays for any agent version still pinned to it.`,
                `تحل ملفاتها محل ملفات ${updating} كإصدار جديد. يبقى الإصدار الحالي لأي إصدار وكيل لا يزال مثبتاً عليه.`,
              )}
            </p>
          )}
          <label className="awp-row" style={{ gap: 10 }}>
            <span className="awp-chip" style={{ cursor: "pointer" }}>
              {fileName || t("Choose a .zip", "اختر ملف .zip")}
            </span>
            <input
              type="file"
              accept=".zip,application/zip"
              style={{ display: "none" }}
              aria-label={t("Skill package", "حزمة المهارة")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                const reader = new FileReader();
                reader.onload = () => setZipBase64(String(reader.result));
                reader.readAsDataURL(file);
              }}
            />
          </label>
          <Field label={t("Or import from Git URL", "أو استيراد من رابط Git")}>
            <input
              className="awp-input"
              value={gitUrl}
              placeholder="https://git.example.com/skills/order-status.zip"
              onChange={(event) => setGitUrl(event.target.value)}
            />
          </Field>
          {problem && <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{problem}</p>}
        </>
      ) : (
        review && (
          <>
            <div className="awp-card" style={{ padding: 14, background: "var(--surface-card)" }}>
              <dl className="awp-kv" style={{ margin: 0 }}>
                <dt>name</dt>
                <dd className="awp-mono">{review.name || "-"}</dd>
                <dt>{t("Files", "الملفات")}</dt>
                <dd className="awp-mono">{review.files.length}</dd>
                <dt>allowed-tools</dt>
                <dd className="awp-mono">{review.declaredTools.join(", ") || "-"}</dd>
              </dl>
            </div>
            <div className="awp-row" style={{ gap: 10 }}>
              <Ic
                n={review.frontmatterValid ? "TickCircle" : "WarningSign"}
                s={18}
                c={review.frontmatterValid ? "var(--icon-success)" : "var(--icon-warning)"}
              />
              {t("SKILL.md frontmatter valid", "ترويسة SKILL.md صالحة")}
            </div>
            <div className="awp-row" style={{ gap: 10 }}>
              <Ic
                n={review.scan.embeddedSecrets === 0 ? "TickCircle" : "WarningSign"}
                s={18}
                c={review.scan.embeddedSecrets === 0 ? "var(--icon-success)" : "var(--icon-danger)"}
              />
              {t("No embedded secrets", "لا أسرار مضمنة")}
            </div>
            <div className="awp-row" style={{ gap: 10 }}>
              <Ic
                n={review.scan.promptInjectionPatterns === 0 ? "TickCircle" : "WarningSign"}
                s={18}
                c={review.scan.promptInjectionPatterns === 0 ? "var(--icon-success)" : "var(--icon-danger)"}
              />
              {t("No prompt-injection patterns", "لا أنماط حقن أوامر")}
            </div>
            {review.warnings.map((warning) => (
              <div key={warning} className="awp-row" style={{ gap: 10 }}>
                <Ic n="WarningSign" s={18} c="var(--icon-warning)" />
                {warning}
              </div>
            ))}
            {review.blockers.map((reason) => (
              <p key={reason} role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>
                {reason}
              </p>
            ))}
            {updating ? (
              <label className="awp-row" style={{ gap: 10 }}>
                <input type="checkbox" checked={moveAgents} onChange={(event) => setMoveAgents(event.target.checked)} />
                {t(
                  "Move the agents using it to the new version (their active version and open draft)",
                  "انقل الوكلاء الذين يستخدمونها إلى الإصدار الجديد (إصدارهم النشط ومسودتهم المفتوحة)",
                )}
              </label>
            ) : (
              <Field label={t("Enable for agents", "تفعيل للوكلاء")}>
                <PopSelect
                  className="awp-input"
                  value={agentCode}
                  onChange={(event) => setAgentCode(event.target.value)}
                >
                  <option value="">{t("None yet", "لا أحد حالياً")}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{nm(agent)}</option>
                  ))}
                </PopSelect>
              </Field>
            )}
            {problem && <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{problem}</p>}
          </>
        )
      )}
    </Modal>
  );
}
