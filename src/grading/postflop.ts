import { baselinePolicy } from '../bots/baselinePolicy';
import { boardFeatures } from '../bots/features';
import { policyFor } from '../bots/policies';
import { makeProfile, type CustomProfileSettings, type ProfileId } from '../bots/profiles';
import type { Policy } from '../bots/types';
import type { Card } from '../engine/cards';
import { createHand, potTotal, type HandRecord } from '../engine/hand';
import type { Action, HandState, PositionName, Street } from '../engine/types';
import { COMBO_A, COMBO_B, collapseToClasses, comboIndex, NUM_COMBOS } from '../eval/combos';
import { evaluate } from '../eval/evaluator';
import { buildStrengthTable } from '../eval/strengthTable';
import { HandRunner } from '../game/handRunner';
import type { ChartSpec } from '../ranges/charts';
import { DEFAULT_SIZING, type SizingOptions } from '../ranges/sizing';
import { evaluateDecision, type EvalBudget } from './evaluator';

export type PostflopVerdict = 'best' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder';
export type OptionKind = 'fold' | 'passive' | 'aggressive';
export type Situation = 'first' | 'checkedTo' | 'facingBet' | 'facingRaise';

export interface OptionValue {
  action: Action;
  /** Expected value in chips from this decision on. */
  ev: number;
  se: number;
}

export interface RangeMix {
  /** Shares of the range (0..1). */
  strong: number;
  medium: number;
  draw: number;
  weak: number;
}

export interface VillainInfo {
  index: number;
  name: string;
  position: PositionName;
  profile: string;
  mix: RangeMix;
  /** Range per starting hand class (0..1, normalized to the largest). */
  classes: number[];
}

export interface PostflopGrade {
  street: Street;
  actionIndex: number;
  situation: Situation;
  board: Card[];
  pot: number;
  toCall: number;
  /** Stack-to-pot ratio against the deepest opponent still in. */
  spr: number;
  /** Baseline strategy frequencies for the hero's hand. */
  baseline: Record<OptionKind, number>;
  chosen: Action;
  chosenKind: OptionKind;
  values: OptionValue[];
  chosenIndex: number;
  bestIndex: number;
  /** EV given up compared with the best option, in chips (never negative). */
  loss: number;
  verdict: PostflopVerdict;
  /** True when every future card was enumerated. */
  exact: boolean;
  /** True when the gap is within the sampling error. */
  uncertain: boolean;
  /** True when later streets of a multiway pot were valued as checked down. */
  checkdown: boolean;
  /** Only one opponent is left (the solver can give a reference). */
  headsUp?: boolean;
  /** Hero's chance to win at showdown against the ranges, if the hand were checked down. */
  equity: number;
  /** Share of all ranges the hero needs to win to call (facing a bet). */
  potOdds: number | null;
  /** Minimum defence frequency against the bet (facing a bet). */
  mdf: number | null;
  villain: VillainInfo | null;
  /** 'actual': opponents' real types. 'observer': a generic live player for everyone. */
  model: 'actual' | 'observer';
  ms: number;
}

export interface GradingJob {
  record: HandRecord;
  heroIndex: number;
  /** Profile of each seat (the hero's entry is ignored). */
  profiles: string[];
  custom: CustomProfileSettings;
  /** Grade against the opponents' real types (true) or a generic player model (false). */
  useActualTypes: boolean;
  sizing?: SizingOptions;
  budget?: Partial<EvalBudget>;
  /** Only grade these action indices (all postflop hero decisions when omitted). */
  only?: number[];
  /** The user's preflop charts ("depth|key"), so ranges match the main thread. */
  chartOverrides?: Record<string, ChartSpec>;
}

function kindOf(action: Action): OptionKind {
  if (action.type === 'fold') return 'fold';
  if (action.type === 'check' || action.type === 'call') return 'passive';
  return 'aggressive';
}

function sameAction(a: Action, b: Action): boolean {
  if (kindOf(a) !== kindOf(b)) return false;
  if (kindOf(a) !== 'aggressive') return true;
  const x = a.amount ?? 0;
  const y = b.amount ?? 0;
  return Math.abs(x - y) <= Math.max(1, 0.06 * Math.max(x, y));
}

/** EV given up that still counts as each verdict: max(absolute big blinds, share of the pot). */
const THRESHOLDS: [PostflopVerdict, number, number][] = [
  ['best', 0.15, 0.02],
  ['ok', 0.6, 0.07],
  ['inaccuracy', 1.5, 0.15],
  ['mistake', 4, 0.35],
];

export function verdictFor(lossBB: number, potBB: number): PostflopVerdict {
  for (const [verdict, abs, rel] of THRESHOLDS) {
    if (lossBB <= Math.max(abs, rel * potBB)) return verdict;
  }
  return 'blunder';
}

export interface Models {
  policies: Policy[];
  observer: Policy;
}

