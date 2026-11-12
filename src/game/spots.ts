import type { Card } from '../engine/cards';
import type { Rng } from '../engine/rng';
import type { Action, PositionName } from '../engine/types';
import { COMBO_A, COMBO_B, COMBO_CLASS, NUM_COMBOS } from '../eval/combos';
import { CLASS_PERCENTILE } from '../ranges/handRanking';
import type { HandRunner } from './handRunner';

/**
 * Practice spots: each hand starts in a chosen preflop situation. Every player who acts in
 * the script is dealt a hand their own strategy would play that way, so ranges stay
 * realistic; the hand then continues normally.
 */

export type SpotKind = 'fold' | 'call' | 'raise';

export interface SpotStep {
  pos: PositionName;
  kind: SpotKind;
}

export interface SpotDef {
  id: string;
  hero: PositionName;
  /** Actions in table order; players not listed fold when their turn comes. */
  steps: SpotStep[];
}

export const SPOTS: SpotDef[] = [
  { id: 'bbVsBtn', hero: 'BB', steps: [{ pos: 'BTN', kind: 'raise' }] },
  { id: 'vsLimpers', hero: 'BTN', steps: [{ pos: 'UTG', kind: 'call' }, { pos: 'LJ', kind: 'call' }] },
  { id: 'squeeze', hero: 'BTN', steps: [{ pos: 'HJ', kind: 'raise' }, { pos: 'CO', kind: 'call' }] },
  { id: 'facing3bet', hero: 'CO', steps: [{ pos: 'CO', kind: 'raise' }, { pos: 'BTN', kind: 'raise' }] },
  { id: 'btnVsBb', hero: 'BTN', steps: [{ pos: 'BTN', kind: 'raise' }, { pos: 'BB', kind: 'call' }] },
  { id: 'coVsBtn', hero: 'CO', steps: [{ pos: 'CO', kind: 'raise' }, { pos: 'BTN', kind: 'call' }] },
  { id: 'bbVsCo', hero: 'BB', steps: [{ pos: 'CO', kind: 'raise' }, { pos: 'BB', kind: 'call' }] },
  { id: 'threeBetPot', hero: 'BTN', steps: [{ pos: 'CO', kind: 'raise' }, { pos: 'BTN', kind: 'raise' }, { pos: 'CO', kind: 'call' }] },
  {
    id: 'limpedPot',
    hero: 'BB',
    steps: [
      { pos: 'UTG', kind: 'call' },
      { pos: 'HJ', kind: 'call' },
      { pos: 'BTN', kind: 'call' },
      { pos: 'SB', kind: 'call' },
      { pos: 'BB', kind: 'call' },
    ],
  },
];

/** Hands outside the model's range for an action are drawn from this share of the best hands. */
const FALLBACK_TOP = 0.4;
/** Chance the hero gets any hand rather than one the baseline would continue with. */
const HERO_ANY_HAND = 0.2;

export function spotById(id: string): SpotDef | undefined {
  return SPOTS.find((s) => s.id === id);
}

/** True when every position the spot needs exists at this table size. */
export function spotFits(spot: SpotDef, positions: readonly PositionName[]): boolean {
  return positions.includes(spot.hero) && spot.steps.every((s) => positions.includes(s.pos));
}

function sampleCombo(weights: (c: number) => number, used: Set<Card>, rng: Rng): number {
  let total = 0;
  const w = new Float64Array(NUM_COMBOS);
  for (let c = 0; c < NUM_COMBOS; c++) {
    if (used.has(COMBO_A[c]!) || used.has(COMBO_B[c]!)) continue;
    const x = weights(c);
    w[c] = x;
    total += x;
  }
  if (total <= 0) {
    for (let c = 0; c < NUM_COMBOS; c++) {
      if (used.has(COMBO_A[c]!) || used.has(COMBO_B[c]!)) continue;
      w[c] = CLASS_PERCENTILE[COMBO_CLASS[c]!]! <= FALLBACK_TOP ? 1 : 0;
      total += w[c]!;
    }
  }
  let roll = rng.next() * total;
  for (let c = 0; c < NUM_COMBOS; c++) {
    roll -= w[c]!;
    if (roll < 0 && w[c]! > 0) return c;
  }
  for (let c = NUM_COMBOS - 1; c >= 0; c--) if (w[c]! > 0) return c;
  throw new Error('No cards left to deal');
}

