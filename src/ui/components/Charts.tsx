import { useRef, useState } from 'react';
import { useElementSize } from '../hooks';

export interface ChartSeries {
  name: string;
  /** CSS color for the mark only; text stays in text colors. */
  color: string;
  values: (number | null)[];
}

interface Common {
  /** Label for each x position (shown in tooltips and the table). */
  labels: string[];
  format: (v: number) => string;
  height?: number;
  /** Accessible name. */
  title: string;
}

const PAD = { top: 12, right: 52, bottom: 24, left: 40 };

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

function Tooltip({ x, y, width, lines }: { x: number; y: number; width: number; lines: { label: string; value: string; color?: string }[] }) {
  const left = Math.min(Math.max(x + 12, 0), width - 170);
  return (
    <div className="chart-tip" style={{ left, top: Math.max(0, y - 8) }}>
      {lines.map((l, i) => (
        <div key={i} className="chart-tip-row">
          {l.color && <i className="chart-swatch" style={{ background: l.color }} />}
          <strong>{l.value}</strong>
          <span>{l.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Lines on one y-axis with a crosshair tooltip; values are shares (0..1) or plain numbers. */
export function LineChart({ labels, series, format, height = 200, title, yMax }: Common & { series: ChartSeries[]; yMax?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const top = yMax ?? niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const xAt = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);

  const path = (values: (number | null)[]) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const lastIndex = (values: (number | null)[]) => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
    return -1;
  };

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={PAD.left} x2={PAD.left + plotW} y1={yAt(t)} y2={yAt(t)} />
              <text className="chart-axis" x={PAD.left - 6} y={yAt(t) + 4} textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {n > 0 && (
            <>
              <text className="chart-axis" x={xAt(0)} y={height - 6} textAnchor="start">
                {labels[0]}
              </text>
              {n > 1 && (
                <text className="chart-axis" x={xAt(n - 1)} y={height - 6} textAnchor="end">
                  {labels[n - 1]}
                </text>
              )}
            </>
          )}
          {series.map((s) => (
            <g key={s.name}>
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) =>
                v !== null && (n <= 12 || i === hover) ? (
                  <circle key={i} cx={xAt(i)} cy={yAt(v)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />
                ) : null,
              )}
              {lastIndex(s.values) >= 0 && (
                <text className="chart-label" x={xAt(lastIndex(s.values)) + 8} y={yAt(s.values[lastIndex(s.values)]!) + 4}>
                  {s.name}
                </text>
              )}
            </g>
          ))}
          {hover !== null && <line className="chart-cross" x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + plotH} />}
          <rect
            x={PAD.left - 10}
            y={0}
            width={plotW + 20}
            height={height}
            fill="transparent"
            onPointerMove={(e) => {
              const box = (e.currentTarget as SVGRectElement).ownerSVGElement!.getBoundingClientRect();
              const x = e.clientX - box.left - PAD.left;
              setHover(n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((x / plotW) * (n - 1)))));
            }}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          x={xAt(hover)}
          y={PAD.top}
          width={width}
          lines={[
            { label: labels[hover]!, value: '' },
            ...series.map((s) => ({ label: s.name, value: s.values[hover] === null ? '-' : format(s.values[hover]!), color: s.color })),
          ]}
        />
      )}
    </div>
  );
}

/** Vertical bars from a zero baseline, one per x position, with a per-bar tooltip. */
export function BarChart({ labels, values, color, format, height = 160, title, name }: Common & { values: number[]; color: string; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const top = niceMax(Math.max(0, ...values));
  const plotW = Math.max(10, width - PAD.left - 12);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = n > 0 ? plotW / n : plotW;
  const barW = Math.max(3, Math.min(36, slot - 2));
  const yAt = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, 0.5, 1].map((f) => f * top);
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={PAD.left} x2={PAD.left + plotW} y1={yAt(t)} y2={yAt(t)} />
              <text className="chart-axis" x={PAD.left - 6} y={yAt(t) + 4} textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {values.map((v, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            const h = Math.max(0, PAD.top + plotH - yAt(v));
            const r = Math.min(4, h, barW / 2);
            const y = PAD.top + plotH - h;
            // Rounded top corners only; the bar sits square on the baseline.
            const d = `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + h}Z`;
            return (
              <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                <path d={d} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
              </g>
            );
          })}
          {n > 0 && (
            <>
              <text className="chart-axis" x={PAD.left} y={height - 6} textAnchor="start">
                {labels[0]}
              </text>
              {n > 1 && (
                <text className="chart-axis" x={PAD.left + plotW} y={height - 6} textAnchor="end">
                  {labels[n - 1]}
                </text>
              )}
            </>
          )}
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          x={PAD.left + hover * slot + slot / 2}
          y={PAD.top}
          width={width}
          lines={[
            { label: labels[hover]!, value: '' },
            { label: name, value: format(values[hover]!), color },
          ]}
        />
      )}
    </div>
  );
}
