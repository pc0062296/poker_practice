import { describe, expect, it } from 'vitest';
import { DEFAULT_CUSTOM } from '../bots/profiles';
import { parseCards } from '../engine/cards';
import type { Action } from '../engine/types';
import { newReview, resizeReview, toRecord } from '../review/model';
import { solveReference } from './reference';

const f: Action = { type: 'fold' };
const c: Action = { type: 'call' };
const x: Action = { type: 'check' };

describe('solver reference for a hand', () => {
  it('solves the hero river decision of a heads-up pot', () => {
    const review = resizeReview(newReview(), 6);
    review.heroPosition = 'BTN';
    review.heroCards = parseCards('Ah Kh');
    review.actions = [f, f, { type: 'raise', amount: 300 }, { type: 'raise', amount: 900 }, f, f, c];
    review.board = parseCards('Kc 7d 2s 3h 9c');
    review.actions.push(x, { type: 'bet', amount: 800 }, c, x, x, x);
    const job = {
      record: toRecord(review),
      heroIndex: 0,
      profiles: review.profiles,
      custom: DEFAULT_CUSTOM,
      useActualTypes: true,
      actionIndex: review.actions.length,
    };
    const ref = solveReference(job)!;
    expect(ref).not.toBeNull();
    expect(ref.street).toBe('river');
    expect(ref.hand.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(ref.range.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(ref.exploitability).toBeLessThan(0.05);
    // Not applicable before the flop.
    expect(solveReference({ ...job, actionIndex: 3 })).toBeNull();
  });
});
