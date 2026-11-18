import { useId, type ReactNode } from "react";

type FieldProps = { label: ReactNode; children: ReactNode; hint?: ReactNode };

/**
 * A form control wrapped in a label, with the label above and an optional hint below.
 *
 * `group` is for a row of buttons (a segmented control, chips). A `<label>` names the first control inside
 * it, so around such a row the first button would be announced with the caption and its siblings' names
 * ("Audience Human Group" for "Agent") and no longer by what it says (WCAG 2.2 4.1.2 and 2.5.3, NFR-17).
 * A group is named by the caption through `aria-labelledby` and every button keeps its own name.
 */
export function Field({ label, children, hint, group = false }: FieldProps & { group?: boolean }) {
  if (group) return <FieldGroup label={label} hint={hint}>{children}</FieldGroup>;
  return (
    <label className="awp-col" style={{ gap: 6 }}>
      <span className="awp-small awp-muted">{label}</span>
      {children}
      {hint && <span className="awp-small awp-muted">{hint}</span>}
    </label>
  );
}

function FieldGroup({ label, children, hint }: FieldProps) {
  const captionId = useId();
  return (
    <div role="group" aria-labelledby={captionId} className="awp-col" style={{ gap: 6 }}>
      <span id={captionId} className="awp-small awp-muted">
        {label}
      </span>
      {children}
      {hint && <span className="awp-small awp-muted">{hint}</span>}
    </div>
  );
}
