import { baselinePolicy } from './baselinePolicy';
import { humanPostflopStrategy } from './humanPostflop';
import { humanPreflopStrategy } from './humanPreflop';
import type { HumanParams, Profile } from './profiles';
import type { DecisionContext, Policy, RangeStrategy } from './types';

export class HumanPolicy implements Policy {
  constructor(readonly params: HumanParams) {}

  rangeStrategy(ctx: DecisionContext): RangeStrategy {
    return ctx.view.street === 'preflop'
      ? humanPreflopStrategy(ctx, this.params)
      : humanPostflopStrategy(ctx, this.params);
  }
}

const cache = new Map<string, Policy>();

/** The policy for a profile. The same profile always returns the same object. */
export function policyFor(profile: Profile): Policy {
  if (profile.engine === 'baseline' || !profile.params) return baselinePolicy;
  const key = JSON.stringify(profile.params);
  let policy = cache.get(key);
  if (!policy) {
    policy = new HumanPolicy(profile.params);
    cache.set(key, policy);
  }
  return policy;
}
