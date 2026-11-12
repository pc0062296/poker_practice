import type { PositionName } from '../engine/types';
import { COMBO_CLASS, NUM_COMBOS } from '../eval/combos';
import { NUM_CLASSES } from '../eval/handClass';
import { CLASS_PERCENTILE } from '../ranges/handRanking';
import { analyzePreflop } from '../ranges/scenario';
import { clampRaise } from '../ranges/sizing';
import { callOffTier, CLASS_TIER } from '../ranges/tiers';
import type { HumanParams } from './profiles';
import type { DecisionContext, DecisionOption, RangeStrategy } from './types';

/** First-in playing width by position for a solid regular (share of all hands). */
const FIRST_IN_WIDTH: Record<PositionName, number> = {
  UTG: 0.12,
  'UTG+1': 0.13,
  'UTG+2': 0.15,
  LJ: 0.18,
  HJ: 0.22,
  CO: 0.28,
  BTN: 0.42,
  SB: 0.36,
  BB: 0.36,
};
const POSITION_BLIND_WIDTH = 0.22;

/** Width of calls against a single raise for a solid regular, by position. */
const CALL_WIDTH: Record<PositionName, number> = {
  UTG: 0.03,
  'UTG+1': 0.035,
  'UTG+2': 0.04,
  LJ: 0.045,
  HJ: 0.05,
  CO: 0.065,
  BTN: 0.1,
  SB: 0.04,
  BB: 0.2,
};

/** Hands within this many widths of a range edge are mixed rather than all-or-nothing. */
const EDGE = 0.15;

