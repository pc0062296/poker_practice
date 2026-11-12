import { describe, expect, it } from 'vitest';
import { CLASS_LABELS, NUM_CLASSES, parseClassLabel } from '../eval/handClass';
import { COMBO_CLASS, comboIndex, NUM_COMBOS } from '../eval/combos';
import { parseCards } from '../engine/cards';
import { makeHand, play } from '../engine/testUtil';
import { getLegalActions } from '../engine/hand';
import { builtinChartSpec, chartKeys, getChart, setChartOverride } from './charts';
import { formatRange, parseRange, rangeFraction, tryParseRange } from './rangeString';
import { classifyPreflop } from './scenario';
import { standardPreflopRaiseTo } from './sizing';
import { CLASS_TIER } from './tiers';

const w = (range: string, label: string) => parseRange(range)[parseClassLabel(label)]!;
const labels = (range: string) => {
  const weights = parseRange(range);
  return CLASS_LABELS.filter((_, k) => weights[k]! > 0).sort();
};

describe('hand classes and combos', () => {
  it('has 169 classes covering 1326 combos', () => {
    expect(CLASS_LABELS.length).toBe(NUM_CLASSES);
    expect(new Set(CLASS_LABELS).size).toBe(169);
    const counts = new Array<number>(NUM_CLASSES).fill(0);
    for (let i = 0; i < NUM_COMBOS; i++) counts[COMBO_CLASS[i]!]!++;
    expect(counts[parseClassLabel('AA')]).toBe(6);
    expect(counts[parseClassLabel('AKs')]).toBe(4);
    expect(counts[parseClassLabel('AKo')]).toBe(12);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1326);
  });

  it('maps cards to the right class', () => {
    const [a, b, c] = parseCards('As Ks Kd');
    expect(CLASS_LABELS[COMBO_CLASS[comboIndex(a!, b!)]!]).toBe('AKs');
    expect(CLASS_LABELS[COMBO_CLASS[comboIndex(c!, a!)]!]).toBe('AKo');
    expect(CLASS_LABELS[COMBO_CLASS[comboIndex(b!, c!)]!]).toBe('KK');
  });
});

describe('range text', () => {
  it('parses single classes', () => {
    expect(labels('AA, AKs AKo;72o')).toEqual(['72o', 'AA', 'AKo', 'AKs']);
    expect(labels('AK')).toEqual(['AKo', 'AKs']);
    expect(labels('kqS')).toEqual(['KQs']);
  });

  it('parses plus notation', () => {
    expect(labels('TT+')).toEqual(['AA', 'JJ', 'KK', 'QQ', 'TT']);
    expect(labels('ATs+')).toEqual(['AJs', 'AKs', 'AQs', 'ATs']);
    expect(labels('KJo+')).toEqual(['KJo', 'KQo']);
    expect(labels('64s+')).toEqual(['64s', '65s']);
  });

  it('parses runs', () => {
    expect(labels('QQ-99')).toEqual(['99', 'JJ', 'QQ', 'TT']);
    expect(labels('99-QQ')).toEqual(['99', 'JJ', 'QQ', 'TT']);
    expect(labels('A5s-A2s')).toEqual(['A2s', 'A3s', 'A4s', 'A5s']);
    expect(labels('T9s-76s')).toEqual(['76s', '87s', '98s', 'T9s']);
    expect(labels('J9o-97o')).toEqual(['97o', 'J9o', 'T8o']);
  });

  it('parses weights and lets later tokens override earlier ones', () => {
    expect(w('A5s:0.5', 'A5s')).toBeCloseTo(0.5);
    expect(w('A5s: 25%', 'A5s')).toBeCloseTo(0.25);
    expect(w('A2s+,AKs:0.5', 'AKs')).toBeCloseTo(0.5);
    expect(w('A2s+,AKs:0.5', 'AQs')).toBe(1);
  });

  it('adds single combos to their class', () => {
    expect(w('AhKh', 'AKs')).toBeCloseTo(0.25);
    expect(w('AhKh,AsKs', 'AKs')).toBeCloseTo(0.5);
    expect(w('AhKd', 'AKo')).toBeCloseTo(1 / 12);
  });

  it('reports bad tokens', () => {
    expect(tryParseRange('AA,XY,KK:2,AKs-QQ').errors).toEqual(['XY', 'KK:2', 'AKs-QQ']);
    expect(() => parseRange('AAs')).toThrow();
  });

  it('round-trips through formatRange', () => {
    const text = 'QQ+,AKs,A5s:0.5,KQo:0.25';
    const again = parseRange(formatRange(parseRange(text)));
    expect(Array.from(again)).toEqual(Array.from(parseRange(text)));
  });

  it('computes the share of all hands', () => {
    expect(rangeFraction(parseRange('AA'))).toBeCloseTo(6 / 1326);
    expect(rangeFraction(parseRange('22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q2o+,J2o+,T2o+,92o+,82o+,72o+,62o+,52o+,42o+,32o'))).toBeCloseTo(1);
  });
});

