"use client";

import { useState } from "react";

import { useEntered } from "./motion";

/**
 * The charts Dashboard 3 draws (handoff v2 section 2.2).
 *
 * All of them are plain SVG and CSS: the shapes are a handful of bars, one smoothed line,
 * three circles and a sparkline, and a charting library would be more code than the
 * drawings. Each animates once on entry and is static under reduced motion; the hover
 * state is the one thing that keeps moving, because it answers a question.
 */

/** One point of a chart, with the tick it is labelled by. */
export type Point = { label: string; value: number };

/**
 * A Catmull-Rom path through the points, written as cubic Béziers.
 *
 * The line charts are read as a trend, and a polyline through daily counts reads as noise;
 * the control points are the neighbours' midpoints, so the curve never overshoots into a
 * value the data does not have.
 */
function smooth(points: [number, number][]): string {
  return points
    .map((point, index) => {
      if (!index) return `M${point[0]} ${point[1]}`;
      const before = points[index - 2] ?? points[index - 1];
      const previous = points[index - 1];
      const after = points[index + 1] ?? point;
      const control1 = [previous[0] + (point[0] - before[0]) / 6, previous[1] + (point[1] - before[1]) / 6];
      const control2 = [point[0] - (after[0] - previous[0]) / 6, point[1] - (after[1] - previous[1]) / 6];
      return `C${control1[0]} ${control1[1]} ${control2[0]} ${control2[1]} ${point[0]} ${point[1]}`;
    })
    .join(" ");
}

