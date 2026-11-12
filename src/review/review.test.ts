import { describe, expect, it } from 'vitest';
import { DEFAULT_CUSTOM } from '../bots/profiles';
import { parseCards } from '../engine/cards';
import { applyAction, getLegalActions, toHandRecord } from '../engine/hand';
import { seededRng } from '../engine/rng';
import { makeHand, randomAction } from '../engine/testUtil';
import type { Action } from '../engine/types';
import { gradePostflop } from '../grading/postflop';
import { analyzeReview, UNUSUAL } from './analyze';
import { buildHand, buttonFor, isComplete, newReview, resizeReview, reviewFromRecord, reviewPositions, toRecord } from './model';

const f: Action = { type: 'fold' };
const c: Action = { type: 'call' };
const x: Action = { type: 'check' };
const r = (amount: number): Action => ({ type: 'raise', amount });
const b = (amount: number): Action => ({ type: 'bet', amount });

function sixMax() {
  const review = resizeReview(newReview(), 6);
  review.heroPosition = 'BTN';
  review.heroCards = parseCards('Ah Kh');
  return review;
}

describe('review model', () => {
  it('seats the hero at the chosen position', () => {
    for (const pos of ['UTG', 'CO', 'BTN', 'SB', 'BB'] as const) {
      const review = { ...newReview(), heroPosition: pos };
      expect(reviewPositions(review)[0]).toBe(pos);
    }
    expect(buttonFor(2, 'BB')).toBe(1);
  });

  it('asks for community cards when a street starts', () => {
    const review = sixMax();
    // Six-handed: LJ, HJ, CO, BTN (hero), SB, BB.
    review.actions = [f, f, r(300), r(900), f, f, c];
    let built = buildHand(review);
    expect(built.applied).toBe(7);
    expect(built.needCards).toBe(3);
    review.board = parseCards('Kc 7d 2s');
    review.actions.push(x, b(800), c);
    built = buildHand(review);
    expect(built.applied).toBe(10);
    expect(built.needCards).toBe(1);
    review.board.push(...parseCards('3h'));
    review.actions.push(x, x);
    review.board.push(...parseCards('9c'));
    review.actions.push(x, x);
    expect(isComplete(review)).toBe(true);
    expect(buildHand(review).hand.board).toEqual(parseCards('Kc 7d 2s 3h 9c'));
  });

  it('reports illegal actions instead of crashing', () => {
    const review = sixMax();
    review.actions = [x];
    const built = buildHand(review);
    expect(built.applied).toBe(0);
    expect(built.error).not.toBeNull();
  });

  it('round-trips a hand played at the practice table', () => {
    const rng = seededRng(5);
    for (let h = 0; h < 30; h++) {
      const hand = makeHand([20000, 15000, 30000, 20000, 18000], { button: h % 5, rng });
      while (!hand.isComplete) applyAction(hand, randomAction(hand, rng));
      const record = toHandRecord(hand, 0);
      const review = reviewFromRecord(record, ['hero', 'tag', 'nit', 'station', 'lag'], 0)!;
      const rebuilt = buildHand(review);
      expect(rebuilt.applied).toBe(record.actions.length);
      expect(rebuilt.hand.isComplete).toBe(true);
      expect(rebuilt.hand.players.map((p) => p.stack)).toEqual(hand.players.map((p) => p.stack));
    }
  });
});

describe('review analysis', () => {
  it('records ranges after every action and flags unusual ones', () => {
    const review = sixMax();
    // Seats: 0 BTN (hero), 1 SB, 2 BB, 3 LJ, 4 HJ, 5 CO.
    review.profiles = ['hero', 'population', 'population', 'baseline', 'baseline', 'limper'];
    // LJ (baseline) limps, something the baseline never does; CO (limper) limps behind.
    review.actions = [c, f, c, r(500), f, f, c, f];
    const analysis = analyzeReview(review, DEFAULT_CUSTOM);
    expect(analysis.steps.length).toBe(8);
    expect(analysis.ranges.length).toBe(9);
    expect(analysis.steps[0]!.likelihood).toBeLessThan(UNUSUAL);
    expect(analysis.steps[2]!.likelihood).toBeGreaterThan(UNUSUAL);
    // Hero's raise is graded against the charts.
    expect(analysis.preflop.length).toBe(1);
    expect(analysis.preflop[0]!.actionIndex).toBe(3);
    // Folded players have no range.
    expect(analysis.ranges[8]![4]).toBeNull();
    expect(analysis.ranges[8]![0]).toBeNull();
  });

  it('grades postflop decisions of a reviewed hand', () => {
    const review = sixMax();
    review.actions = [f, f, r(300), r(900), f, f, c];
    review.board = parseCards('Kc 7d 2s');
    review.actions.push(x, b(800), c);
    review.board.push(...parseCards('3h'));
    review.actions.push(x);
    const built = buildHand(review);
    expect(built.hand.toAct).toBe(0);
    expect(getLegalActions(built.hand)!.canCheck).toBe(true);
    review.actions.push(b(2000), f);
    const grades = gradePostflop({
      record: toRecord(review),
      heroIndex: 0,
      profiles: review.profiles,
      custom: DEFAULT_CUSTOM,
      useActualTypes: true,
      budget: { turnCards: 3, riverCards: 2, turnRivers: 8 },
    });
    expect(grades.map((g) => g.street)).toEqual(['flop', 'turn']);
  });
});
