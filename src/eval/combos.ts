import type { Card } from '../engine/cards';
import { classOfCards, NUM_CLASSES } from './handClass';

/** All 1326 two-card combinations, indexed in a fixed order. */
export const NUM_COMBOS = 1326;

/** Lower and higher card of each combo. */
export const COMBO_A = new Uint8Array(NUM_COMBOS);
export const COMBO_B = new Uint8Array(NUM_COMBOS);
/** Starting hand class (0..168) of each combo. */
export const COMBO_CLASS = new Uint8Array(NUM_COMBOS);

const INDEX = new Int16Array(52 * 52).fill(-1);

{
  let i = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      COMBO_A[i] = a;
      COMBO_B[i] = b;
      COMBO_CLASS[i] = classOfCards(a, b);
      INDEX[a * 52 + b] = i;
      INDEX[b * 52 + a] = i;
      i++;
    }
  }
}

export function comboIndex(a: Card, b: Card): number {
  return INDEX[a * 52 + b]!;
}

/** Expand per-class weights (169) to per-combo weights (1326). */
export function expandClassWeights(classWeights: ArrayLike<number>, out = new Float32Array(NUM_COMBOS)): Float32Array {
  for (let i = 0; i < NUM_COMBOS; i++) out[i] = classWeights[COMBO_CLASS[i]!]!;
  return out;
}

/** Average per-combo weights back to per-class weights. */
export function collapseToClasses(comboWeights: ArrayLike<number>): Float32Array {
  const sums = new Float32Array(NUM_CLASSES);
  const counts = new Float32Array(NUM_CLASSES);
  for (let i = 0; i < NUM_COMBOS; i++) {
    const k = COMBO_CLASS[i]!;
    sums[k]! += comboWeights[i]!;
    counts[k]!++;
  }
  for (let k = 0; k < NUM_CLASSES; k++) sums[k] = sums[k]! / counts[k]!;
  return sums;
}

/** Bit mask helpers for dead cards: one bit per card split over two 26-bit halves. */
export function comboBlocked(i: number, dead: readonly Card[]): boolean {
  const a = COMBO_A[i]!;
  const b = COMBO_B[i]!;
  for (const c of dead) if (c === a || c === b) return true;
  return false;
}
