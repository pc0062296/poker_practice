import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards';
import { comboIndex, expandClassWeights, NUM_COMBOS } from '../eval/combos';
import { parseRange } from '../ranges/rangeString';
import { Solver, solve } from './solver';

const range = (text: string) => expandClassWeights(parseRange(text));

describe('heads-up solver', () => {
  it('converges on a river spot', () => {
    const input = {
      board: parseCards('Kh 9d 5c 2s Jh'),
      ranges: [range('AA,KK,99,55,AK,KQ,KJ,QJs,T9s,A5s,87s'), range('AA,QQ,JJ,TT,AK,AJ,KQ,QTs,T8s,76s,A4s')] as [Float32Array, Float32Array],
      pot: 1000,
      stacks: [5000, 5000] as [number, number],
      bets: [0, 0] as [number, number],
      toAct: 0 as const,
      raises: 0,
      otherActed: false,
    };
    const early = new Solver(input);
    early.run(20);
    const result = solve(input, 400);
    const earlyGap = early.exploitability();
    expect(result.exploitability).toBeLessThan(0.02);
    expect(result.exploitability).toBeLessThan(earlyGap);
    // Probabilities form a distribution for every combo in the range.
    const c = comboIndex(parseCards('As')[0]!, parseCards('Ad')[0]!);
    const total = result.probs.reduce((s, p) => s + p[c]!, 0);
    expect(total).toBeCloseTo(1, 4);
    expect(result.actions[0]!.type).toBe('check');
  });

  it('bets the nuts and folds air sensibly when facing a pot-sized bet', () => {
    // Out of position faces a pot bet with a pure bluff catcher range against nuts and air.
    const board = parseCards('2c 7d 9h Js Kc');
    const oop = new Float32Array(NUM_COMBOS);
    const ip = new Float32Array(NUM_COMBOS);
    const set = (r: Float32Array, text: string) => {
      const [a, b] = parseCards(text);
      r[comboIndex(a!, b!)] = 1;
    };
    set(oop, 'Qh Qd');
    set(oop, 'Qs Qc');
    set(ip, 'Kh Kd');
    set(ip, 'Ks Kd');
    set(ip, '4h 3h');
    set(ip, '4s 3s');
    const result = solve(
      {
        board,
        ranges: [oop, ip],
        pot: 2000,
        stacks: [1000, 0],
        bets: [0, 1000],
        toAct: 0,
        raises: 1,
        otherActed: true,
      },
      600,
    );
    // Facing a pot bet with 50% nuts and 50% air: a bluff catcher is indifferent; calling
    // wins half the time for a 2:1 price, so it calls.
    const qq = comboIndex(parseCards('Qh')[0]!, parseCards('Qd')[0]!);
    const call = result.actions.findIndex((a) => a.type === 'call');
    expect(result.probs[call]![qq]!).toBeGreaterThan(0.9);
  });

  it('solves a small turn spot', () => {
    const input = {
      board: parseCards('Kh 9d 5c 2s'),
      ranges: [range('AA,99,AK,KQ,QJs,T9s,87s'), range('KK,QQ,AK,KJ,JTs,76s')] as [Float32Array, Float32Array],
      pot: 1000,
      stacks: [4000, 4000] as [number, number],
      bets: [0, 0] as [number, number],
      toAct: 0 as const,
      raises: 0,
      otherActed: false,
    };
    const t0 = Date.now();
    const result = solve(input, 40);
    const ms = Date.now() - t0;
    expect(result.exploitability).toBeLessThan(0.08);
    if (process.env.PERF) console.log('turn solve', ms, 'ms, exploitability', result.exploitability);
  });
});