/** The bar chart of agent runs. The last bar is the one described until one is hovered. */
export function Bars({ data, label }: { data: Point[]; label: string }) {
  const entered = useEntered();
  const [active, setActive] = useState(data.length - 1);
  const max = Math.max(1, ...data.map((point) => point.value));
  return (
    <div
      className={"d3-bars" + (data.length > 8 ? " is-dense" : "")}
      style={{ gridTemplateColumns: `repeat(${data.length},minmax(0,1fr))`, gap: data.length > 10 ? 4 : 8 }}
      role="group"
      aria-label={label}
    >
      {data.map((point, index) => (
        <button
          key={point.label + index}
          className={"d3-bar" + (index === active ? " on" : "")}
          onMouseEnter={() => setActive(index)}
          onFocus={() => setActive(index)}
          aria-label={`${point.label}: ${point.value}`}
        >
          <span className="d3-bar-track">
            <span
              className="d3-bar-fill"
              style={{ height: entered ? `${(point.value / max) * 100}%` : "6%", transitionDelay: `${index * 45}ms` }}
            >
              {index === active && <span className="d3-tip">{point.value}</span>}
            </span>
          </span>
          <span className="d3-bar-k">{point.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The smoothed line of work items finished, with a point per bucket. */
export function Line({ data, unitLabel }: { data: Point[]; unitLabel: string }) {
  const entered = useEntered();
  const [active, setActive] = useState(data.length - 1);
  const max = Math.max(1, ...data.map((point) => point.value)) * 1.1;
  // One point can draw no line; the chart falls back to a flat pair so the card is not blank.
  const points: [number, number][] =
    data.length > 1
      ? data.map((point, index) => [4 + (index * 92) / (data.length - 1), 12 + (1 - point.value / max) * 76])
      : [
          [4, 12 + (1 - (data[0]?.value ?? 0) / max) * 76],
          [96, 12 + (1 - (data[0]?.value ?? 0) / max) * 76],
        ];
  const line = smooth(points);
  const area = `${line} L${points[points.length - 1][0]} 100 L${points[0][0]} 100 Z`;
  const here = points[Math.min(active, points.length - 1)];
  const current = data[Math.min(active, data.length - 1)];
  return (
    <div className="d3-line">
      <div className={"d3-line-plot" + (entered ? " in" : "")}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="d3-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--d3-accent)" stopOpacity=".55" />
              <stop offset="1" stopColor="var(--d3-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#d3-area)" />
          <path d={line} fill="none" stroke="var(--d3-ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        </svg>
        <span className="d3-guide" style={{ left: `${here[0]}%`, top: `${here[1]}%` }} />
        {points.map((point, index) => (
          <span
            key={index}
            className={"d3-dot" + (index === active ? " on" : "")}
            style={{
              left: `${point[0]}%`,
              top: `${point[1]}%`,
              transitionDelay: entered ? `${300 + index * Math.min(60, 420 / points.length)}ms` : "0ms",
            }}
          />
        ))}
        <span
          className={"d3-tip d3-tip-abs" + (here[0] > 72 ? " is-end" : here[0] < 28 ? " is-start" : "")}
          style={{ left: `${here[0]}%`, top: `${here[1]}%` }}
        >
          {current?.label}: {current?.value} {unitLabel}
        </span>
        <div className="d3-line-hit" style={{ gridTemplateColumns: `repeat(${data.length},1fr)` }}>
          {data.map((point, index) => (
            <button
              key={point.label + index}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              aria-label={`${point.label}: ${point.value} ${unitLabel}`}
            />
          ))}
        </div>
      </div>
      <div className={"d3-axis is-abs" + (data.length > 8 ? " is-dense" : "")}>
        {data.map((point, index) => (
          <span
            key={point.label + index}
            className={index === active ? "on" : ""}
            style={{ left: `${points[Math.min(index, points.length - 1)][0]}%` }}
          >
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One slice of the run-outcome card. */
export type Bubble = { label: string; count: number; share: number; tone: string; onOpen: () => void };

/** Three bubbles and their legend. The colour is never the only thing that says which. */
export function Bubbles({ items }: { items: Bubble[] }) {
  const entered = useEntered();
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="d3-bub-wrap">
      <div className={"d3-bubs" + (entered ? " in" : "")}>
        {items.map((bubble, index) => (
          <button
            key={bubble.label}
            className={
              "d3-bub d3-bub-" + index + (hover === index ? " on" : "") + (hover !== null && hover !== index ? " dim" : "")
            }
            style={{ transitionDelay: entered ? `${index * 120}ms` : "0ms" }}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
            onClick={bubble.onOpen}
            aria-label={`${bubble.label} ${bubble.share}%`}
          >
            <span className="d3-bub-v">
              {bubble.share}
              <small>%</small>
            </span>
            {index === 0 && <span className="d3-bub-k">{bubble.label}</span>}
          </button>
        ))}
      </div>
      <div className="d3-bub-legend">
        {items.map((bubble, index) => (
          <div
            key={bubble.label}
            className={"d3-bl" + (hover === index ? " on" : "")}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          >
            <b>{bubble.count}</b>
            <span>
              <i className={"d3-bl-dot is-" + bubble.tone} />
              {bubble.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The eight-point automation trend beside the hero figure. */
export function Sparkline({ data }: { data: number[] }) {
  const entered = useEntered();
  const width = 240;
  const height = 92;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(1, max - min);
  const points: [number, number][] = data.map((value, index) => [
    8 + (index * (width - 16)) / Math.max(1, data.length - 1),
    10 + (1 - (value - min) / span) * (height - 24),
  ]);
  const line = smooth(points);
  return (
    <svg className={"d3-spark" + (entered ? " in" : "")} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <pattern id="d3-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--d3-ink)" strokeOpacity=".22" strokeWidth="2" />
        </pattern>
      </defs>
      <path d={`${line} L${points[points.length - 1][0]} ${height} L${points[0][0]} ${height} Z`} fill="url(#d3-hatch)" />
      <path className="d3-spark-l" d={line} fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round" pathLength="1" />
      <circle cx={points[0][0]} cy={points[0][1]} r="3.5" fill="var(--text-primary)" />
      <circle
        className="d3-spark-end"
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r="4"
        fill="var(--surface-raised)"
        stroke="var(--text-primary)"
        strokeWidth="1.5"
      />
    </svg>
  );
}