/** Build seat strategies and the observer model from seat profiles. */
export function modelsFor(profiles: readonly string[], custom: CustomProfileSettings, heroIndex: number): Models {
  const policies = profiles.map((p, i) =>
    i === heroIndex ? baselinePolicy : policyFor(makeProfile((p as ProfileId) ?? 'population', custom)),
  );
  const allBaseline = profiles.every((p, i) => i === heroIndex || p === 'baseline');
  const observer = allBaseline ? baselinePolicy : policyFor(makeProfile('population', custom));
  return { policies, observer };
}

/** Hero's showdown equity against the opponents' ranges, averaged over future boards. */
export function equityVsRanges(hand: HandState, heroIndex: number, weights: readonly Float32Array[]): number {
  const hero = hand.players[heroIndex]!.hole;
  const board = hand.board;
  const dead = new Set<Card>([hero[0], hero[1], ...board]);
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) unseen.push(c);
  const boards: Card[][] = [];
  if (board.length === 5) boards.push(board.slice());
  else if (board.length === 4) for (const r of unseen) boards.push([...board, r]);
  else {
    // Flop: a fixed spread of turn and river pairs.
    for (let i = 0; i < unseen.length; i += 3) {
      for (let j = i + 1; j < unseen.length; j += 7) boards.push([...board, unseen[i]!, unseen[j]!]);
    }
  }
  const opponents = hand.players.filter((p) => !p.folded && p.index !== heroIndex).map((p) => p.index);
  let sum = 0;
  for (const full of boards) {
    const table = buildStrengthTable(full);
    const heroScore = evaluate([hero[0], hero[1], ...full]);
    let winAll = 1;
    let tieAll = 1;
    for (const j of opponents) {
      const w = weights[j]!;
      let total = 0;
      let win = 0;
      let tie = 0;
      for (let c = 0; c < NUM_COMBOS; c++) {
        const x = w[c]!;
        if (x <= 0) continue;
        const a = COMBO_A[c]!;
        const b = COMBO_B[c]!;
        if (a === hero[0] || a === hero[1] || b === hero[0] || b === hero[1]) continue;
        const s = table.scores[c]!;
        if (s < 0) continue;
        total += x;
        if (s < heroScore) win += x;
        else if (s === heroScore) tie += x;
      }
      if (total > 0) {
        winAll *= win / total;
        tieAll *= (win + tie) / total;
      }
    }
    sum += winAll + 0.5 * (tieAll - winAll);
  }
  return boards.length > 0 ? sum / boards.length : 0;
}

/** Composition of a range on the current board: strong, medium, draws, weak. */
export function rangeMix(hand: HandState, weights: Float32Array): RangeMix {
  const table = buildStrengthTable(hand.board);
  const { raw, draw } = boardFeatures(table);
  const mix = { strong: 0, medium: 0, draw: 0, weak: 0 };
  let total = 0;
  for (let c = 0; c < NUM_COMBOS; c++) {
    const w = weights[c]!;
    if (w <= 0 || table.scores[c]! < 0) continue;
    total += w;
    const s = raw[c]!;
    if (s >= 0.86) mix.strong += w;
    else if (s >= 0.62) mix.medium += w;
    else if (hand.board.length < 5 && draw[c]! >= 0.12) mix.draw += w;
    else mix.weak += w;
  }
  if (total > 0) {
    mix.strong /= total;
    mix.medium /= total;
    mix.draw /= total;
    mix.weak /= total;
  }
  return mix;
}

/** The opponent whose range matters most for the hero's decision. */
function mainVillain(hand: HandState, heroIndex: number): number {
  const live = hand.players.filter((p) => !p.folded && p.index !== heroIndex);
  if (live.length === 0) return -1;
  if (hand.lastAggressor >= 0 && hand.lastAggressor !== heroIndex && !hand.players[hand.lastAggressor]!.folded) {
    return hand.lastAggressor;
  }
  if (hand.prevStreetAggressor >= 0 && hand.prevStreetAggressor !== heroIndex && !hand.players[hand.prevStreetAggressor]!.folded) {
    return hand.prevStreetAggressor;
  }
  return live.reduce((a, b) => (b.totalContributed > a.totalContributed ? b : a)).index;
}

function situationOf(hand: HandState, heroIndex: number): Situation {
  if (hand.currentBet > hand.players[heroIndex]!.betThisStreet) {
    let aggressive = 0;
    for (const e of hand.events) {
      if (e.kind === 'action' && e.street === hand.street && (e.type === 'bet' || e.type === 'raise')) aggressive++;
    }
    return aggressive >= 2 ? 'facingRaise' : 'facingBet';
  }
  for (const e of hand.events) {
    if (e.kind === 'action' && e.street === hand.street) return 'checkedTo';
  }
  return 'first';
}

