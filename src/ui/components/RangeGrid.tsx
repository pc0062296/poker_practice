import type { CSSProperties } from 'react';
import { CLASS_LABELS } from '../../eval/handClass';
import { fmt, messages } from '../../i18n';
import type { CompiledChart } from '../../ranges/charts';
import { rangeFraction } from '../../ranges/rangeString';

interface RangeGridProps {
  chart: CompiledChart;
  /** Hand class to outline, e.g. the hero's hand. */
  highlight?: number;
}

/** The 13x13 starting hand grid, colored by how often each hand raises, calls, or folds. */
export function RangeGrid({ chart, highlight }: RangeGridProps) {
  const raiseShare = rangeFraction(chart.raise) * 100;
  const callShare = rangeFraction(chart.call) * 100;
  return (
    <div className="range">
      <div className="range-grid">
        {CLASS_LABELS.map((label, k) => {
          const r = Math.round(chart.raise[k]! * 100);
          const c = Math.round(chart.call[k]! * 100);
          const style: CSSProperties = {
            background: `linear-gradient(to right, var(--c-raise) 0 ${r}%, var(--c-call) ${r}% ${r + c}%, var(--c-fold-cell) ${r + c}% 100%)`,
          };
          const classes = ['range-cell'];
          if (r + c === 0) classes.push('range-cell-fold');
          if (k === highlight) classes.push('range-cell-hero');
          return (
            <div key={label} className={classes.join(' ')} style={style} title={`${label}  ${messages.chart.raise} ${r}%  ${messages.chart.call} ${c}%`}>
              {label}
            </div>
          );
        })}
      </div>
      <div className="range-legend">
        <span>
          <i className="swatch swatch-raise" />
          {messages.chart.raise} {raiseShare.toFixed(1)}%
        </span>
        {callShare > 0 && (
          <span>
            <i className="swatch swatch-call" />
            {messages.chart.call} {callShare.toFixed(1)}%
          </span>
        )}
        <span>
          <i className="swatch swatch-fold" />
          {messages.chart.fold}
        </span>
        {highlight !== undefined && (
          <span>
            <i className="swatch swatch-hero" />
            {messages.chart.yourHand}
          </span>
        )}
      </div>
      <div className="range-share">{fmt(messages.chart.share, { pct: (raiseShare + callShare).toFixed(1) })}</div>
    </div>
  );
}
