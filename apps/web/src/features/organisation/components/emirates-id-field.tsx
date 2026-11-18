"use client";

import { useEffect, useState } from "react";

import { Field } from "@/components/ui/field";
import { loadEmiratesId, savePersonEmiratesId } from "@/features/organisation/actions";
import { useAwp } from "@/hooks/use-awp";
import { formatEmiratesId } from "@/lib/emirates-id";

/** What the person dialog needs to show and save a person's Emirates ID (D387). */
export type EmiratesId = {
  value: string;
  set: (value: string) => void;
  linked: boolean;
  loaded: boolean;
  changed: boolean;
  /** Saves a changed value; returns the refusal to show, or null. */
  save: () => Promise<string | null>;
};

/** Reads a person's Emirates ID when the dialog opens, and saves it only when it was changed. */
export function useEmiratesId(personId: string): EmiratesId {
  const { why } = useAwp();
  const [stored, setStored] = useState<{ value: string; linked: boolean } | null>(null);
  const [value, set] = useState("");

  useEffect(() => {
    void loadEmiratesId({ personId }).then((result) => {
      if (!result.ok) return;
      const shown = result.emiratesId ? formatEmiratesId(result.emiratesId) : "";
      setStored({ value: shown, linked: result.linked });
      set(shown);
    });
  }, [personId]);

  const changed = stored !== null && value.trim() !== stored.value;
  return {
    value,
    set,
    linked: stored?.linked ?? false,
    loaded: stored !== null,
    changed,
    save: async () => {
      if (!changed) return null;
      const result = await savePersonEmiratesId({ personId, emiratesId: value });
      return result.ok ? null : why(result);
    },
  };
}

/**
 * D387: the Emirates ID UAE PASS sign-in links the person by. Locked once UAE PASS has linked
 * the account, as its account linking guidelines require.
 */
export function EmiratesIdField({ id }: { id: EmiratesId }) {
  const { t } = useAwp();
  return (
    <Field
      label={t("Emirates ID", "رقم الهوية الإماراتية")}
      hint={
        id.linked
          ? t("Linked to UAE PASS: it is the Emirates ID UAE PASS returned and cannot be changed.", "مرتبط بالهوية الرقمية: هو الرقم الذي أعادته الهوية الرقمية ولا يمكن تغييره.")
          : t("15 digits starting with 784. Signing in with UAE PASS finds the person by it.", "15 رقماً تبدأ بـ 784. يُعرَف الشخص به عند تسجيل الدخول بالهوية الرقمية.")
      }
    >
      <input
        className="awp-input"
        value={id.value}
        onChange={(event) => id.set(event.target.value)}
        disabled={!id.loaded || id.linked}
        placeholder="784-1990-1234567-1"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
      />
    </Field>
  );
}
