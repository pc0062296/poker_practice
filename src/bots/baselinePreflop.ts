import { COMBO_CLASS, NUM_COMBOS } from '../eval/combos';
import { NUM_CLASSES } from '../eval/handClass';
import { classifyPreflop } from '../ranges/scenario';
import { standardPreflopRaiseTo } from '../ranges/sizing';
import { callOffTier, CLASS_TIER } from '../ranges/tiers';
import type { DecisionContext, DecisionOption, RangeStrategy } from './types';

/** Largest call (in blind levels) that the charts still describe, by number of raises faced. */
const STANDARD_CALL_LIMIT = [1.5, 6.5, 20, 45];
/** Calling at least this share of the remaining stack is treated as a stack-off decision. */
const COMMIT_SHARE = 0.35;

/** Raise and call tiers used when no chart covers the spot, by number of raises faced. */
const FALLBACK_RAISE_TIER = [3, 1, 0, -1];
const FALLBACK_CALL_TIER = [6, 5, 2, 1];

/**
 * Baseline preflop strategy: look the spot up in the range charts. When the price is
 * far from what the charts assume (a huge raise, an all-in, a short stack), only hands
 * strong enough for the amount at risk continue.
 */
export function preflopStrategy(ctx: DecisionContext): RangeStrategy {
  const { view, actor, legal } = ctx;
  const scenario = classifyPreflop(view, actor);
  const sit = scenario.situation;
  const me = view.players[actor]!;
  const toCall = legal.callAmount;

  const options: DecisionOption[] = [];
  let foldAt = -1;
  let raiseAt = -1;
  if (!legal.canCheck) {
    foldAt = options.length;
    options.push({ action: { type: 'fold' }, kind: 'fold' });
  }
  const passiveAt = options.length;
  options.push({ action: { type: legal.canCheck ? 'check' : 'call' }, kind: 'passive' });
  if (legal.canRaise) {
    raiseAt = options.length;
    const to = standardPreflopRaiseTo(view, actor, scenario, legal, ctx.sizing);
    options.push({ action: { type: 'raise', amount: to }, kind: 'aggressive' });
  }

  const raise = new Float32Array(NUM_CLASSES);
  const call = new Float32Array(NUM_CLASSES);
  const raisesFaced = Math.min(sit.raises, 3);
  if (scenario.chart) {
    raise.set(scenario.chart.raise);
    call.set(scenario.chart.call);
  } else {
    const raiseTier = FALLBACK_RAISE_TIER[raisesFaced]!;
    const callTier = FALLBACK_CALL_TIER[raisesFaced]!;
    for (let k = 0; k < NUM_CLASSES; k++) {
      const tier = CLASS_TIER[k]!;
      if (tier <= raiseTier) raise[k] = 1;
      else if (tier <= callTier) call[k] = 1;
    }
  }

  // Price check: big raises and stack-off decisions need hands that fit the amount at risk.
  let adjusted = false;
  if (toCall > 0) {
    const callLevels = toCall / sit.level;
    const oversized = callLevels > STANDARD_CALL_LIMIT[raisesFaced]!;
    const committing = toCall >= me.stack * COMMIT_SHARE;
    if (oversized || committing) {
      adjusted = true;
      const riskLevels = (me.totalContributed + toCall) / sit.level;
      const allowed = callOffTier(riskLevels);
      for (let k = 0; k < NUM_CLASSES; k++) {
        const tier = CLASS_TIER[k]!;
        if (tier > allowed) {
          raise[k] = 0;
          call[k] = 0;
        } else if (tier < allowed) {
          // Clearly strong enough: never fold.
          call[k] = 1 - raise[k]!;
        }
      }
    }
  }

  const probs = options.map(() => new Float32Array(NUM_COMBOS));
  for (let i = 0; i < NUM_COMBOS; i++) {
    const k = COMBO_CLASS[i]!;
    let pRaise = raise[k]!;
    let pCall = call[k]!;
    if (raiseAt < 0) {
      // Cannot raise (facing an all-in): hands that wanted to raise call instead.
      pCall = Math.min(1, pCall + pRaise);
      pRaise = 0;
    }
    if (foldAt < 0) {
      // Checking is free, so nothing folds.
      pCall = 1 - pRaise;
    }
    if (raiseAt >= 0) probs[raiseAt]![i] = pRaise;
    probs[passiveAt]![i] = pCall;
    if (foldAt >= 0) probs[foldAt]![i] = Math.max(0, 1 - pRaise - pCall);
  }
  return { options, probs, preflop: scenario, adjusted };
}
