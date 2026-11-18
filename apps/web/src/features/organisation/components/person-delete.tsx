"use client";

import { useState, useTransition } from "react";

import type { PersonRow } from "@/features/organisation/types";
import { Btn } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { deletePerson } from "@/features/organisation/actions";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";

/**
 * D381: Delete, for an invited or suspended person, behind a confirmation. The server refuses a
 * person a record still refers to, and the refusal is shown here.
 */
export function PersonDelete({ person, onDeleted }: { person: PersonRow; onDeleted: () => void }) {
  const { t, nm, why } = useAwp();
  const { say } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (person.status === "Active") return null;

  const remove = () =>
    start(async () => {
      setProblem(null);
      const result = await deletePerson({ personId: person.id });
      if (!result.ok) {
        setProblem(why(result));
        return;
      }
      say(t(`${nm(person)} was deleted.`, `حُذف ${nm(person)}.`));
      onDeleted();
    });

  return (
    <>
      <Btn type="danger" label={t("Delete", "حذف")} disabled={pending} onClick={() => setConfirming(true)} />
      {confirming && (
        <Modal
          title={t(`Delete ${nm(person)}?`, `حذف ${nm(person)}؟`)}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Btn type="secondary" label={t("Keep them", "إبقاؤهم")} onClick={() => setConfirming(false)} />
              <Btn type="danger" label={t("Delete person", "حذف الشخص")} disabled={pending} onClick={remove} />
            </>
          }
        >
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}>
              {t(
                "They are removed with their sign-in, roles and memberships. A person a record still refers to cannot be deleted and stays suspended. This cannot be undone.",
                "يُحذفون مع تسجيل دخولهم وأدوارهم وعضوياتهم. ولا يُحذف شخص ما زال سجلّ يشير إليه، فيبقى معلّقًا. لا يمكن التراجع عن ذلك.",
              )}
            </p>
            {problem && (
              <p role="alert" className="awp-small" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>
                {problem}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
