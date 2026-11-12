import type { CustomProfileSettings } from '../bots/profiles';
import { actionLikelihood } from '../bots/rangeTracker';
import type { Action, Street } from '../engine/types';
import { COMBO_A, COMBO_B, collapseToClasses, NUM_COMBOS } from '../eval/combos';
import { HandRunner } from '../game/handRunner';
import { modelsFor, rangeMix, type RangeMix } from '../grading/postflop';
import { gradePreflopDecision, type PreflopGrade } from '../grading/preflop';
import { DEFAULT_SIZING } from '../ranges/sizing';
import { buildHand, type ReviewHand } from './model';

export interface StepInfo {
  actor: number;
  action: Action;
  street: Street;
  /** Chance the model gave this action, given the actor's range before it. */
  likelihood: number;
}

export interface RangeSnapshot {
  /** Range per starting hand class, normalized to the largest (0..1). */
  classes: number[];
  mix: RangeMix | null;
  /** Share of all combos still in the range (weighted). */
  width: number;
}

export interface ReviewAnalysis {
  steps: StepInfo[];
  /** ranges[k][seat]: each opponent's range after the first k actions (null for the hero or folded seats). */
  ranges: (RangeSnapshot | null)[][];
  preflop: PreflopGrade[];
}

/** An action the model gives less than this chance is flagged as unusual. */
export const UNUSUAL = 0.03;

/** Replay a reviewed hand with the chosen player types and record ranges after every action. */
export function analyzeReview(review: ReviewHand, custom: CustomProfileSettings): ReviewAnalysis {
  const built = buildHand(review, 0);
  const hand = built.hand;
  const models = modelsFor(review.profiles, custom, 0);
  const runner = new HandRunner(hand, {
    heroIndex: 0,
    rng: { next: () => 0, int: () => 0 },
    policies: models.policies,
    observer: models.observer,
    sizing: DEFAULT_SIZING,
  });
  const hero = review.heroCards;
  const snapshot = (): (RangeSnapshot | null)[] =>
    hand.players.map((p, i) => {
      if (i === 0 || p.folded) return null;
      const w = runner.actual.ranges[i]!.slice();
      let total = 0;
      for (let c = 0; c < NUM_COMBOS; c++) {
        if (hero.includes(COMBO_A[c]!) || hero.includes(COMBO_B[c]!)) w[c] = 0;
        total += w[c]!;
      }
      const classes = Array.from(collapseToClasses(w));
      const max = Math.max(1e-9, ...classes);
      return {
        classes: classes.map((x) => x / max),
        mix: hand.board.length >= 3 ? rangeMix(hand, w) : null,
        width: total / NUM_COMBOS,
      };
    });

  const steps: StepInfo[] = [];
  const ranges: (RangeSnapshot | null)[][] = [snapshot()];
  const total = buildHand(review).applied;
  for (let k = 0; k < total; k++) {
    const action = review.actions[k]!;
    const actor = hand.toAct;
    const strategy = runner.currentStrategy;
    let likelihood = 1;
    if (strategy && actor !== 0) {
      const row = actionLikelihood(strategy, action);
      const w = runner.actual.ranges[actor]!;
      let num = 0;
      let den = 0;
      for (let c = 0; c < NUM_COMBOS; c++) {
        den += w[c]!;
        num += w[c]! * (row ? row[c]! : 0);
      }
      likelihood = den > 0 ? num / den : 0;
    }
    steps.push({ actor, action, street: hand.street, likelihood });
    runner.act(action);
    ranges.push(snapshot());
  }

  const preflop: PreflopGrade[] = [];
  for (const decision of runner.decisions) {
    const grade = gradePreflopDecision(decision, [hero[0]!, hero[1]!]);
    if (grade) preflop.push(grade);
  }
  return { steps, ranges, preflop };
}
