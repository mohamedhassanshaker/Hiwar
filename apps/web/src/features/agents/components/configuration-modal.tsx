"use client";

import { useState, useTransition } from "react";

import { saveDraft, setRunBudget, setTrust } from "@/features/agents/actions";
import { BUILTIN_AGENT_CODE } from "@/features/agents/builtin";
import { ASSIGNABLE_AGENT_TRUSTS } from "@/features/agents/schema";
import { EXECUTION_PROFILES } from "@/db/schema/enums";
import { type AgentDetail } from "@/features/agents/types";
import { Btn, Toggle } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { orThrow } from "@/lib/outcome";

/**
 * `UC-51.1-03`: change what the agent runs with.
 *
 * Saved onto the draft like every other edit, so the version in flight keeps the routes it
 * started with. `UC-51.1-06` is the memory switch, which belongs to the same card: it
 * decides whether the agent's next runs carry the memory tools at all, and leaves whatever
 * it has already remembered alone.
 */
export function ConfigurationModal({
  code,
  detail,
  routes,
  onClose,
}: {
  code: string;
  detail: AgentDetail;
  routes: string[];
  onClose: () => void;
}) {
  // D65: the Assistant's trust is the system agent's and `setTrust` refuses to change it,
  // so the field is not offered rather than offered and always refused.
  const trustFixed = code === BUILTIN_AGENT_CODE;
  const { t, why } = useAwp();
  const { say } = useToast();
  const [profile, setProfile] = useState(detail.profile);
  const [primary, setPrimary] = useState('');
  const [fallback, setFallback] = useState('');
  const [memory, setMemory] = useState(detail.memoryEnabled);
  const [trust, setTrustChoice] = useState(detail.trust);
  const [soft, setSoft] = useState(detail.budgetSoft);
  const [hard, setHard] = useState(detail.budgetHard);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /**
   * `UC-51.1-04` and `UC-51.1-05`: trust and the run budget are the active version's, not a
   * draft revision's, so they are written beside the draft rather than inside it. They go
   * first, against the lock this dialog opened with, each passing on the lock the last one
   * left; the draft takes no lock, and on an unpublished agent it is the active version.
   */
  const submit = () =>
    start(async () => {
      setProblem(null);
      try {
        let lock = detail.versionLock;
        if (!trustFixed && trust !== detail.trust) {
          lock = orThrow(await setTrust({ code, trust, version: lock }));
        }
        if (soft !== detail.budgetSoft || hard !== detail.budgetHard) {
          orThrow(await setRunBudget({ code, soft, hard, version: lock }));
        }
        const result = await saveDraft({
          code,
          executionProfile: profile,
          ...(primary ? { primaryRouteAlias: primary } : {}),
          ...(fallback ? { fallbackRouteAlias: fallback === '__none__' ? null : fallback } : {}),
          memoryEnabled: memory,
        });
        if (!result.ok) {
          setProblem(why(result));
          return;
        }
        say(t(`${code} was saved.`, `حُفظ ${code}.`));
        onClose();
      } catch (refusal) {
        setProblem(refusal instanceof Error ? refusal.message : String(refusal));
      }
    });

  return (
    <Modal
      title={t('Configuration', 'الإعدادات')}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t('Cancel', 'إلغاء')} onClick={onClose} />
          <Btn label={t('Save', 'حفظ')} disabled={pending} onClick={submit} />
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label={t('Execution profile', 'نمط التنفيذ')}>
          <PopSelect className="awp-input" value={profile} onChange={(e) => setProfile(e.target.value)}>
            {EXECUTION_PROFILES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t('Primary model route', 'مسار النموذج الأساسي')} hint={detail.model}>
          <PopSelect className="awp-input" value={primary} onChange={(e) => setPrimary(e.target.value)}>
            <option value="">{t('Unchanged', 'دون تغيير')}</option>
            {routes.map((alias) => (
              <option key={alias} value={alias}>{alias}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t('Fallback route', 'مسار الاحتياط')} hint={detail.fallbackModel ?? undefined}>
          <PopSelect className="awp-input" value={fallback} onChange={(e) => setFallback(e.target.value)}>
            <option value="">{t('Unchanged', 'دون تغيير')}</option>
            <option value="__none__">{t('None', 'بدون')}</option>
            {routes.map((alias) => (
              <option key={alias} value={alias}>{alias}</option>
            ))}
          </PopSelect>
        </Field>
        {/* `UC-50.2-04`: System is not offered; it is the platform's own level, not an agent's. */}
        {!trustFixed && (
          <Field label={t('Agent trust', 'ثقة الوكيل')}>
            <PopSelect className="awp-input" value={trust} onChange={(e) => setTrustChoice(e.target.value)}>
              {ASSIGNABLE_AGENT_TRUSTS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </PopSelect>
          </Field>
        )}
        <Field
          label={t('Run budget (AED)', 'ميزانية العملية (د.إ)')}
          hint={t('Soft warns, hard stops. A soft limit above the hard one is refused.', 'المرن ينبّه والصارم يوقف. يُرفض حد مرن أعلى من الصارم.')}
        >
          <div className="awp-row" style={{ gap: 8 }}>
            <input
              className="awp-input"
              type="number"
              min={0}
              step="0.01"
              value={soft ?? ''}
              aria-label={t('Soft limit', 'الحد المرن')}
              onChange={(e) => setSoft(e.target.value === '' ? null : Number(e.target.value))}
            />
            <input
              className="awp-input"
              type="number"
              min={0}
              step="0.01"
              value={hard ?? ''}
              aria-label={t('Hard limit', 'الحد الصارم')}
              onChange={(e) => setHard(e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
        </Field>
        <div className="awp-row" style={{ justifyContent: 'space-between' }}>
          <span>{t('Agent memory', 'ذاكرة الوكيل')}</span>
          <Toggle on={memory} onChange={setMemory} />
        </div>
        <p className="awp-small awp-muted" style={{ margin: 0 }}>
          {t('Saved as a draft revision. Existing memory is kept either way.', 'يُحفظ كمسودة. تبقى الذاكرة الحالية في الحالتين.')}
        </p>
        {problem && <p role="alert" style={{ margin: 0, color: 'var(--feedback-danger-text)' }}>{problem}</p>}
      </div>
    </Modal>
  );
}
