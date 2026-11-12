import { describe, expect, it } from 'vitest';
import { toHandRecord } from '../engine/hand';
import { makeHand, play } from '../engine/testUtil';
import type { PostflopGrade } from '../grading/postflop';
import type { PreflopGrade } from '../grading/preflop';
import type { StoredHand } from '../storage/handStore';
import { allInAdjustedNet } from './allInEv';
import { collectMistakes, nextSchedule, postflopAnswerOk } from './mistakes';
import { buildReport, postflopDirection } from './report';

function stored(i: number, preflop: Partial<PreflopGrade>[], postflop: Partial<PostflopGrade>[], net = 0): StoredHand {
  const hand = makeHand([20000, 20000, 20000], { button: i % 3 });
  play(hand, 'f f');
  return {
    id: i + 1,
    time: 1000 + i,
    heroIndex: 0,
    heroNet: net,
    record: toHandRecord(hand, 1000 + i),
    preflopGrades: preflop as PreflopGrade[],
    postflopGrades: postflop as PostflopGrade[],
    sessionId: i < 10 ? 1 : 2,
  };
}

const postflopGrade = (over: Partial<PostflopGrade>): Partial<PostflopGrade> => ({
  street: 'flop',
  situation: 'facingBet',
  verdict: 'mistake',
  loss: 300,
  pot: 1000,
  chosenKind: 'fold',
  values: [
    { action: { type: 'fold' }, ev: 0, se: 0 },
    { action: { type: 'call' }, ev: 300, se: 0 },
  ],
  bestIndex: 1,
  chosenIndex: 0,
  actionIndex: 3,
  uncertain: false,
  ...over,
});

describe('report', () => {
  it('summarizes results, leaks and progress', () => {
    const hands: StoredHand[] = [];
    for (let i = 0; i < 60; i++) {
      hands.push(
        stored(
          i,
          [{ verdict: i % 4 === 0 ? 'mistake' : 'best', kind: 'vsOpen', heroPosition: 'BB', chosen: 'fold', actionIndex: 0 }],
          i % 3 === 0 ? [postflopGrade({})] : [],
          i % 2 === 0 ? 150 : -100,
        ),
      );
    }
    const report = buildReport(hands);
    expect(report.summary.hands).toBe(60);
    expect(report.summary.net).toBe(30 * 150 - 30 * 100);
    expect(report.summary.preflopGraded).toBe(60);
    expect(report.summary.preflopGood).toBe(45);
    expect(report.summary.evLoss).toBe(20 * 300);
    expect(report.preflopLeaks[0]).toMatchObject({ kind: 'vsOpen', group: 'BB', wrong: 15 });
    expect(report.preflopLeaks[0]!.wrongChoices.fold).toBe(15);
    expect(report.postflopLeaks[0]).toMatchObject({ street: 'flop', situation: 'facingBet', wrong: 20 });
    expect(report.postflopLeaks[0]!.directions.overfold).toBe(20);
    expect(report.progress.length).toBe(3);
    expect(report.progress[2]!.upTo).toBe(60);
    expect(report.sessions.length).toBe(2);
    expect(report.heroStats.hands).toBe(60);
  });

  it('names the direction of a postflop mistake', () => {
    const g = postflopGrade({}) as PostflopGrade;
    expect(postflopDirection(g)).toBe('overfold');
    expect(postflopDirection({ ...g, chosenKind: 'passive', bestIndex: 0 } as PostflopGrade)).toBe('overcall');
    expect(postflopDirection({ ...g, chosenKind: 'aggressive' } as PostflopGrade)).toBe('aggressive');
  });
});

describe('mistake notebook', () => {
  it('collects clear mistakes and schedules them', () => {
    const hands = [stored(0, [{ verdict: 'mistake', actionIndex: 0 }], [postflopGrade({}), postflopGrade({ verdict: 'ok', actionIndex: 5 })])];
    const items = collectMistakes(hands);
    expect(items.map((i) => i.key)).toEqual(['1:0', '1:3']);
    const first = nextSchedule(undefined, true, 0);
    expect(first.box).toBe(0);
    expect(nextSchedule(first, true, 0).box).toBe(1);
    expect(nextSchedule(first, false, 0).box).toBe(0);
    expect(postflopAnswerOk(postflopGrade({}) as PostflopGrade, 1)).toBe(true);
    expect(postflopAnswerOk(postflopGrade({}) as PostflopGrade, 0)).toBe(false);
  });
});

describe('all-in adjusted result', () => {
  it('shares an all-in pot by equity instead of the runout', () => {
    // Aces against kings all-in preflop; the kings win on this board.
    const hand = makeHand([10000, 10000], { button: 0, holes: ['As Ad', 'Ks Kd'], board: '2c 7h 9d Kc 3s' });
    play(hand, 'r10000 c');
    expect(hand.result!.net[0]).toBe(-10000);
    const adjusted = allInAdjustedNet(hand, 0);
    // About 82% of a 20,000 pot minus the 10,000 put in.
    expect(adjusted).toBeGreaterThan(5800);
    expect(adjusted).toBeLessThan(6800);
  });

  it('leaves hands without an early all-in unchanged', () => {
    const hand = makeHand([10000, 10000], { button: 0 });
    play(hand, 'r300 f');
    expect(allInAdjustedNet(hand, 0)).toBe(hand.result!.net[0]);
  });
});
