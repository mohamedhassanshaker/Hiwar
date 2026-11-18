import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { DirectoryProvider } from "@/components/shared/directory";
import { Bars, Bubbles, Line, Sparkline } from "@/features/home/components/dash3/charts";
import { CardButton, CardHead, Money } from "@/features/home/components/dash3/card-parts";
import { CardRangeMenu, RangePill } from "@/features/home/components/dash3/range-menu";
import { PreferencesProvider } from "@/lib/preferences";

/**
 * What the Dashboard 3 charts and range controls draw on first render, held as snapshots.
 * Each is rendered with fixed props, so a change to the markup a person sees fails here.
 */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects: [], may: [] }}>{node}</DirectoryProvider>
    </PreferencesProvider>,
  );
const noop = () => undefined;

describe("S-10 Dashboard 3 charts", () => {
  const points = [
    { label: "Mon", value: 3 },
    { label: "Tue", value: 0 },
    { label: "Wed", value: 7 },
    { label: "Thu", value: 4 },
  ];

  it("draws the card chrome: money, the round buttons and the heading", () => {
    expect(
      render(
        <>
          <Money value={1234.5} className="big" />
          <CardButton icon="ArrowRight01Round" label="Agent runs" onClick={noop} />
          <CardButton icon="Download04" label="Export" onClick={noop} />
          <CardHead title="Agent runs" actions={<span>menu</span>} />
          <CardHead title="No actions" />
        </>,
      ),
    ).toMatchSnapshot();
  });

  it("draws the bars, the line and the sparkline from the same points", () => {
    expect(render(<Bars data={points} label="Runs" />)).toMatchSnapshot();
    expect(render(<Line data={points} unitLabel="tasks" />)).toMatchSnapshot();
    expect(render(<Sparkline data={points.map((point) => point.value)} />)).toMatchSnapshot();
  });

  it("draws the outcome bubbles", () => {
    expect(
      render(
        <Bubbles
          items={[
            { label: "Completed", count: 12, share: 75, tone: "success", onOpen: noop },
            { label: "Waiting", count: 3, share: 19, tone: "warning", onOpen: noop },
            { label: "Failed", count: 1, share: 6, tone: "danger", onOpen: noop },
          ]}
        />,
      ),
    ).toMatchSnapshot();
  });
});

describe("S-10 Dashboard 3 range controls", () => {
  it("draws the header pill and a card's menu, closed, for a preset and for a chosen range", () => {
    // A preset is counted back from today, so the day the snapshot was taken is pinned.
    vi.useFakeTimers({ now: new Date(2026, 9, 19, 12), toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const custom = { id: "custom" as const, from: new Date(2026, 0, 5), to: new Date(2026, 0, 18) };
    expect(render(<RangePill value={{ id: "7d" }} onChange={noop} />)).toMatchSnapshot();
    expect(render(<RangePill value={custom} onChange={noop} />)).toMatchSnapshot();
    expect(render(<CardRangeMenu value={{ id: "1m" }} onChange={noop} />)).toMatchSnapshot();
    expect(render(<CardRangeMenu value={custom} onChange={noop} />)).toMatchSnapshot();
  });
});
