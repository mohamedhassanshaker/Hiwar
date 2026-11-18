/**
 * `COM-04`: the placeholder a console screen shows while its data is read. It occupies the
 * same block the page head and the first cards will, so nothing jumps when they arrive.
 */
// `globals.css` is a verbatim copy of the handoff style block (`tests/handoff-delta.test.ts`),
// so the placeholder's own look is written here, from the same tokens.
function Block({ height, width = "100%" }: { height: number; width?: number | string }) {
  return <div style={{ height, width, borderRadius: 8, background: "var(--surface-sunken)" }} aria-hidden />;
}

/** A page head and two cards of grey bars, marked busy for assistive technology. */
export function ConsoleSkeleton() {
  return (
    <div className="awp-page" aria-busy="true" aria-live="polite" data-loading="1">
      <div className="awp-row" style={{ justifyContent: "space-between", gap: 16 }}>
        <Block height={28} width={260} />
        <Block height={36} width={140} />
      </div>
      <section className="awp-card">
        <div className="awp-card-b awp-col" style={{ gap: 12 }}>
          <Block height={18} width="60%" />
          <Block height={18} />
          <Block height={18} width="80%" />
          <Block height={18} width="40%" />
        </div>
      </section>
      <section className="awp-card">
        <div className="awp-card-b awp-col" style={{ gap: 12 }}>
          <Block height={18} width="50%" />
          <Block height={18} />
          <Block height={18} width="70%" />
        </div>
      </section>
    </div>
  );
}
