"use client";

import { type ReactNode } from "react";

import { Ic } from "@/components/ui/icon";
import { useAwp } from "@/hooks/use-awp";
import { useCountUp } from "./motion";

/** A number in `en-US` grouping with exactly `decimals` decimal places. */
export const formatCount = (value: number, decimals = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** A money figure with the units small and the decimals quiet, as the cards show it. */
export function Money({ value, className }: { value: number; className?: string }) {
  const { t } = useAwp();
  const counted = useCountUp(value);
  const [whole, fraction] = formatCount(counted, 2).split(".");
  return (
    <span className={"d3-money " + (className ?? "")}>
      <small>{t("AED", "د.إ")}</small>
      <bdi>{whole}</bdi>
      <span className="d3-dec">.{fraction}</span>
    </span>
  );
}

/** A card's own small round button. An arrow one carries the "See all details" tooltip. */
export function CardButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const { t } = useAwp();
  const arrow = icon.startsWith("Arrow");
  const tip = t("See all details", "عرض كل التفاصيل");
  return (
    <button
      className={"d3-ibtn" + (arrow ? " d3-tipbtn" : "")}
      onClick={onClick}
      aria-label={arrow ? `${label} · ${tip}` : label}
      title={arrow ? undefined : label}
      data-tip={arrow ? tip : undefined}
    >
      <Ic n={icon} s={16} />
    </button>
  );
}

/** A card's heading row: the title, and its action buttons when there are any. */
export function CardHead({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="d3-ch">
      <h3>{title}</h3>
      {actions && <div className="d3-ch-a">{actions}</div>}
    </div>
  );
}
