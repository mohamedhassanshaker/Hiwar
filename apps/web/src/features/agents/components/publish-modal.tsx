"use client";

import { useState, useTransition } from "react";

import { publishVersion } from "@/features/agents/actions";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";

/**
 * `UC-51.3-02`: publish the draft as a new version.
 *
 * `UC-51.3-03` requires release notes, and the form says so before the server does: the
 * version list is what someone reads when a run misbehaves, and a row with no note
 * explains nothing. `UC-51.3-04` is the evaluation gate, which only the server can judge.
 */
export function PublishModal({ code, onClose }: { code: string; onClose: () => void }) {
  const { t, why } = useAwp();
  const { say } = useToast();
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await publishVersion({ code, releaseNotes: notes });
      if (result.ok) {
        say(t(`${code} was published.`, `نُشر ${code}.`));
        onClose();
      } else setProblem(why(result));
    });

  return (
    <Modal
      title={t('Publish new version', 'نشر إصدار جديد')}
      onClose={onClose}
      dirty={Boolean(notes)}
      footer={
        <>
          <Btn type="secondary" label={t('Cancel', 'إلغاء')} onClick={onClose} />
          <Btn label={t('Publish', 'نشر')} disabled={!notes.trim() || pending} onClick={submit} />
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <Field
          label={t('Release notes', 'ملاحظات الإصدار')}
          hint={t('What changed, and why. This is what someone reads when a run surprises them.', 'ما الذي تغيّر ولماذا. هذا ما يقرأه من يفاجئه سلوك عملية.')}
        >
          <textarea className="awp-input" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {problem && <p role="alert" style={{ margin: 0, color: 'var(--feedback-danger-text)' }}>{problem}</p>}
      </div>
    </Modal>
  );
}
