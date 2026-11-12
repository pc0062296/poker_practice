import { describe, expect, it } from 'vitest';
import { baselinePolicy } from '../bots/baselinePolicy';
import { policyFor } from '../bots/policies';
import { makeProfile } from '../bots/profiles';
import type { Policy } from '../bots/types';
import { parseCards } from '../engine/cards';
import { getLegalActions } from '../engine/hand';
import { seededRng } from '../engine/rng';
import { makeHand } from '../engine/testUtil';
import type { Action } from '../engine/types';
import { comboIndex } from '../eval/combos';
import { HandRunner } from '../game/handRunner';
import { DEFAULT_SIZING } from '../ranges/sizing';
import { evaluate } from '../eval/evaluator';
import { evaluateDecision, type EvalInput } from './evaluator';

/** Play scripted actions with a runner, so ranges are tracked, until the hero is to act. */
function setup(opts: {
  stacks: number[];
  holes: (string | null)[];
  board: string;
  actions: Action[];
  hero: number;
  policies?: Policy[];
}) {
  const hand = makeHand(opts.stacks, { button: 0, holes: opts.holes, board: opts.board, heroIndex: opts.hero });
  const policies = opts.policies ?? opts.stacks.map(() => baselinePolicy);
  const runner = new HandRunner(hand, { heroIndex: opts.hero, rng: seededRng(1), policies, observer: baselinePolicy });
  for (const a of opts.actions) runner.act(a);
  expect(hand.toAct).toBe(opts.hero);
  return { hand, runner, policies };
}

function input(s: ReturnType<typeof setup>, candidates: Action[], extra: Partial<EvalInput> = {}): EvalInput {
  return {
    hand: s.hand,
    heroIndex: s.hand.toAct,
    beliefs: s.runner.beliefs.ranges,
    weights: s.runner.actual.ranges,
    candidates,
    model: { policies: s.policies, observer: baselinePolicy, sizing: DEFAULT_SIZING },
    ...extra,
  };
}

const c = (t: string) => parseCards(t);

