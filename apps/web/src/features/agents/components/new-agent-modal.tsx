"use client";

import { useCallback, useState, useTransition } from "react";

import { CodeField } from "@/components/shared/forms";
import { createAgent } from "@/features/agents/actions";
import { ASSIGNABLE_AGENT_TRUSTS } from "@/features/agents/schema";
import { EXECUTION_PROFILES } from "@/db/schema/enums";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";

/**
 * `UC-50.2-01`: create an agent.
 *
 * It opens on Instructions because that is the one thing a new agent has none of, and the
 * version it is created with is unpublished — a draft, which `UC-51.4` publishes.
 *
 * `UC-50.2-04`: `System` is not among the trusts offered. That level carries the setup
 * tools, and an agent able to award itself one could propose changes to the platform.
 */
export function NewAgentModal({
  units,
  routes,
  onClose,
  onCreated,
}: {
  units: { id: string; nameEn: string; nameAr: string }[];
  routes: string[];
  onClose: () => void;
  onCreated: (code: string) => void;
}) {
  const { t, why } = useAwp();
  const { say } = useToast();
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [unitId, setUnitId] = useState('');
  const [profile, setProfile] = useState<string>(EXECUTION_PROFILES[1]);
  const [trust, setTrust] = useState<string>('Standard');
  const [route, setRoute] = useState(routes[0] ?? '');
  const [code, setCode] = useState('');
  const onCode = useCallback((next: string) => setCode(next), []);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await createAgent({
        code,
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        orgUnitId: unitId || null,
        profile,
        trust,
        routeAlias: route,
      });
      // `UC-50.2-02`: a duplicate code comes back as a message on the form.
      if (result.ok) {
        say(t(`${result.code} was created.`, `أُنشئ ${result.code}.`));
        onCreated(result.code);
      } else setProblem(why(result));
    });

  const ready = nameEn.trim() && nameAr.trim() && code.trim() && route;

  return (
    <Modal
      title={t('New Agent', 'وكيل جديد')}
      onClose={onClose}
      dirty={Boolean(nameEn || nameAr)}
      footer={
        <>
          <Btn type="secondary" label={t('Cancel', 'إلغاء')} onClick={onClose} />
          <Btn label={t('Create agent', 'إنشاء وكيل')} disabled={!ready || pending} onClick={submit} />
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label={t('Name (English)', 'الاسم (إنجليزي)')}>
          <input className="awp-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={t('Name (Arabic)', 'الاسم (عربي)')}>
          <input className="awp-input" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('Org unit', 'الوحدة التنظيمية')}>
          <PopSelect className="awp-input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{t('None', 'بدون')}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{t(u.nameEn, u.nameAr)}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t('Execution profile', 'نمط التنفيذ')}>
          <PopSelect className="awp-input" value={profile} onChange={(e) => setProfile(e.target.value)}>
            {EXECUTION_PROFILES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t('Agent trust', 'ثقة الوكيل')}>
          <PopSelect className="awp-input" value={trust} onChange={(e) => setTrust(e.target.value)}>
            {ASSIGNABLE_AGENT_TRUSTS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t('Model route', 'مسار النموذج')}>
          <PopSelect className="awp-input" value={route} onChange={(e) => setRoute(e.target.value)}>
            {routes.map((alias) => (
              <option key={alias} value={alias}>{alias}</option>
            ))}
          </PopSelect>
        </Field>
        <CodeField from={nameEn} onChange={onCode} />
        {problem && <p role="alert" style={{ margin: 0, color: 'var(--feedback-danger-text)' }}>{problem}</p>}
      </div>
    </Modal>
  );
}