/** Grade every postflop decision of the hero in a recorded hand. */
export function gradePostflop(job: GradingJob, onGrade?: (grade: PostflopGrade) => void): PostflopGrade[] {
  const { record, heroIndex } = job;
  const sizing = job.sizing ?? DEFAULT_SIZING;
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
    sizing,
  });
  const grades: PostflopGrade[] = [];

  record.actions.forEach((action, index) => {
    if (hand.isComplete) return;
    const wanted = job.only ? job.only.includes(index) : true;
    if (hand.toAct === heroIndex && hand.street !== 'preflop' && wanted) {
      const grade = gradeDecision(runner, action, index, job, models, sizing);
      if (grade) {
        grades.push(grade);
        onGrade?.(grade);
      }
    }
    runner.act(action);
  });
  return grades;
}

function gradeDecision(
  runner: HandRunner,
  chosen: Action,
  actionIndex: number,
  job: GradingJob,
  models: Models,
  sizing: SizingOptions,
): PostflopGrade | null {
  const hand = runner.hand;
  const heroIndex = job.heroIndex;
  const strategy = runner.baselineStrategy;
  const legal = runner.currentLegal;
  if (!strategy || !legal) return null;
  const hero = hand.players[heroIndex]!;
  const combo = comboIndex(hero.hole[0], hero.hole[1]);
  const weights = job.useActualTypes ? runner.actual.ranges : runner.beliefs.ranges;

  const baseline: Record<OptionKind, number> = { fold: 0, passive: 0, aggressive: 0 };
  strategy.options.forEach((o, i) => {
    baseline[o.kind] += strategy.probs[i]![combo]!;
  });

  const candidates: Action[] = strategy.options.map((o) => o.action);
  let chosenIndex = candidates.findIndex((a) => sameAction(a, chosen));
  if (chosenIndex < 0) {
    candidates.push(chosen);
    chosenIndex = candidates.length - 1;
  }

  const result = evaluateDecision({
    hand,
    heroIndex,
    beliefs: runner.beliefs.ranges,
    weights,
    candidates,
    model: { policies: models.policies, observer: models.observer, sizing },
    budget: job.budget,
    seed: hand.handId * 7919 + actionIndex,
  });
  const values: OptionValue[] = result.values.map((v) => ({ action: v.action, ev: v.ev, se: v.se }));
  let bestIndex = 0;
  values.forEach((v, i) => {
    if (v.ev > values[bestIndex]!.ev) bestIndex = i;
  });
  const loss = Math.max(0, values[bestIndex]!.ev - values[chosenIndex]!.ev);
  const bb = hand.config.bigBlind;
  const pot = potTotal(hand);
  const noise = Math.hypot(values[bestIndex]!.se, values[chosenIndex]!.se);
  let verdict = verdictFor(loss / bb, pot / bb);
  const uncertain = !result.exact && loss > 0 && loss < 2 * noise;
  if (uncertain && verdict !== 'best') verdict = 'ok';

  let deepest = 0;
  for (const p of hand.players) {
    if (p.index !== heroIndex && !p.folded) deepest = Math.max(deepest, p.stack);
  }
  const toCall = legal.callAmount;
  const villainIndex = mainVillain(hand, heroIndex);
  let villain: VillainInfo | null = null;
  if (villainIndex >= 0) {
    const w = weights[villainIndex]!.slice();
    const [a, b] = hero.hole;
    for (let c = 0; c < NUM_COMBOS; c++) {
      if (COMBO_A[c] === a || COMBO_A[c] === b || COMBO_B[c] === a || COMBO_B[c] === b) w[c] = 0;
    }
    const classes = Array.from(collapseToClasses(w));
    const max = Math.max(1e-9, ...classes);
    const p = hand.players[villainIndex]!;
    villain = {
      index: villainIndex,
      name: p.name,
      position: p.position,
      profile: job.profiles[villainIndex] ?? 'population',
      mix: rangeMix(hand, w),
      classes: classes.map((x) => Math.round((x / max) * 1000) / 1000),
    };
  }

  return {
    street: hand.street,
    actionIndex,
    situation: situationOf(hand, heroIndex),
    board: hand.board.slice(),
    pot,
    toCall,
    spr: pot > 0 ? Math.min(hero.stack, deepest) / pot : 0,
    baseline,
    chosen,
    chosenKind: kindOf(chosen),
    values,
    chosenIndex,
    bestIndex,
    loss,
    verdict,
    exact: result.exact,
    uncertain,
    checkdown: result.checkdown,
    headsUp: hand.players.filter((p) => !p.folded).length === 2,
    equity: equityVsRanges(hand, heroIndex, weights),
    potOdds: toCall > 0 ? toCall / (pot + toCall) : null,
    mdf: toCall > 0 ? (pot - toCall) / pot : null,
    villain,
    model: job.useActualTypes ? 'actual' : 'observer',
    ms: result.ms,
  };
}
