import { potTotal } from '../engine/hand';
import { postflopOrder } from '../engine/positions';
import type { Chips, PublicView } from '../engine/types';
import { NUM_COMBOS } from '../eval/combos';
import { beatFractions } from '../eval/strengthTable';
import { boardFeatures } from './features';
import { roundToChip } from '../ranges/sizing';
import type { DecisionContext, DecisionOption, RangeStrategy } from './types';

/**
 * Baseline postflop strategy (rule based, not a solver).
 *
 * Each combo is judged on three numbers:
 *   v   chance it currently beats every opponent's estimated range
 *   pct its rank inside the actor's own range (0 = bottom, 1 = top)
 *   d   chance its draw completes
 * Value bets, semi-bluffs and pure bluffs are sized so the bluff share roughly matches
 * the price the bet lays; calls use pot odds, with minimum-defence frequency deciding
 * the close ones so the range cannot be run over by frequent betting.
 */

/** Index by street: flop, turn, river. */
const VALUE_BET = [0.58, 0.62, 0.66];
const VALUE_RAISE = [0.86, 0.88, 0.92];
const VALUE_RAISE_FREQ = [0.5, 0.45, 0.6];
const BLUFF_STREET_MULT = [1.9, 1.3, 1.0];
const SMALL_BET = [0.33, 0.5, 0.4];
const BIG_BET = [0.66, 0.75, 0.8];
/** Chance a made hand that is ahead now gets outdrawn by the river. */
const OUTDRAWN = [0.14, 0.08, 0];
/** Chance a hand that is behind and has no named draw still improves. */
const BASE_IMPROVE = [0.05, 0.03, 0];
/** Extra equity needed to call with a made hand (more bets may follow). */
const CALL_MARGIN = [0.03, 0.04, 0];
/** Discount for draws: they win more than the pot when they hit. */
const DRAW_MARGIN = [-0.05, -0.02, 0];
const MULTIWAY = [1, 0.6, 0.3];

const AIR_BELOW = 0.33;
const DRAW_MIN = 0.12;
const STRONG_DRAW = 0.27;
/** Width of the zone above the break-even price where calls are still thinned out. */
const CALL_BAND = 0.05;
/** Width of the zone below the break-even price where the top of the range still defends. */
const DEFEND_BAND = 0.15;
/** A bet or raise that uses at least this share of the stack becomes an all-in. */
const SHOVE_FRACTION = 0.65;

/** Scratch buffers reused between calls (strategies are computed one at a time). */
const V = new Float32Array(NUM_COMBOS);
const TMP = new Float32Array(NUM_COMBOS);
const PCT = new Float32Array(NUM_COMBOS);
const P_BET = new Float32Array(NUM_COMBOS);
const BIG_SHARE = new Float32Array(NUM_COMBOS);

function streetIndex(view: PublicView): number {
  return view.street === 'flop' ? 0 : view.street === 'turn' ? 1 : 2;
}