/** Probability that a hand at percentile `p` is inside a range of width `w`. */
function inRange(p: number, w: number): number {
  if (w <= 0) return 0;
  if (w >= 1) return 1;
  const band = EDGE * w + 0.008;
  const x = (w - p) / band + 0.5;
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

function positionWidth(table: Record<PositionName, number>, position: PositionName, sense: number): number {
  const average = table === FIRST_IN_WIDTH ? POSITION_BLIND_WIDTH : 0.07;
  return sense * table[position] + (1 - sense) * average;
}

/** Human-style preflop play: ranges from a fixed hand ordering, shaped by the player's tendencies. */
export function humanPreflopStrategy(ctx: DecisionContext, params: HumanParams): RangeStrategy {
  const { view, actor, legal } = ctx;
  const sit = analyzePreflop(view, actor);
  const me = view.players[actor]!;
  const position = view.straddleIndex === actor ? 'BB' : me.position;
  const level = sit.level;
  const L = params.looseness;

  const options: DecisionOption[] = [];
  let foldAt = -1;
  let raiseAt = -1;
  if (!legal.canCheck) {
    foldAt = options.length;
    options.push({ action: { type: 'fold' }, kind: 'fold' });
  }
  const passiveAt = options.length;
  options.push({ action: { type: legal.canCheck ? 'check' : 'call' }, kind: 'passive' });

  // Raise size.
  let raiseTo = 0;
  if (legal.canRaise) {
    let desired: number;
    if (sit.raises === 0) desired = (params.openSize + sit.limpers.length) * level;
    else if (sit.raises === 1) desired = sit.lastRaiseTo * (3 + sit.callers.length);
    else desired = sit.lastRaiseTo * 2.3;
    raiseTo = clampRaise(desired, legal, view);
    raiseAt = options.length;
    options.push({ action: { type: 'raise', amount: raiseTo }, kind: 'aggressive' });
  }

  const firstIn = Math.min(0.95, positionWidth(FIRST_IN_WIDTH, position, params.positionSense) * L);
  const pRaise = new Float32Array(NUM_CLASSES);
  const pCall = new Float32Array(NUM_CLASSES);

  for (let k = 0; k < NUM_CLASSES; k++) {
    const p = CLASS_PERCENTILE[k]!;
    let r = 0;
    let c = 0;
    if (sit.raises === 0) {
      if (sit.limpers.length === 0 && !legal.canCheck) {
        // First in.
        const play = inRange(p, firstIn);
        const premium = p < 0.035 ? 0.7 : 0;
        const raiseShare = params.raiseFirstIn + (1 - params.raiseFirstIn) * premium;
        const limpShare = position === 'SB' ? Math.max(1 - raiseShare, 0.4 * (1 - params.raiseFirstIn)) : 1 - raiseShare;
        r = play * raiseShare;
        c = play * Math.min(limpShare, 1 - raiseShare);
      } else if (legal.canCheck) {
        // Big blind (or straddler) with only limpers: raise strong hands, otherwise check.
        const iso = firstIn * (0.25 + 0.35 * params.raiseFirstIn) * 0.6;
        r = inRange(p, iso);
      } else {
        // Limpers in front: isolate, limp behind, or fold.
        const iso = firstIn * (0.25 + 0.45 * params.raiseFirstIn);
        const play = inRange(p, Math.min(0.95, firstIn * (1.1 + 0.1 * sit.limpers.length) * (position === 'SB' ? 1.6 : 1)));
        r = inRange(p, iso);
        c = Math.max(0, play - r);
      }
    } else if (sit.raises === 1) {
      const raiseLevels = sit.lastRaiseTo / level;
      const price = Math.pow(3 / Math.max(2, raiseLevels), 0.8);
      if (sit.actorLimped) {
        // Limped, then someone raised.
        r = inRange(p, 0.03);
        c = Math.max(0, inRange(p, firstIn * 0.6 * price) - r);
      } else {
        const lateBonus = position === 'BTN' || position === 'SB' || position === 'BB' ? 1.3 : 1;
        const tb = params.threeBet * lateBonus * (sit.callers.length > 0 ? 0.7 : 1);
        const cw =
          positionWidth(CALL_WIDTH, position, params.positionSense) * L * price * (sit.callers.length > 0 ? 1.15 : 1);
        r = inRange(p, tb);
        c = Math.max(0, inRange(p, Math.min(0.9, tb + cw)) - r);
      }
    } else if (sit.raises === 2) {
      if (sit.actorRaises.includes(1)) {
        // Opened and got 3-bet: continue with the top of the opening range.
        const cont = firstIn * params.continueVs3bet;
        const fourBet = cont * (0.15 + 0.35 * params.raiseFirstIn * Math.min(1, params.threeBet * 8));
        r = inRange(p, fourBet);
        c = Math.max(0, inRange(p, cont) - r);
      } else {
        r = inRange(p, 0.012);
        c = Math.max(0, inRange(p, 0.012 + 0.02 * L) - r);
      }
    } else if (sit.raises === 3) {
      r = inRange(p, 0.012);
      c = Math.max(0, inRange(p, 0.012 + 0.015 + 0.02 * params.sticky) - r);
    } else {
      c = inRange(p, 0.015 + 0.015 * params.sticky);
    }
    pRaise[k] = r;
    pCall[k] = c;
  }

  // Big commitments: only hands strong enough for the amount at risk continue.
  if (legal.callAmount > 0 && legal.callAmount >= me.stack * 0.35) {
    const risk = (me.totalContributed + legal.callAmount) / level;
    const allowed = callOffTier(risk) + (params.sticky > 0.6 ? 1 : 0) + (L > 1.8 ? 1 : 0);
    for (let k = 0; k < NUM_CLASSES; k++) {
      if (CLASS_TIER[k]! > allowed) {
        pRaise[k] = 0;
        pCall[k] = 0;
      }
    }
  }

  const probs = options.map(() => new Float32Array(NUM_COMBOS));
  for (let i = 0; i < NUM_COMBOS; i++) {
    const k = COMBO_CLASS[i]!;
    let r = pRaise[k]!;
    let c = pCall[k]!;
    if (raiseAt < 0) {
      c = Math.min(1, c + r);
      r = 0;
    }
    if (foldAt < 0) c = 1 - r;
    if (raiseAt >= 0) probs[raiseAt]![i] = r;
    probs[passiveAt]![i] = c;
    if (foldAt >= 0) probs[foldAt]![i] = Math.max(0, 1 - r - c);
  }
  return { options, probs };
}

