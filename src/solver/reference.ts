import { createHand, potTotal } from '../engine/hand';
import { postflopOrder } from '../engine/positions';
import type { Action, Street } from '../engine/types';
import { comboIndex, NUM_COMBOS } from '../eval/combos';
import { HandRunner } from '../game/handRunner';
import { modelsFor, type GradingJob } from '../grading/postflop';
import { DEFAULT_SIZING } from '../ranges/sizing';
import { RIVER_ITERATIONS, solve, TURN_ITERATIONS } from './solver';

export interface SolveJob extends GradingJob {
  /** Index of the hero's action to solve (the decision before it). */
  actionIndex: number;
}

export interface SolverReference {
  street: Street;
  actions: Action[];
  /** Equilibrium frequency of each action for the hero's actual hand. */
  hand: number[];
  /** Frequency of each action over the hero's whole (public) range. */
  range: number[];
  exploitability: number;
  iterations: number;
  ms: number;
}

/**
 * Solve the hero's heads-up turn or river decision with the solver. The hero's range is what
 * the table can infer from the hero's actions; the opponent's range follows the grading model.
 * Returns null when the spot is not a heads-up turn or river decision.
 */
export function solveReference(job: SolveJob): SolverReference | null {
  const { record, heroIndex } = job;
  const hand = createHand({
    handId: record.handId,
    config: record.config,
    seats: record.seats,
    buttonIndex: record.buttonIndex,
    rng: { next: () => 0, int: () => 0 },
    holeCards: record.holeCards,
    board: record.runout,
  });
  const models = modelsFor(job.profiles, job.custom, heroIndex);
  const runner = new HandRunner(hand, {
    heroIndex,
    rng: { next: () => 0, int: () => 0 },
    policies: models.policies,
    observer: models.observer,
    sizing: job.sizing ?? DEFAULT_SIZING,
  });
  for (let k = 0; k < job.actionIndex && k < record.actions.length; k++) runner.act(record.actions[k]!);
  if (hand.isComplete || hand.toAct !== heroIndex || (hand.street !== 'turn' && hand.street !== 'river')) return null;
  const live = hand.players.filter((p) => !p.folded);
  if (live.length !== 2) return null;
  const villain = live.find((p) => p.index !== heroIndex)!.index;
  const n = hand.players.length;
  const heroFirst = postflopOrder(n, hand.buttonIndex, heroIndex) < postflopOrder(n, hand.buttonIndex, villain);
  const [oop, ip] = heroFirst ? [heroIndex, villain] : [villain, heroIndex];
  const villainRange = (job.useActualTypes ? runner.actual : runner.beliefs).ranges[villain]!;
  const heroRange = runner.beliefs.ranges[heroIndex]!;
  const rangeOf = (i: number) => (i === heroIndex ? heroRange : villainRange);
  let raises = 0;
  for (const e of hand.events) {
    if (e.kind === 'action' && e.street === hand.street && (e.type === 'bet' || e.type === 'raise')) raises++;
  }
  const p = (i: number) => hand.players[i]!;
  const heroSeat = heroFirst ? 0 : 1;
  const result = solve(
    {
      board: hand.board.slice(),
      ranges: [rangeOf(oop), rangeOf(ip)],
      pot: potTotal(hand),
      stacks: [p(oop).stack, p(ip).stack],
      bets: [p(oop).betThisStreet, p(ip).betThisStreet],
      toAct: heroSeat as 0 | 1,
      raises,
      otherActed: p(villain).hasActed,
    },
    hand.street === 'river' ? RIVER_ITERATIONS : TURN_ITERATIONS,
  );
  const hole = p(heroIndex).hole;
  const combo = comboIndex(hole[0], hole[1]);
  // Combos that share a card with the board are not in the solved range (all-zero rows).
  let mass = 0;
  const range = result.actions.map(() => 0);
  for (let c = 0; c < NUM_COMBOS; c++) {
    const w = heroRange[c]!;
    if (w <= 0) continue;
    let total = 0;
    for (const pr of result.probs) total += pr[c]!;
    if (total <= 0) continue;
    mass += w;
    result.probs.forEach((pr, a) => (range[a]! += w * pr[c]!));
  }
  return {
    street: hand.street,
    actions: result.actions.map((a) =>
      a.type === 'bet' || a.type === 'raise' ? { type: a.type, amount: a.to } : { type: a.type },
    ),
    hand: result.probs.map((pr) => pr[combo]!),
    range: range.map((x) => (mass > 0 ? x / mass : 0)),
    exploitability: result.exploitability,
    iterations: result.iterations,
    ms: result.ms,
  };
}
