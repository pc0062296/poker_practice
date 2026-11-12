import { RANK_CHARS, rankOf, suitOf, type Card } from '../engine/cards';

/**
 * The 169 starting hand classes laid out on the usual 13x13 grid.
 *   class index = row * 13 + col, where index 0 is the ace.
 *   diagonal = pairs, above the diagonal = suited, below = offsuit.
 */
export const NUM_CLASSES = 169;

/** Ranks in grid order: ace first. */
export const GRID_RANKS = 'AKQJT98765432';

export type ClassKind = 'pair' | 'suited' | 'offsuit';

export const CLASS_LABELS: string[] = [];
export const CLASS_COMBOS = new Uint8Array(NUM_CLASSES);
export const CLASS_KINDS: ClassKind[] = [];

for (let row = 0; row < 13; row++) {
  for (let col = 0; col < 13; col++) {
    const k = row * 13 + col;
    if (row === col) {
      CLASS_LABELS[k] = GRID_RANKS[row]! + GRID_RANKS[col]!;
      CLASS_COMBOS[k] = 6;
      CLASS_KINDS[k] = 'pair';
    } else if (row < col) {
      CLASS_LABELS[k] = GRID_RANKS[row]! + GRID_RANKS[col]! + 's';
      CLASS_COMBOS[k] = 4;
      CLASS_KINDS[k] = 'suited';
    } else {
      CLASS_LABELS[k] = GRID_RANKS[col]! + GRID_RANKS[row]! + 'o';
      CLASS_COMBOS[k] = 12;
      CLASS_KINDS[k] = 'offsuit';
    }
  }
}

/** Class index from two ranks (0 = deuce ... 12 = ace) and suitedness. */
export function classFromRanks(rankA: number, rankB: number, suited: boolean): number {
  const hi = Math.max(rankA, rankB);
  const lo = Math.min(rankA, rankB);
  const gHi = 12 - hi;
  const gLo = 12 - lo;
  if (hi === lo) return gHi * 13 + gHi;
  return suited ? gHi * 13 + gLo : gLo * 13 + gHi;
}

export function classOfCards(a: Card, b: Card): number {
  return classFromRanks(rankOf(a), rankOf(b), suitOf(a) === suitOf(b));
}

/** Parse a class label such as "AKs", "T9o" or "77". Returns -1 when invalid. */
export function parseClassLabel(label: string): number {
  if (label.length < 2 || label.length > 3) return -1;
  const a = RANK_CHARS.indexOf(label[0]!.toUpperCase());
  const b = RANK_CHARS.indexOf(label[1]!.toUpperCase());
  if (a < 0 || b < 0) return -1;
  const suffix = label[2]?.toLowerCase();
  if (a === b) return suffix ? -1 : classFromRanks(a, b, false);
  if (suffix !== 's' && suffix !== 'o') return -1;
  return classFromRanks(a, b, suffix === 's');
}

/** High and low rank (0 = deuce ... 12 = ace) of a class. */
export function classRanks(k: number): { hi: number; lo: number } {
  const row = Math.floor(k / 13);
  const col = k % 13;
  const a = 12 - row;
  const b = 12 - col;
  return { hi: Math.max(a, b), lo: Math.min(a, b) };
}