/** Re-deal unassigned hole cards and the board from cards nobody holds yet. */
function redealRest(runner: HandRunner, assigned: Set<number>, rng: Rng): void {
  const hand = runner.hand;
  const used = new Set<Card>();
  for (const i of assigned) for (const c of hand.players[i]!.hole) used.add(c);
  const free: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) free.push(c);
  for (let i = free.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [free[i], free[j]] = [free[j]!, free[i]!];
  }
  hand.players.forEach((p, i) => {
    if (!assigned.has(i)) p.hole = [free.pop()!, free.pop()!];
  });
  for (let k = hand.board.length; k < 5; k++) hand.runout[k] = free.pop()!;
}

/**
 * Play the spot's script on a freshly dealt hand. Returns false when the hand cannot follow
 * the script (for example a short stack is all-in), in which case the caller deals normally.
 */
export function runSpot(runner: HandRunner, spot: SpotDef, heroIndex: number, rng: Rng): boolean {
  const hand = runner.hand;
  const assigned = new Set<number>();
  const used = (): Set<Card> => {
    const s = new Set<Card>();
    for (const i of assigned) for (const c of hand.players[i]!.hole) s.add(c);
    return s;
  };
  let step = 0;
  let guard = 0;
  while (step < spot.steps.length || hand.toAct !== heroIndex) {
    if (hand.isComplete || hand.street !== 'preflop' || ++guard > 40) break;
    const actor = hand.toAct;
    const position = hand.players[actor]!.position;
    const next = spot.steps[step];
    const scripted = next && next.pos === position;
    if (!scripted && actor === heroIndex) break;
    const kind: SpotKind = scripted ? next!.kind : 'fold';
    const strategy = runner.currentStrategy;
    const legal = runner.currentLegal;
    if (!strategy || !legal) return false;
    if (kind === 'raise' && !legal.canRaise) return false;

    let option = strategy.options.findIndex((o) =>
      kind === 'fold' ? o.kind === 'fold' : kind === 'call' ? o.kind === 'passive' : o.kind === 'aggressive',
    );
    let action: Action;
    if (option < 0) {
      if (kind === 'fold' && legal.canCheck) {
        action = { type: 'check' };
        option = strategy.options.findIndex((o) => o.kind === 'passive');
      } else return false;
    } else action = strategy.options[option]!.action;

    const row = strategy.probs[option]!;
    const combo = sampleCombo((c) => row[c]!, used(), rng);
    hand.players[actor]!.hole = [COMBO_A[combo]!, COMBO_B[combo]!];
    assigned.add(actor);
    redealRest(runner, assigned, rng);
    runner.act(action);
    if (scripted) step++;
  }
  if (step < spot.steps.length) return false;

  // Hero still to act before the flop: give a hand worth thinking about.
  if (!hand.isComplete && hand.street === 'preflop' && hand.toAct === heroIndex) {
    const strategy = runner.currentStrategy;
    if (strategy) {
      const fold = strategy.options.findIndex((o) => o.kind === 'fold');
      const anyHand = rng.next() < HERO_ANY_HAND;
      const combo = sampleCombo((c) => (anyHand || fold < 0 ? 1 : 1 - strategy.probs[fold]![c]!), used(), rng);
      hand.players[heroIndex]!.hole = [COMBO_A[combo]!, COMBO_B[combo]!];
      assigned.add(heroIndex);
      // Strategies cover whole ranges, so changing the hero's cards needs no recomputation.
      redealRest(runner, assigned, rng);
    }
  }
  return true;
}
