import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards';
import { seededRng } from '../engine/rng';
import { calcEquity } from '../eval/equity';
import { parseRange } from '../ranges/rangeString';
import { expandClassWeights } from '../eval/combos';
import { allSpots, DEFAULT_DRILL_FILTER, DRILL_KINDS, gradeChoice, makeQuestion, PREFLOP_ORDER } from './preflopDrill';
import { countOuts, makeQuiz, QUIZ_KINDS } from './quizzes';

describe('preflop drill', () => {
  it('builds valid spots for every kind', () => {
    const spots = allSpots();
    for (const kind of DRILL_KINDS) expect(spots.some((s) => s.kind === kind)).toBe(true);
    for (const s of spots) {
      if (s.villain && s.kind !== 'vs3bet') {
        expect(PREFLOP_ORDER.indexOf(s.villain)).toBeLessThan(PREFLOP_ORDER.indexOf(s.hero));
      }
      if (s.kind === 'vs3bet') expect(PREFLOP_ORDER.indexOf(s.villain!)).toBeGreaterThan(PREFLOP_ORDER.indexOf(s.hero));
    }
  });

  it('asks questions whose frequencies add up and grades answers', () => {
    const rng = seededRng(3);
    for (let i = 0; i < 300; i++) {
      const q = makeQuestion({ ...DEFAULT_DRILL_FILTER, kinds: DRILL_KINDS, depth: 'mixed' }, rng)!;
      expect(q.freq.raise + q.freq.call + q.freq.fold).toBeCloseTo(1, 4);
      expect(q.hand[0]).not.toBe(q.hand[1]);
      const best = (['raise', 'call', 'fold'] as const).reduce((a, b) => (q.freq[b] > q.freq[a] ? b : a));
      expect(gradeChoice(q, best)).toBe('best');
      if (q.canCheck) expect(q.freq.fold).toBeCloseTo(0, 5);
    }
  });

  it('respects position filters', () => {
    const rng = seededRng(5);
    for (let i = 0; i < 50; i++) {
      const q = makeQuestion({ ...DEFAULT_DRILL_FILTER, positions: ['BTN'] }, rng)!;
      expect(q.heroPosition).toBe('BTN');
    }
    expect(makeQuestion({ ...DEFAULT_DRILL_FILTER, kinds: ['vs4bet'], positions: ['UTG'] }, rng)).toBeNull();
  });
});

describe('equity calculator', () => {
  it('matches known preflop matchups', () => {
    const rng = seededRng(1);
    const r = calcEquity([{ cards: parseCards('As Ah') }, { cards: parseCards('Kd Kc') }], [], 20000, rng);
    expect(r.equity[0]!).toBeGreaterThan(0.79);
    expect(r.equity[0]!).toBeLessThan(0.84);
  });

  it('enumerates exactly on the flop', () => {
    const r = calcEquity([{ cards: parseCards('Ah Kh') }, { cards: parseCards('Qs Qd') }], parseCards('2h 7h 9c'), 0, seededRng(1));
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(990);
    expect(r.equity[0]! + r.equity[1]!).toBeCloseTo(1, 6);
  });

  it('handles ranges', () => {
    const range = expandClassWeights(parseRange('QQ+,AKs'));
    const r = calcEquity([{ cards: parseCards('Jh Jd') }, { range }], [], 8000, seededRng(2));
    expect(r.equity[0]!).toBeGreaterThan(0.25);
    expect(r.equity[0]!).toBeLessThan(0.4);
  });
});

describe('quizzes', () => {
  it('always include the answer among four choices', () => {
    const rng = seededRng(9);
    for (const kind of QUIZ_KINDS) {
      for (let i = 0; i < 20; i++) {
        const q = makeQuiz(kind, rng);
        expect(q.choices).toContain(q.answer);
        expect(new Set(q.choices).size).toBe(q.choices.length);
        expect(q.choices.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('counts flush and straight draw outs', () => {
    // Nut flush draw on a dry board: nine flush cards.
    expect(countOuts(parseCards('Ah 4h'), parseCards('Kh 8h 2c'))).toBe(9);
    // Open-ended straight draw: eight cards.
    expect(countOuts(parseCards('9c 8d'), parseCards('7s 6h 2c'))).toBe(8);
  });

  it('computes pot odds and pot sizes consistently', () => {
    const rng = seededRng(4);
    const q = makeQuiz('potOdds', rng);
    const { pot, bet } = q.detail as { pot: number; bet: number };
    expect(q.answer).toBe(Math.round((bet / (pot + 2 * bet)) * 100));
    for (let i = 0; i < 30; i++) {
      const p = makeQuiz('potCount', rng);
      expect(p.answer).toBeGreaterThan(3);
    }
  });
});
