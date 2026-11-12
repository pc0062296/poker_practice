import type { CSSProperties } from 'react';
import { CLASS_LABELS } from '../../eval/handClass';

/** 13x13 grid shaded by how likely each starting hand is in a range (weights 0..1). */
export function RangeHeat({ classes, highlight }: { classes: readonly number[]; highlight?: number }) {
  return (
    <div className="range-grid">
      {CLASS_LABELS.map((label, k) => {
        const w = Math.max(0, Math.min(1, classes[k] ?? 0));
        const style: CSSProperties = {
          background: w > 0.01 ? `rgba(240, 160, 60, ${0.12 + 0.88 * w})` : 'var(--c-fold-cell)',
          color: w > 0.45 ? '#1b1206' : w > 0.01 ? '#f3e2c7' : '#6f7c8d',
          textShadow: 'none',
        };
        const classes2 = ['range-cell'];
        if (k === highlight) classes2.push('range-cell-hero');
        return (
          <div key={label} className={classes2.join(' ')} style={style} title={`${label} ${Math.round(w * 100)}%`}>
            {label}
          </div>
        );
      })}
    </div>
  );
}
