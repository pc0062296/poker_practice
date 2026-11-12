import type { DecisionRecord } from '../game/handRunner';
import type { Card } from '../engine/cards';
import type { Chips, PositionName } from '../engine/types';
import { classOfCards } from '../eval/handClass';
import type { ChartDepth } from '../ranges/charts';
import type { ScenarioKind } from '../ranges/scenario';

export type PreflopVerdict = 'best' | 'ok' | 'inaccuracy' | 'mistake' | 'ungraded';
export type PreflopChoice = 'fold' | 'call' | 'raise';

export interface PreflopGrade {
  /** Number of actions taken before this decision. */
  actionIndex: number;
  verdict: PreflopVerdict;
  kind: ScenarioKind;
  chartKey: string | null;
  depth: ChartDepth;
  /** True when the chart only roughly fits the spot, or the price forced an adjustment. */
  approx: boolean;
  heroPosition: PositionName;
  villainPosition: PositionName | null;
  handClass: number;
  /** Baseline frequencies for the hero's hand. */
  freq: Record<PreflopChoice, number>;
  chosen: PreflopChoice;
  /** True when the passive option was a free check rather than a call. */
  canCheck: boolean;
  toCall: Chips;
  /** Raise sizing compared with the standard size; null when the hero did not raise. */
  sizing: { hero: Chips; standard: Chips; verdict: 'ok' | 'small' | 'large' } | null;
}

/** A chosen action at least this frequent in the baseline counts as an accepted mixed play. */
const OK_FREQUENCY = 0.25;
const INACCURACY_FREQUENCY = 0.05;
const SIZE_SMALL = 0.7;
const SIZE_LARGE = 1.5;

/** Grade one of the hero's preflop decisions against the range charts. */
export function gradePreflopDecision(record: DecisionRecord, hole: readonly [Card, Card]): PreflopGrade | null {
  const scenario = record.preflop;
  if (record.street !== 'preflop' || !scenario) return null;

  const freq: Record<PreflopChoice, number> = { fold: 0, call: 0, raise: 0 };
  let standard = 0;
  record.options.forEach((option, i) => {
    const p = record.handProbs[i]!;
    if (option.kind === 'fold') freq.fold += p;
    else if (option.kind === 'passive') freq.call += p;
    else {
      freq.raise += p;
      standard = option.action.amount ?? 0;
    }
  });

  const type = record.chosen.type;
  const chosen: PreflopChoice = type === 'fold' ? 'fold' : type === 'check' || type === 'call' ? 'call' : 'raise';
  const best = Math.max(freq.fold, freq.call, freq.raise);
  const mine = freq[chosen];

  let verdict: PreflopVerdict;
  if (!scenario.chart) verdict = 'ungraded';
  else if (mine >= best - 1e-6) verdict = 'best';
  else if (mine >= OK_FREQUENCY) verdict = 'ok';
  else if (mine >= INACCURACY_FREQUENCY) verdict = 'inaccuracy';
  else verdict = 'mistake';

  let sizing: PreflopGrade['sizing'] = null;
  if (chosen === 'raise' && standard > 0 && record.chosen.amount) {
    const hero = record.chosen.amount;
    const ratio = hero / standard;
    // An all-in is judged by the action, not by its size.
    const allIn = hero >= record.legal.maxRaiseTo;
    sizing = {
      hero,
      standard,
      verdict: allIn || (ratio >= SIZE_SMALL && ratio <= SIZE_LARGE) ? 'ok' : ratio < SIZE_SMALL ? 'small' : 'large',
    };
  }

  return {
    actionIndex: record.actionIndex,
    verdict,
    kind: scenario.kind,
    chartKey: scenario.chartKey,
    depth: scenario.depth,
    approx: scenario.approx || record.adjusted,
    heroPosition: scenario.heroPosition,
    villainPosition: scenario.villainPosition,
    handClass: classOfCards(hole[0], hole[1]),
    freq,
    chosen,
    canCheck: record.legal.canCheck,
    toCall: record.legal.callAmount,
    sizing,
  };
}
