import { fmt, messages } from '../i18n';

/** A readable name for a chart key such as "vsOpen:EP:BTN". */
export function chartLabel(key: string): string {
  const parts = key.split(':');
  const group = (g: string) => messages.positionGroup[g] ?? g;
  const t = messages.chartLabel;
  switch (parts[0]) {
    case 'rfi':
      return fmt(t.rfi, { hero: parts[1]! });
    case 'vsLimp':
      return parts[1] === 'BBvsSB' ? t.vsLimpBBvsSB : fmt(t.vsLimp, { hero: group(parts[1]!) });
    case 'vsOpen':
      return fmt(t.vsOpen, { villain: group(parts[1]!), hero: group(parts[2]!) });
    case 'vs3bet':
      return fmt(t.vs3bet, { hero: group(parts[1]!) });
    case 'cold3bet':
      return t.cold3bet;
    case 'vs4bet':
      return t.vs4bet;
    default:
      return t.vs5bet;
  }
}

/** Which list section a chart key belongs to. */
export function chartGroup(key: string): string {
  const kind = key.split(':')[0]!;
  return ['rfi', 'vsLimp', 'vsOpen', 'vs3bet'].includes(kind) ? kind : 'other';
}
