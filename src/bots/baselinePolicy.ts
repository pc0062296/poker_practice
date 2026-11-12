import { postflopStrategy } from './baselinePostflop';
import { preflopStrategy } from './baselinePreflop';
import type { DecisionContext, Policy, RangeStrategy } from './types';

/** The baseline strategy: range charts before the flop, rules after it. */
export const baselinePolicy: Policy = {
  rangeStrategy(ctx: DecisionContext): RangeStrategy {
    return ctx.view.street === 'preflop' ? preflopStrategy(ctx) : postflopStrategy(ctx);
  },
};