describe('built-in charts', () => {
  it('all compile, and raise plus call never exceeds one', () => {
    for (const key of chartKeys()) {
      for (const depth of [100, 200] as const) {
        const chart = getChart(key, depth)!;
        expect(chart).not.toBeNull();
        for (let k = 0; k < NUM_CLASSES; k++) {
          expect(chart.raise[k]! + chart.call[k]!).toBeLessThanOrEqual(1.0001);
          expect(chart.call[k]!).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('opens wider from later positions', () => {
    const order = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN'];
    const fractions = order.map((p) => rangeFraction(getChart(`rfi:${p}`, 100)!.raise));
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]!).toBeGreaterThan(fractions[i - 1]!);
    expect(fractions[0]!).toBeGreaterThan(0.08);
    expect(fractions[0]!).toBeLessThan(0.13);
    expect(fractions[6]!).toBeGreaterThan(0.38);
    expect(fractions[6]!).toBeLessThan(0.5);
  });

  it('always continues with aces and never plays seven-deuce offsuit', () => {
    const aa = parseClassLabel('AA');
    const junk = parseClassLabel('72o');
    for (const key of chartKeys()) {
      for (const depth of [100, 200] as const) {
        const chart = getChart(key, depth)!;
        if (!key.startsWith('vsLimp:BB')) expect(chart.raise[aa]! + chart.call[aa]!).toBeCloseTo(1);
        expect(chart.raise[junk]! + chart.call[junk]!).toBe(0);
      }
    }
  });

  it('uses deeper charts at 200 big blinds where they exist', () => {
    expect(builtinChartSpec('vs4bet', 200)).not.toEqual(builtinChartSpec('vs4bet', 100));
    expect(builtinChartSpec('rfi:CO', 200)).toEqual(builtinChartSpec('rfi:CO', 100));
  });

  it('accepts user overrides', () => {
    const aks = parseClassLabel('AKs');
    setChartOverride('rfi:UTG', 100, { raise: 'AA', call: 'AKs' });
    expect(getChart('rfi:UTG', 100)!.raise[aks]).toBe(0);
    expect(getChart('rfi:UTG', 100)!.call[aks]).toBe(1);
    setChartOverride('rfi:UTG', 100, null);
    expect(getChart('rfi:UTG', 100)!.raise[aks]).toBe(1);
  });

  it('ranks premium hands in the top tiers', () => {
    expect(CLASS_TIER[parseClassLabel('AA')]).toBe(0);
    expect(CLASS_TIER[parseClassLabel('AKs')]).toBe(1);
    expect(CLASS_TIER[parseClassLabel('JJ')]).toBe(2);
    expect(CLASS_TIER[parseClassLabel('72o')]).toBe(8);
  });
});

describe('preflop scenarios', () => {
  // Nine players, button at index 0: SB 1, BB 2, UTG 3, UTG+1 4, UTG+2 5, LJ 6, HJ 7, CO 8.
  const nine = () => makeHand(new Array<number>(9).fill(20000), { button: 0 });

  it('recognizes first-in spots', () => {
    const s = nine();
    expect(classifyPreflop(s, 3)).toMatchObject({ kind: 'rfi', chartKey: 'rfi:UTG', depth: 200, approx: false });
    play(s, 'f f f f f');
    expect(classifyPreflop(s, 8)).toMatchObject({ kind: 'rfi', chartKey: 'rfi:CO' });
    play(s, 'f f');
    expect(classifyPreflop(s, 1)).toMatchObject({ kind: 'rfi', chartKey: 'rfi:SB' });
  });

  it('recognizes limped pots', () => {
    const s = nine();
    play(s, 'c f f f f');
    expect(classifyPreflop(s, 8)).toMatchObject({ kind: 'vsLimp', chartKey: 'vsLimp:CO' });
    play(s, 'f f c');
    expect(classifyPreflop(s, 2)).toMatchObject({ kind: 'vsLimp', chartKey: 'vsLimp:BB' });
  });

  it('distinguishes a small blind complete from other limps', () => {
    const s = nine();
    play(s, 'f f f f f f f c');
    expect(classifyPreflop(s, 2)).toMatchObject({ kind: 'vsLimp', chartKey: 'vsLimp:BBvsSB' });
  });

  it('recognizes facing an open by opener and hero position', () => {
    const s = nine();
    play(s, 'r300');
    expect(classifyPreflop(s, 4)).toMatchObject({ kind: 'vsOpen', chartKey: 'vsOpen:EP:EP', villainPosition: 'UTG' });
    play(s, 'f f f f');
    expect(classifyPreflop(s, 8)).toMatchObject({ kind: 'vsOpen', chartKey: 'vsOpen:EP:CO' });
    play(s, 'f f f');
    expect(classifyPreflop(s, 2)).toMatchObject({ kind: 'vsOpen', chartKey: 'vsOpen:EP:BB' });
  });

  it('recognizes squeezes, 3-bets and 4-bets', () => {
    const s = nine();
    play(s, 'f f f f r300 c');
    // HJ opened, CO called; the button can squeeze.
    expect(classifyPreflop(s, 0)).toMatchObject({ kind: 'squeeze', chartKey: 'vsOpen:MP:BTN', approx: true });
    play(s, 'r1300');
    expect(classifyPreflop(s, 1)).toMatchObject({ kind: 'cold3bet', chartKey: 'cold3bet' });
    play(s, 'f f');
    expect(classifyPreflop(s, 7)).toMatchObject({ kind: 'vs3bet', chartKey: 'vs3bet:MP', villainPosition: 'BTN' });
    play(s, 'r3200 f');
    expect(classifyPreflop(s, 0)).toMatchObject({ kind: 'vs4bet', chartKey: 'vs4bet', villainPosition: 'HJ' });
  });

  it('has no chart for a limper facing a raise', () => {
    const s = nine();
    play(s, 'c f f f f f r500 f f');
    expect(classifyPreflop(s, 3)).toMatchObject({ kind: 'other', chartKey: null });
  });

  it('picks the chart depth from the effective stack', () => {
    const s = makeHand([10000, 20000, 20000, 20000, 20000, 20000], { button: 0 });
    expect(classifyPreflop(s, 3).depth).toBe(200);
    play(s, 'f f f');
    expect(classifyPreflop(s, 0).depth).toBe(100);
  });

  it('treats the straddler as the big blind', () => {
    const s = makeHand(new Array<number>(9).fill(40000), { button: 0, straddle: 200 });
    expect(classifyPreflop(s, 4)).toMatchObject({ kind: 'rfi', chartKey: 'rfi:UTG+1', depth: 200 });
    play(s, 'r600 f f f f f f f');
    expect(classifyPreflop(s, 3)).toMatchObject({ kind: 'vsOpen', chartKey: 'vsOpen:EP:BB', approx: true });
  });
});

describe('standard raise sizes', () => {
  const nine = () => makeHand(new Array<number>(9).fill(20000), { button: 0 });

  it('opens to three big blinds plus one per limper', () => {
    const s = nine();
    expect(standardPreflopRaiseTo(s, 3, classifyPreflop(s, 3), getLegalActions(s)!)).toBe(300);
    play(s, 'c c');
    expect(standardPreflopRaiseTo(s, 5, classifyPreflop(s, 5), getLegalActions(s)!)).toBe(500);
  });

  it('3-bets bigger out of position', () => {
    const s = nine();
    play(s, 'f f f f r300');
    // CO in position versus HJ (deep stacks): 3.5x.
    expect(standardPreflopRaiseTo(s, 8, classifyPreflop(s, 8), getLegalActions(s)!)).toBe(1050);
    play(s, 'f f');
    // Small blind out of position: 4.5x.
    expect(standardPreflopRaiseTo(s, 1, classifyPreflop(s, 1), getLegalActions(s)!)).toBe(1350);
  });

  it('shoves when the raise would commit most of the stack', () => {
    // The big blind has 20 big blinds; a 4x 3-bet to 1200 is most of the stack.
    const s = makeHand([20000, 20000, 2000, 20000], { button: 0 });
    play(s, 'r300 f f');
    expect(s.toAct).toBe(2);
    expect(standardPreflopRaiseTo(s, 2, classifyPreflop(s, 2), getLegalActions(s)!)).toBe(2000);
  });

});
