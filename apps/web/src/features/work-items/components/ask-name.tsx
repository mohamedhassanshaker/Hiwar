"use client";

import { useState } from "react";

import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { useAwp } from "@/hooks/use-awp";

/**
 * Asks for one name, in the console's own dialog.
 *
 * Adding a sub item and keeping a view both need a line of text and nothing else. The
 * browser's own prompt cannot carry the language, the direction or the styling the rest of
 * the console has, so they use this.
 */
export function AskName({
  title,
  label,
  onClose,
  onDone,
}: {
  title: string;
  label: string;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const { t } = useAwp();
  const [name, setName] = useState("");
  const given = name.trim();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={title} disabled={given === ""} onClick={() => onDone(given)} />
        </>
      }
    >
      <Field label={label}>
        <input className="awp-input" value={name} autoFocus aria-label={label} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Modal>
  );
}
