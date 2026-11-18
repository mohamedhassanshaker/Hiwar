"use client";

import { priAr, workItemStatus } from "@/i18n/vocabulary";
import { useAwp } from "@/hooks/use-awp";

/** A work item status as its board column label in the console's language, falling back to the status. */
export function useColLbl() {
  const { t } = useAwp();
  return (st: string) => {
    const label = workItemStatus[st];
    return label ? t(label[0], label[1]) : st;
  };
}

/** The prototype's three type words, which the data model stores as Task, SubItem and Bug. */
export function useTypeLbl() {
  const { t } = useAwp();
  return (type: string) => (type === 'SubItem' ? t('Sub item', priAr.Subtask) : t(type, priAr[type] ?? type));
}
