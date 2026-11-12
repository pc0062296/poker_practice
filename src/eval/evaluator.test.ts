import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards';
import { seededRng } from '../engine/rng';
import {
  bestFive,
  categoryOf,
  describeScore,
  evaluate,
  FLUSH,
  FULL_HOUSE,
  HIGH_CARD,
  PAIR,
  QUADS,
  STRAIGHT,
  STRAIGHT_FLUSH,
  TRIPS,
  TWO_PAIR,
} from './evaluator';

const ev = (text: string) => evaluate(parseCards(text));

describe('evaluate: categories', () => {
  it('recognizes every category', () => {
    expect(categoryOf(ev('As Kd 9h 5c 2s'))).toBe(HIGH_CARD);
    expect(categoryOf(ev('As Ad 9h 5c 2s'))).toBe(PAIR);
    expect(categoryOf(ev('As Ad 9h 9c 2s'))).toBe(TWO_PAIR);
    expect(categoryOf(ev('As Ad Ah 9c 2s'))).toBe(TRIPS);
    expect(categoryOf(ev('9s 8d 7h 6c 5s'))).toBe(STRAIGHT);
    expect(categoryOf(ev('As Ks 9s 5s 2s'))).toBe(FLUSH);
    expect(categoryOf(ev('As Ad Ah 9c 9s'))).toBe(FULL_HOUSE);
    expect(categoryOf(ev('As Ad Ah Ac 9s'))).toBe(QUADS);
    expect(categoryOf(ev('9s 8s 7s 6s 5s'))).toBe(STRAIGHT_FLUSH);
  });

  it('treats the wheel as the lowest straight', () => {
    expect(categoryOf(ev('As 2d 3h 4c 5s'))).toBe(STRAIGHT);
    expect(ev('2s 3d 4h 5c 6s')).toBeGreaterThan(ev('As 2d 3h 4c 5s'));
    expect(ev('As 2s 3s 4s 5s')).toBeLessThan(ev('2s 3s 4s 5s 6s'));
    expect(describeScore(ev('As 2d 3h 4c 5s')).ranks).toEqual([3]);
  });

  it('does not wrap straights around the ace', () => {
    expect(categoryOf(ev('Qs Kd Ah 2c 3s'))).toBe(HIGH_CARD);
  });
});

describe('evaluate: ordering', () => {
  it('breaks ties with kickers', () => {
    expect(ev('As Ad Kh 5c 2s')).toBeGreaterThan(ev('Ah Ac Qh 5d 2c'));
    expect(ev('As Ad Kh 5c 3s')).toBeGreaterThan(ev('Ah Ac Kd 5d 2c'));
    expect(ev('As Ad Kh 5c 2s')).toBe(ev('Ah Ac Kd 5d 2c'));
  });

  it('ranks two pair by top pair, second pair, then kicker', () => {
    expect(ev('As Ad 2h 2c 3s')).toBeGreaterThan(ev('Ks Kd Qh Qc Js'));
    expect(ev('Ks Kd Qh Qc 3s')).toBeGreaterThan(ev('Kh Kc Jh Jc As'));
    expect(ev('Ks Kd Qh Qc As')).toBeGreaterThan(ev('Kh Kc Qd Qs Js'));
  });

  it('ranks full houses by trips first', () => {
    expect(ev('3s 3d 3h 2c 2s')).toBeGreaterThan(ev('2h 2d 2c As Ad'));
  });

  it('orders categories correctly', () => {
    const ordered = [
      'As Kd 9h 5c 2s',
      '2s 2d 4h 5c 7s',
      '2s 2d 3h 3c 7s',
      '2s 2d 2h 5c 7s',
      'As 2d 3h 4c 5s',
      '2s 3s 4s 5s 7s',
      '2s 2d 2h 3c 3s',
      '2s 2d 2h 2c 3s',
      'As 2s 3s 4s 5s',
    ].map(ev);
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]!).toBeGreaterThan(ordered[i - 1]!);
  });
});

describe('evaluate: seven cards', () => {
  it('picks the best five of seven', () => {
    expect(categoryOf(ev('As Ad Ah Kc Ks Kd 2h'))).toBe(FULL_HOUSE);
    expect(describeScore(ev('As Ad Ah Kc Ks Kd 2h')).ranks).toEqual([12, 11]);
    expect(categoryOf(ev('2s 2d 3h 3c 4s 4d Ah'))).toBe(TWO_PAIR);
    expect(describeScore(ev('2s 2d 3h 3c 4s 4d Ah')).ranks).toEqual([2, 1, 12]);
    expect(categoryOf(ev('9s 8s 7s 6s 5s Ah Ad'))).toBe(STRAIGHT_FLUSH);
    expect(describeScore(ev('As Ks Qs Js 9s 8s Td')).category).toBe(FLUSH);
  });

  it('uses the third pair as a kicker when it is the best one', () => {
    expect(describeScore(ev('Ks Kd Qh Qc Js Jd 2h')).ranks).toEqual([11, 10, 9]);
  });

  it('matches a brute-force search over all 21 five-card subsets', () => {
    const rng = seededRng(7);
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let trial = 0; trial < 20000; trial++) {
      for (let i = 0; i < 7; i++) {
        const j = i + rng.int(52 - i);
        const t = deck[i]!;
        deck[i] = deck[j]!;
        deck[j] = t;
      }
      const hand = deck.slice(0, 7);
      const direct = evaluate(hand);
      const five = bestFive(hand);
      expect(evaluate(five)).toBe(direct);
    }
  });
});

describe('evaluate: exhaustive five-card distribution', () => {
  it('matches the known counts for all 2,598,960 hands', () => {
    const counts = new Array<number>(9).fill(0);
    const h = [0, 0, 0, 0, 0];
    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++) {
              h[0] = a;
              h[1] = b;
              h[2] = c;
              h[3] = d;
              h[4] = e;
              counts[evaluate(h, 5) >> 20]!++;
            }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  });
});

describe.skipIf(!process.env.FULL_TESTS)('evaluate: exhaustive seven-card distribution', () => {
  it('matches the known counts for all 133,784,560 hands', () => {
    const counts = new Array<number>(9).fill(0);
    const h = [0, 0, 0, 0, 0, 0, 0];
    for (let a = 0; a < 46; a++)
      for (let b = a + 1; b < 47; b++)
        for (let c = b + 1; c < 48; c++)
          for (let d = c + 1; d < 49; d++)
            for (let e = d + 1; e < 50; e++)
              for (let f = e + 1; f < 51; f++)
                for (let g = f + 1; g < 52; g++) {
                  h[0] = a;
                  h[1] = b;
                  h[2] = c;
                  h[3] = d;
                  h[4] = e;
                  h[5] = f;
                  h[6] = g;
                  counts[evaluate(h, 7) >> 20]!++;
                }
    expect(counts).toEqual([
      23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584,
    ]);
  });
});
