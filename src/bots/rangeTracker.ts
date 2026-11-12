import type { Card } from '../engine/cards';
import type { Action } from '../engine/types';
import { COMBO_A, COMBO_B, NUM_COMBOS } from '../eval/combos';
import { kindOfAction, type RangeStrategy } from './types';

/**
 * Chance that a player does something their strategy says never happens.
 * Keeps ranges from collapsing to zero when someone plays off-script.
 */
const TREMBLE = 0.04;

/**
 * Tracks an estimated range for every player from public actions only.
 * After each action the acting player's range is multiplied by the probability
 * that each combo would have taken that action (a Bayes update).
 */
export class RangeTracker {
  ranges: Float32Array[];

  constructor(numPlayers: number) {
    this.ranges = [];
    for (let i = 0; i < numPlayers; i++) this.ranges.push(new Float32Array(NUM_COMBOS).fill(1));
  }

  /** Remove combos that contain a community card. */
  removeCards(cards: readonly Card[]): void {
    if (cards.length === 0) return;
    const dead = new Uint8Array(52);
    for (const c of cards) dead[c] = 1;
    for (const range of this.ranges) {
      for (let i = 0; i < NUM_COMBOS; i++) {
        if (dead[COMBO_A[i]!] || dead[COMBO_B[i]!]) range[i] = 0;
      }
    }
  }

  /** Update the actor's range given the strategy they were assumed to use and what they did. */
  observe(actor: number, strategy: RangeStrategy, action: Action): void {
    const likelihood = actionLikelihood(strategy, action);
    if (!likelihood) return;
    const range = this.ranges[actor]!;
    let max = 0;
    for (let i = 0; i < NUM_COMBOS; i++) {
      const w = range[i]! * ((1 - TREMBLE) * likelihood[i]! + TREMBLE);
      range[i] = w;
      if (w > max) max = w;
    }
    if (max > 0) {
      const scale = 1 / max;
      for (let i = 0; i < NUM_COMBOS; i++) range[i]! *= scale;
    }
  }

  clone(): RangeTracker {
    const copy = new RangeTracker(0);
    copy.ranges = this.ranges.map((r) => r.slice());
    return copy;
  }
}

/**
 * Per-combo probability of the observed action under a strategy.
 * Bets and raises are matched to the option with the closest size.
 */
export function actionLikelihood(strategy: RangeStrategy, action: Action): Float32Array | null {
  const kind = kindOfAction(action);
  let best = -1;
  let bestDistance = Infinity;
  strategy.options.forEach((option, index) => {
    if (option.kind !== kind) return;
    let distance = 0;
    if (kind === 'aggressive') {
      const a = Math.max(1, action.amount ?? 1);
      const b = Math.max(1, option.action.amount ?? 1);
      distance = Math.abs(Math.log(a / b));
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  if (best < 0) return null;
  if (kind !== 'aggressive') return strategy.probs[best]!;

  // An unusual size carries less information: blend towards "any bet or raise".
  const exact = strategy.probs[best]!;
  const any = new Float32Array(NUM_COMBOS);
  strategy.options.forEach((option, index) => {
    if (option.kind !== 'aggressive') return;
    const p = strategy.probs[index]!;
    for (let i = 0; i < NUM_COMBOS; i++) any[i]! += p[i]!;
  });
  const trust = Math.max(0, 1 - bestDistance / Math.log(2));
  if (trust >= 1) return exact;
  for (let i = 0; i < NUM_COMBOS; i++) any[i] = trust * exact[i]! + (1 - trust) * any[i]!;
  return any;
}
