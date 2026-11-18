"use client";

import { MAX_CONTEXT_WINDOW, MODEL_KIND_LABELS } from "@/features/models/types";
import { MODEL_KINDS } from "@/db/schema/enums";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";

/**
 * One model in a connection's allow-list: whether it is allowed and, once it is, what it answers
 * at and its context window. An empty window is none recorded (`UC-60.1-05`).
 */
export function AllowedModelRow({
  model,
  allowed,
  kind,
  contextWindow,
  onToggle,
  onKind,
  onWindow,
}: {
  model: string;
  allowed: boolean;
  kind: string;
  contextWindow: number | undefined;
  onToggle: () => void;
  onKind: (kind: string) => void;
  onWindow: (tokens: number | undefined) => void;
}) {
  const { t } = useAwp();
  return (
    <div className="awp-row" style={{ gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
      <label className="awp-row" style={{ gap: 10 }}>
        <input type="checkbox" checked={allowed} onChange={onToggle} />
        <span className="awp-mono">{model}</span>
      </label>
      {allowed && (
        <div className="awp-row" style={{ gap: 8 }}>
          <input
            className="awp-input awp-small awp-mono"
            style={{ width: 130 }}
            type="number"
            min={1}
            max={MAX_CONTEXT_WINDOW}
            step={1}
            inputMode="numeric"
            value={contextWindow ?? ""}
            placeholder={t("Context tokens", "رموز السياق")}
            aria-label={t(`Context window of ${model}, in tokens`, `نافذة سياق ${model} بالرموز`)}
            onChange={(e) => onWindow(e.target.value === "" ? undefined : Number(e.target.value))}
          />
          <PopSelect
            className="awp-input awp-small"
            style={{ width: "auto" }}
            aria-label={t("What this model answers at", "ما الذي يجيب عليه هذا النموذج")}
            value={kind}
            onChange={(e) => onKind(e.target.value)}
          >
            {MODEL_KINDS.map((one) => (
              <option key={one} value={one}>
                {t(...MODEL_KIND_LABELS[one])}
              </option>
            ))}
          </PopSelect>
        </div>
      )}
    </div>
  );
}
