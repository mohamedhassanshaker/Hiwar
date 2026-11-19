import type { CSSProperties, ReactNode } from "react";

/**
 * A card section with an optional header of title and actions. The body is padded unless `pad`
 * is false, when the children are placed directly in the card.
 */
export function Card({
  title,
  actions,
  children,
  pad = true,
  style,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  pad?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section className="awp-card" style={style}>
      {title && (
        <div className="awp-card-h">
          <h3>{title}</h3>
          {actions}
        </div>
      )}
      {pad ? <div className="awp-card-b">{children}</div> : children}
    </section>
  );
}
