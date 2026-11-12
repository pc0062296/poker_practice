import { UNITS_PER_BB, type Settings } from '../../store/settings';

/** Chips from a number typed in the current display unit (big blinds or table money). */
export function toChips(value: number, settings: Settings): number {
  const bb = settings.unit === 'chips' ? value / settings.bigBlindAmount : value;
  return Math.round(bb * UNITS_PER_BB);
}

/** A number in the current display unit for an input field. */
export function fromChips(chips: number, settings: Settings): number {
  const bb = chips / UNITS_PER_BB;
  return settings.unit === 'chips' ? Math.round(bb * settings.bigBlindAmount) : Math.round(bb * 100) / 100;
}