export function postflopStrategy(ctx: DecisionContext): RangeStrategy {
  const { view, actor, legal, ranges } = ctx;
  const table = ctx.table;
  if (!table) throw new Error('Postflop strategy needs a strength table');
  const si = streetIndex(view);
  const n = view.players.length;
  const pot = potTotal(view);
  const own = ranges[actor]!;

  const opponents = view.players.filter((p) => !p.folded && p.index !== actor);
  const nOpp = Math.max(1, opponents.length);
  const multiway = MULTIWAY[Math.min(nOpp, 3) - 1]!;

  // v: chance to be ahead of everyone right now.
  const v = V.fill(1);
  for (const o of opponents) {
    beatFractions(table, ranges[o.index]!, TMP);
    for (let i = 0; i < NUM_COMBOS; i++) v[i]! *= TMP[i]!;
  }
  const pct = beatFractions(table, own, PCT);
  const d = boardFeatures(table).draw;
  const playable = table.order;

  const sizeTo = (desired: number): Chips => {
    let to = roundToChip(desired, view);
    if (to >= legal.maxRaiseTo * SHOVE_FRACTION) to = legal.maxRaiseTo;
    return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, to));
  };

  if (legal.canCheck) {
    // ---- Nobody has bet: check, bet small, or bet big ----
    const options: DecisionOption[] = [{ action: { type: 'check' }, kind: 'passive' }];
    let smallAt = -1;
    let bigAt = -1;
    if (legal.canRaise) {
      const small = sizeTo(pot * SMALL_BET[si]!);
      const big = sizeTo(pot * BIG_BET[si]!);
      smallAt = options.length;
      options.push({ action: { type: legal.raiseType, amount: small }, kind: 'aggressive' });
      if (big > small) {
        bigAt = options.length;
        options.push({ action: { type: legal.raiseType, amount: big }, kind: 'aggressive' });
      }
    }
    const probs = options.map(() => new Float32Array(NUM_COMBOS));
    if (smallAt < 0) {
      for (let k = 0; k < playable.length; k++) probs[0]![playable[k]!] = 1;
      return { options, probs };
    }

    // Who has the betting lead? The previous street's aggressor, or anyone when it was checked through.
    const aggressor = view.prevStreetAggressor;
    const aggressorLive = aggressor >= 0 && !view.players[aggressor]!.folded;
    const isAggressor = aggressor === actor;
    const noInitiative = !aggressorLive;
    let inPosition = true;
    const myOrder = postflopOrder(n, view.buttonIndex, actor);
    for (const o of opponents) {
      if (!o.allIn && postflopOrder(n, view.buttonIndex, o.index) > myOrder) inPosition = false;
    }
    const lead = isAggressor || noInitiative ? 1 : inPosition ? 0.9 : 0.25;
    const bluffLead = isAggressor ? 1 : noInitiative ? 0.8 : inPosition ? 0.7 : 0.3;

    const valueLine = VALUE_BET[si]! + 0.02 * (nOpp - 1);
    const pBet = P_BET.fill(0);
    const bigShare = BIG_SHARE.fill(0);
    let valueMass = 0;
    let semiMass = 0;
    let airMass = 0;
    for (let k = 0; k < playable.length; k++) {
      const i = playable[k]!;
      const w = own[i]!;
      if (v[i]! >= valueLine) {
        pBet[i] = Math.min(0.95, 0.85 * lead);
        bigShare[i] = v[i]! >= 0.85 ? (si === 2 ? 0.8 : 0.65) : si === 2 ? 0.25 : 0.3;
        valueMass += w * pBet[i]!;
      } else if (d[i]! >= DRAW_MIN) {
        pBet[i] = Math.min(0.9, 0.5 * lead * multiway * (d[i]! >= STRONG_DRAW ? 1.2 : 1));
        bigShare[i] = 0.5;
        semiMass += w * pBet[i]!;
      } else if (v[i]! < AIR_BELOW) {
        airMass += w;
      } else if (si < 2 && nOpp === 1 && lead >= 0.9) {
        // Medium-strength hands mostly check; a small bet now and then for protection.
        pBet[i] = 0.15;
        bigShare[i] = 0;
      }
    }

    // Pure bluffs: enough to keep the betting range from being all value, no more.
    const avgSize = (SMALL_BET[si]! + BIG_BET[si]!) / 2;
    const ratio = avgSize / (1 + avgSize);
    const target = valueMass * ratio * BLUFF_STREET_MULT[si]! * multiway * bluffLead - semiMass;
    const pBluff = airMass > 0 ? Math.max(0, Math.min(0.85, target / airMass)) : 0;
    const bluffBig = si === 2 ? 0.7 : 0.4;

    for (let k = 0; k < playable.length; k++) {
      const i = playable[k]!;
      let p = pBet[i]!;
      let share = bigShare[i]!;
      if (p === 0 && v[i]! < AIR_BELOW && d[i]! < DRAW_MIN) {
        p = pBluff;
        share = bluffBig;
      }
      if (bigAt < 0) share = 0;
      probs[0]![i] = 1 - p;
      probs[smallAt]![i] = p * (1 - share);
      if (bigAt >= 0) probs[bigAt]![i] = p * share;
    }
    return { options, probs };
  }

  // ---- Facing a bet: fold, call, or raise ----
  const toCall = legal.callAmount;
  const options: DecisionOption[] = [
    { action: { type: 'fold' }, kind: 'fold' },
    { action: { type: 'call' }, kind: 'passive' },
  ];
  let raiseAt = -1;
  if (legal.canRaise) {
    raiseAt = options.length;
    const to = sizeTo(view.currentBet + 0.7 * (pot + toCall));
    options.push({ action: { type: 'raise', amount: to }, kind: 'aggressive' });
  }
  const probs = options.map(() => new Float32Array(NUM_COMBOS));

  const potOdds = toCall / (pot + toCall);
  // Share of the range that may fold before a pure bluff shows a profit.
  const alpha = Math.min(0.99, toCall / pot);
  let responders = 0;
  let canBetLater = false;
  for (const p of view.players) {
    if (p.folded || p.allIn) continue;
    if (p.betThisStreet < view.currentBet) responders++;
    if (p.index !== actor) canBetLater = true;
  }
  const foldShare = Math.pow(alpha, 1 / Math.max(1, responders));
  // With everyone else all-in there is no more betting, so no margin is needed.
  const moreBetting = canBetLater && si < 2;

  for (let k = 0; k < playable.length; k++) {
    const i = playable[k]!;
    const draw = d[i]!;
    const equity = v[i]! * (1 - OUTDRAWN[si]!) + (1 - v[i]!) * Math.max(draw, BASE_IMPROVE[si]!);
    const margin = moreBetting ? (draw >= DRAW_MIN ? DRAW_MARGIN[si]! : CALL_MARGIN[si]!) : 0;
    const edge = equity - (potOdds + margin);

    let pContinue: number;
    if (edge >= CALL_BAND) pContinue = 1;
    else if (edge <= -DEFEND_BAND) pContinue = 0;
    else {
      // Close decision: the stronger part of the range continues, the weaker part folds.
      const cut =
        edge >= 0
          ? foldShare * (1 - edge / CALL_BAND)
          : foldShare + (1 - foldShare) * (-edge / DEFEND_BAND);
      pContinue = pct[i]! >= cut ? 1 : 0;
    }

    let pRaise = 0;
    if (raiseAt >= 0 && pContinue > 0) {
      if (v[i]! >= VALUE_RAISE[si]!) pRaise = VALUE_RAISE_FREQ[si]!;
      else if (si === 0 && nOpp === 1 && draw >= STRONG_DRAW) pRaise = 0.12;
    }
    probs[0]![i] = 1 - pContinue;
    probs[1]![i] = pContinue * (1 - pRaise);
    if (raiseAt >= 0) probs[raiseAt]![i] = pContinue * pRaise;
  }
  return { options, probs };
}
