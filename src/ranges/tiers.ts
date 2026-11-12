import { NUM_CLASSES } from '../eval/handClass';
import { parseRange } from './rangeString';

/**
 * Nested strength tiers used when no chart covers a spot, and to decide which hands
 * are strong enough to call off a large part of the stack.
 * Tier 0 is the strongest; a class's tier is the first tier that contains it.
 */
const TIER_RANGES = [
  'KK+',
  'QQ+,AKs,AKo',
  'JJ+,AQs+,AKo',
  '99+,AJs+,KQs,AQo+',
  '77+,ATs+,KJs+,QJs,AJo+,KQo',
  '55+,A8s+,A5s,KTs+,QTs+,JTs,T9s,ATo+,KJo+',
  '22+,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,76s,65s,A9o+,KTo+,QTo+,JTo',
  '22+,A2s+,K2s+,Q6s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o,98o',
];

export const NUM_TIERS = TIER_RANGES.length + 1;

/** Tier index for each of the 169 classes (NUM_TIERS - 1 = everything else). */
export const CLASS_TIER = new Uint8Array(NUM_CLASSES).fill(TIER_RANGES.length);

for (let t = TIER_RANGES.length - 1; t >= 0; t--) {
  const weights = parseRange(TIER_RANGES[t]!);
  for (let k = 0; k < NUM_CLASSES; k++) if (weights[k]! > 0) CLASS_TIER[k] = t;
}

/**
 * Loosest tier that may put in `toCallLevels` (in blind levels) when that is a large
 * part of the stack. Bigger commitments need stronger hands.
 */
export function callOffTier(toCallLevels: number): number {
  if (toCallLevels >= 150) return 0;
  if (toCallLevels >= 60) return 1;
  if (toCallLevels >= 30) return 2;
  if (toCallLevels >= 15) return 3;
  if (toCallLevels >= 8) return 4;
  return 5;
}
