import { NUM_COMBOS } from '../eval/combos';
import { beatFractions, drawStrengths, type StrengthTable } from '../eval/strengthTable';

/**
 * Per-board quantities that do not depend on anyone's range. They are cached on the
 * strength table so every player and every decision on the same board shares them.
 */
interface BoardFeatures {
  /** Share of all possible hands each combo beats: "absolute" hand strength. */
  raw: Float32Array;
  /** Chance each combo completes a draw. */
  draw: Float32Array;
}

const cache = new WeakMap<StrengthTable, BoardFeatures>();
const UNIFORM = new Float32Array(NUM_COMBOS).fill(1);

export function boardFeatures(table: StrengthTable): BoardFeatures {
  let features = cache.get(table);
  if (!features) {
    features = { raw: beatFractions(table, UNIFORM), draw: drawStrengths(table.board) };
    cache.set(table, features);
  }
  return features;
}
