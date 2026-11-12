import { potTotal } from '../engine/hand';
import type { Chips } from '../engine/types';
import { NUM_COMBOS } from '../eval/combos';
import { roundToChip } from '../ranges/sizing';
import { boardFeatures } from './features';
import type { HumanParams } from './profiles';
import type { DecisionContext, DecisionOption, RangeStrategy } from './types';

/**
 * Human-style postflop play. The player judges a hand by its absolute strength (how many
 * possible hands it beats) and by its draws, not by the opponents' ranges, and follows
 * their tendencies: how often they bet strong and medium hands, bluff, and call.
 */

/** Absolute strength buckets (share of all hands beaten). */
const STRONG = 0.86;
const MONSTER = 0.965;
const MEDIUM = 0.62;
const AIR = 0.45;
const DRAW_MIN = 0.12;
const SHOVE_FRACTION = 0.65;

function ramp(x: number, edge: number, width: number): number {
  const t = (x - edge) / width + 0.5;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

export function humanPostflopStrategy(ctx: DecisionContext, params: HumanParams): RangeStrategy {
  const { view, actor, legal } = ctx;
  const table = ctx.table;
  if (!table) throw new Error('Postflop strategy needs a strength table');
  const { raw, draw } = boardFeatures(table);
  const street = view.street === 'flop' ? 0 : view.street === 'turn' ? 1 : 2;
  const pot = potTotal(view);
  const opponents = view.players.filter((p) => !p.folded && p.index !== actor).length;
  const multiway = opponents >= 2 ? (opponents >= 3 ? 0.45 : 0.7) : 1;
  const playable = table.order;

  const sizeTo = (desired: number): Chips => {
    let to = roundToChip(desired, view);
    if (to >= legal.maxRaiseTo * SHOVE_FRACTION) to = legal.maxRaiseTo;
    return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, to));
  };

  if (legal.canCheck) {
    const options: DecisionOption[] = [{ action: { type: 'check' }, kind: 'passive' }];
    let betAt = -1;
    if (legal.canRaise) {
      betAt = options.length;
      options.push({ action: { type: legal.raiseType, amount: sizeTo(pot * params.betSize) }, kind: 'aggressive' });
    }
    const probs = options.map(() => new Float32Array(NUM_COMBOS));
    const aggressor = view.prevStreetAggressor === actor;
    const cbetSpot = aggressor && street === 0;
    const bluffRate = (cbetSpot ? params.cbet : params.bluff * (street === 2 ? 0.7 : 1)) * multiway;
    for (let k = 0; k < playable.length; k++) {
      const i = playable[k]!;
      let pBet = 0;
      if (betAt >= 0) {
        const s = raw[i]!;
        if (s >= MONSTER) pBet = params.betStrong * (street === 0 ? 0.85 : 1);
        else if (s >= STRONG) pBet = params.betStrong;
        else if (s >= MEDIUM) pBet = params.betMedium * multiway * (cbetSpot ? 1.3 : 1);
        else if (street < 2 && draw[i]! >= DRAW_MIN) pBet = Math.min(0.9, (params.bluff * 1.6 + (cbetSpot ? params.cbet * 0.5 : 0)) * multiway);
        else pBet = s < AIR ? bluffRate : bluffRate * 0.6;
        pBet = Math.min(0.97, pBet);
        probs[betAt]![i] = pBet;
      }
      probs[0]![i] = 1 - pBet;
    }
    return { options, probs };
  }

  // Facing a bet.
  const toCall = legal.callAmount;
  const options: DecisionOption[] = [
    { action: { type: 'fold' }, kind: 'fold' },
    { action: { type: 'call' }, kind: 'passive' },
  ];
  let raiseAt = -1;
  if (legal.canRaise) {
    raiseAt = options.length;
    options.push({ action: { type: 'raise', amount: sizeTo(view.currentBet * 3 + pot * 0.15) }, kind: 'aggressive' });
  }
  const probs = options.map(() => new Float32Array(NUM_COMBOS));
  const potOdds = toCall / (pot + toCall);
  // Strength needed to call: higher for big bets and for players who do not like calling.
  const sizePressure = Math.pow(Math.min(1.8, potOdds / 0.25), 0.6);
  const threshold = 0.45 + (0.42 - 0.38 * params.sticky) * sizePressure + (street === 2 ? 0.03 : 0) + (opponents >= 2 ? 0.03 : 0);
  const allInCall = toCall >= view.players[actor]!.stack;

  for (let k = 0; k < playable.length; k++) {
    const i = playable[k]!;
    const s = raw[i]!;
    let pContinue = ramp(s, threshold, 0.06);
    if (street < 2 && !allInCall && draw[i]! >= DRAW_MIN && potOdds < draw[i]! + 0.08 + 0.2 * params.sticky) {
      pContinue = Math.max(pContinue, 0.9);
    }
    let pRaise = 0;
    if (raiseAt >= 0) {
      if (s >= MONSTER) pRaise = params.raiseStrong;
      else if (s >= STRONG) pRaise = params.raiseStrong * 0.35;
      else if (street === 0 && s < AIR && draw[i]! < DRAW_MIN) pRaise = params.bluff * 0.15;
      else if (street === 0 && draw[i]! >= DRAW_MIN) pRaise = params.bluff * 0.3;
      pContinue = Math.max(pContinue, pRaise);
    }
    probs[0]![i] = 1 - pContinue;
    probs[1]![i] = pContinue - pRaise;
    if (raiseAt >= 0) probs[raiseAt]![i] = pRaise;
  }
  return { options, probs };
}
