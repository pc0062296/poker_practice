import type { Action, LegalActions, PublicView } from '../engine/types';
import type { StrengthTable } from '../eval/strengthTable';
import type { PreflopScenario } from '../ranges/scenario';
import type { SizingOptions } from '../ranges/sizing';

export type OptionKind = 'fold' | 'passive' | 'aggressive';

export interface DecisionOption {
  action: Action;
  kind: OptionKind;
}

/**
 * A strategy for an entire range: for each option, the probability that each of the
 * 1326 combos takes it. The same object drives a bot's own action (read the row for its
 * hand), range tracking (Bayes update for everyone watching), and grading.
 */
export interface RangeStrategy {
  options: DecisionOption[];
  /** probs[option][combo] */
  probs: Float32Array[];
  /** Preflop only: the scenario and chart behind this strategy. */
  preflop?: PreflopScenario;
  /** True when the probabilities were adjusted away from the chart (odd sizes, short stacks). */
  adjusted?: boolean;
}

/** Everything a strategy may look at. It contains no private cards. */
export interface DecisionContext {
  view: PublicView;
  actor: number;
  legal: LegalActions;
  /** Estimated range of every player: weights over the 1326 combos. */
  ranges: Float32Array[];
  /** Strength table for the current board; null before the flop. */
  table: StrengthTable | null;
  sizing: SizingOptions;
}

export interface Policy {
  rangeStrategy(ctx: DecisionContext): RangeStrategy;
}

export function kindOfAction(action: Action): OptionKind {
  if (action.type === 'fold') return 'fold';
  if (action.type === 'check' || action.type === 'call') return 'passive';
  return 'aggressive';
}
