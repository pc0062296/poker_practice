import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { parseCards } from '../engine/cards';
import { seededRng } from '../engine/rng';
import { makeHand } from '../engine/testUtil';
import { parseClassLabel } from '../eval/handClass';
import { collapseToClasses, comboIndex } from '../eval/combos';
import { gradePreflopDecision } from '../grading/preflop';
import { HandRunner } from './handRunner';
import { DEFAULT_TABLE, selfPlay } from './selfPlayStats';

describe('hand runner', () => {
  it('plays complete hands with legal actions only', () => {
    // applyAction throws on any illegal action, so finishing is the assertion.
    const stats = selfPlay(1500, 2024);
    expect(stats.hands).toBe(1500 * 9);
  });

  it('produces plausible table statistics for nine baseline players', () => {
    const stats = selfPlay(4000, 77);
    if (process.env.STATS_OUT) writeFileSync(process.env.STATS_OUT, JSON.stringify(stats, null, 2));
    expect(stats.vpip!).toBeGreaterThan(0.12);
    expect(stats.vpip!).toBeLessThan(0.3);
    expect(stats.pfr!).toBeGreaterThan(0.09);
    expect(stats.pfr!).toBeLessThan(stats.vpip!);
    expect(stats.threeBet!).toBeGreaterThan(0.03);
    expect(stats.threeBet!).toBeLessThan(0.12);
    expect(stats.cbet!).toBeGreaterThan(0.4);
    expect(stats.cbet!).toBeLessThan(0.85);
    expect(stats.foldToCbet!).toBeGreaterThan(0.25);
    expect(stats.foldToCbet!).toBeLessThan(0.65);
  });

  it('works with a straddle, short tables and heads-up', () => {
    selfPlay(300, 5, { config: { ...DEFAULT_TABLE, straddle: 'always' } });
    selfPlay(300, 6, { config: { ...DEFAULT_TABLE, numPlayers: 6 } });
    selfPlay(300, 7, { config: { ...DEFAULT_TABLE, numPlayers: 2 } });
    selfPlay(300, 8, {
      config: { ...DEFAULT_TABLE, numPlayers: 3, heroBuyIn: 3000, botBuyInMin: 1500, botBuyInMax: 4000, topUp: 'bust' },
    });
  });

  it('narrows the range of a player who opens under the gun', () => {
    const s = makeHand(new Array<number>(9).fill(20000), { button: 0 });
    const runner = new HandRunner(s, { heroIndex: 3, rng: seededRng(1) });
    runner.act({ type: 'raise', amount: 300 });
    const classes = collapseToClasses(runner.tracker.ranges[3]!);
    expect(classes[parseClassLabel('AA')]!).toBeGreaterThan(0.9);
    expect(classes[parseClassLabel('72o')]!).toBeLessThan(0.1);
    // Other players are still unknown.
    expect(collapseToClasses(runner.tracker.ranges[4]!)[parseClassLabel('72o')]).toBe(1);
  });

  it('removes board cards from every range', () => {
    const s = makeHand([20000, 20000], { button: 0, board: 'As Kd 7h 2c 2d' });
    const runner = new HandRunner(s, { heroIndex: 0, rng: seededRng(1) });
    runner.act({ type: 'call' });
    runner.runBots();
    if (s.board.length >= 3) {
      const [a, k] = parseCards('As Kd');
      const [q, j] = parseCards('Qs Jd');
      expect(runner.tracker.ranges[0]![comboIndex(a!, q!)]).toBe(0);
      expect(runner.tracker.ranges[1]![comboIndex(k!, j!)]).toBe(0);
    }
  });
});

describe('preflop grading', () => {
  const nine = (heroHole: string) =>
    makeHand(new Array<number>(9).fill(20000), {
      button: 0,
      heroIndex: 3,
      holes: [null, null, null, heroHole],
    });
  const grade = (heroHole: string, action: Parameters<HandRunner['act']>[0]) => {
    const s = nine(heroHole);
    const runner = new HandRunner(s, { heroIndex: 3, rng: seededRng(1) });
    runner.act(action);
    return gradePreflopDecision(runner.decisions[0]!, s.players[3]!.hole)!;
  };

  it('accepts a standard open', () => {
    const g = grade('As Ks', { type: 'raise', amount: 300 });
    expect(g).toMatchObject({ verdict: 'best', kind: 'rfi', chartKey: 'rfi:UTG', chosen: 'raise' });
    expect(g.freq.raise).toBeCloseTo(1);
    expect(g.sizing).toMatchObject({ standard: 300, verdict: 'ok' });
  });

  it('flags folding a premium hand and opening junk', () => {
    expect(grade('As Ad', { type: 'fold' }).verdict).toBe('mistake');
    expect(grade('7s 2d', { type: 'raise', amount: 300 }).verdict).toBe('mistake');
    expect(grade('7s 2d', { type: 'fold' }).verdict).toBe('best');
  });

  it('treats mixed hands as acceptable either way', () => {
    // 66 opens half the time under the gun.
    expect(grade('6s 6d', { type: 'raise', amount: 300 }).verdict).toBe('best');
    expect(grade('6s 6d', { type: 'fold' }).verdict).toBe('best');
    // AJo opens a quarter of the time.
    expect(grade('As Jd', { type: 'raise', amount: 300 }).verdict).toBe('ok');
  });

  it('flags limping first in', () => {
    expect(grade('As Ks', { type: 'call' }).verdict).toBe('mistake');
  });

  it('comments on unusual raise sizes', () => {
    expect(grade('As Ks', { type: 'raise', amount: 200 }).sizing?.verdict).toBe('small');
    expect(grade('As Ks', { type: 'raise', amount: 800 }).sizing?.verdict).toBe('large');
  });
});
