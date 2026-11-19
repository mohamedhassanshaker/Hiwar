import type { ReactNode } from "react";

/** The title block every screen opens with: crumb, title, subtitle and the page actions. */
export function PageHead({
  title,
  sub,
  children,
  crumb,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  crumb?: ReactNode;
}) {
  return (
    <div className="awp-ph">
      <div className="awp-ph-t">
        {crumb && (
          <div className="awp-small awp-muted" style={{ marginBottom: 4 }}>
            {crumb}
          </div>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="awp-ph-a">{children}</div>}
    </div>
  );
}