describe('decision evaluator', () => {
  it('values a fold at zero and computes a river call exactly', () => {
    // Heads-up, button (P0) vs big blind (P1). River: P1 shoves, hero (P0) decides.
    const s = setup({
      stacks: [10000, 10000],
      holes: ['Ah Kd', null],
      board: 'As 9c 4d 7h 2s',
      hero: 0,
      actions: [
        { type: 'raise', amount: 300 },
        { type: 'call' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
        { type: 'bet', amount: 9700 },
      ],
    });
    const res = evaluateDecision(input(s, [{ type: 'fold' }, { type: 'call' }]));
    expect(res.exact).toBe(true);
    expect(res.values[0]!.ev).toBe(0);

    // Exact check: equity against the evaluation range on the final board.
    const weights = s.runner.actual.ranges[1]!.slice();
    const hero = c('Ah Kd');
    const board = c('As 9c 4d 7h 2s');
    const heroScore = evaluate([...hero, ...board]);
    let total = 0;
    let win = 0;
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++) {
        if ([...hero, ...board].includes(a) || [...hero, ...board].includes(b)) continue;
        const w = weights[comboIndex(a, b)]!;
        if (w <= 0) continue;
        const sc = evaluate([a, b, ...board]);
        total += w;
        if (sc < heroScore) win += w;
        else if (sc === heroScore) win += w / 2;
      }
    const equity = win / total;
    // Pot 600 plus the 9700 shove; calling 9700 wins both. Tests use no rake.
    const expected = equity * (600 + 9700 * 2) - 9700;
    expect(res.values[1]!.ev).toBeCloseTo(expected, 0);
  });

  it('prefers betting the nuts on the river against a calling station', () => {
    const station = policyFor(makeProfile('station'));
    const s = setup({
      stacks: [10000, 10000],
      holes: ['Kh Qh', null],
      board: 'Ah Jh Th 4c 2d',
      hero: 1,
      policies: [station, baselinePolicy],
      actions: [{ type: 'call' }, { type: 'check' }, { type: 'check' }, { type: 'check' }, { type: 'check' }, { type: 'check' }],
    });
    // Hero (big blind, P1) acts first on the river.
    const legal = getLegalActions(s.hand)!;
    const res = evaluateDecision(
      input(s, [{ type: 'check' }, { type: 'bet', amount: 150 }, { type: 'bet', amount: legal.maxRaiseTo }]),
    );
    const [check, small] = res.values;
    expect(small!.ev).toBeGreaterThan(check!.ev);
    expect(res.nodes).toBeGreaterThan(0);
  });

  it('evaluates a turn decision exactly and a flop decision by sampling', () => {
    const base = {
      stacks: [20000, 20000, 20000],
      holes: [null, 'Qs Qd', null] as (string | null)[],
      board: 'Qh 8c 3d 5s Kd',
      hero: 1,
    };
    const flop = setup({
      ...base,
      actions: [{ type: 'raise', amount: 300 }, { type: 'call' }, { type: 'fold' }],
    });
    const t0 = Date.now();
    const flopRes = evaluateDecision(input(flop, [{ type: 'check' }, { type: 'bet', amount: 400 }]));
    const flopMs = Date.now() - t0;
    expect(flopRes.exact).toBe(false);
    for (const v of flopRes.values) {
      expect(Number.isFinite(v.ev)).toBe(true);
      expect(v.se).toBeGreaterThanOrEqual(0);
    }
    // A set on a dry flop is worth a lot more than the pot already in it.
    expect(Math.max(...flopRes.values.map((v) => v.ev))).toBeGreaterThan(300);

    const turn = setup({
      ...base,
      actions: [
        { type: 'raise', amount: 300 },
        { type: 'call' },
        { type: 'fold' },
        { type: 'check' },
        { type: 'check' },
      ],
    });
    const turnRes = evaluateDecision(input(turn, [{ type: 'check' }, { type: 'bet', amount: 400 }]));
    expect(turnRes.exact).toBe(true);
    if (process.env.PERF) {
      console.log('flop', flopMs, 'ms', flopRes.nodes, 'nodes; turn', turnRes.ms, 'ms', turnRes.nodes, 'nodes');
    }
  });

  it('handles multiway pots', () => {
    const s = setup({
      stacks: [20000, 20000, 20000, 20000],
      holes: [null, null, 'Ah Kh', null],
      board: 'Kc 7h 2h 9s 4d',
      hero: 2,
      actions: [{ type: 'call' }, { type: 'call' }, { type: 'call' }],
    });
    // Preflop: P3 (UTG) limps, P0 (BTN) limps, P1 (SB) completes; hero is the big blind.
    expect(s.hand.street).toBe('preflop');
    s.runner.act({ type: 'check' });
    expect(s.hand.street).toBe('flop');
    // Postflop the small blind (P1) acts first.
    s.runner.act({ type: 'check' });
    expect(s.hand.toAct).toBe(2);
    const res = evaluateDecision(input(s, [{ type: 'check' }, { type: 'bet', amount: 300 }]));
    expect(res.values.length).toBe(2);
    for (const v of res.values) expect(Number.isFinite(v.ev)).toBe(true);
  });

  it('never looks at the real hole cards of the opponents', () => {
    const run = (villain: string) => {
      const s = setup({
        stacks: [10000, 10000],
        holes: ['Ah Kd', villain],
        board: 'As 9c 4d 7h 2s',
        hero: 0,
        actions: [{ type: 'raise', amount: 300 }, { type: 'call' }, { type: 'check' }],
      });
      return evaluateDecision(input(s, [{ type: 'check' }, { type: 'bet', amount: 200 }])).values.map((v) => v.ev);
    };
    expect(run('Qs Qc')).toEqual(run('5c 6c'));
  });

});
