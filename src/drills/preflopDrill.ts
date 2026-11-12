import { makeCard, type Card } from '../engine/cards';
import type { Rng } from '../engine/rng';
import type { PositionName } from '../engine/types';
import { CLASS_KINDS, classRanks, NUM_CLASSES } from '../eval/handClass';
import { getChart, type ChartDepth } from '../ranges/charts';

export type DrillKind = 'rfi' | 'vsLimp' | 'vsOpen' | 'vs3bet' | 'cold3bet' | 'vs4bet';
export type DrillChoice = 'fold' | 'call' | 'raise';
export type DrillVerdict = 'best' | 'ok' | 'inaccuracy' | 'mistake';

export const DRILL_KINDS: DrillKind[] = ['rfi', 'vsLimp', 'vsOpen', 'vs3bet', 'cold3bet', 'vs4bet'];

/** Seats in acting order before the flop (nine-handed). */
export const PREFLOP_ORDER: PositionName[] = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

const GROUPS: Record<string, PositionName[]> = {
  EP: ['UTG', 'UTG+1', 'UTG+2'],
  MP: ['LJ', 'HJ'],
  CO: ['CO'],
  BTN: ['BTN'],
  SB: ['SB'],
  BB: ['BB'],
};

export interface DrillFilter {
  kinds: DrillKind[];
  /** Hero positions to practice; empty means all. */
  positions: PositionName[];
  depth: ChartDepth | 'mixed';
  /** Prefer hands near the edge of a range, where decisions are hard. */
  focusClose: boolean;
}

export const DEFAULT_DRILL_FILTER: DrillFilter = {
  kinds: ['rfi', 'vsLimp', 'vsOpen', 'vs3bet'],
  positions: [],
  depth: 200,
  focusClose: true,
};

export interface DrillQuestion {
  chartKey: string;
  depth: ChartDepth;
  kind: DrillKind;
  heroPosition: PositionName;
  /** Opener, 3-bettor or 4-bettor, depending on the spot. */
  villainPosition: PositionName | null;
  /** Second raiser in a cold 3-bet spot. */
  thirdPosition: PositionName | null;
  limpers: number;
  hand: [Card, Card];
  handClass: number;
  freq: Record<DrillChoice, number>;
  /** The passive option is a free check (big blind facing limps). */
  canCheck: boolean;
}

interface Spot {
  chartKey: string;
  kind: DrillKind;
  hero: PositionName;
  villain: PositionName | null;
  third: PositionName | null;
  limpers: number;
}

const idx = (p: PositionName) => PREFLOP_ORDER.indexOf(p);
const later = (p: PositionName) => PREFLOP_ORDER.slice(idx(p) + 1);
const earlier = (p: PositionName) => PREFLOP_ORDER.slice(0, idx(p));

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[rng.int(items.length)]!;
}

/** Every concrete spot the charts cover. */
export function allSpots(): Spot[] {
  const spots: Spot[] = [];
  for (const hero of ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'] as PositionName[]) {
    spots.push({ chartKey: `rfi:${hero}`, kind: 'rfi', hero, villain: null, third: null, limpers: 0 });
  }
  for (const [group, positions] of Object.entries(GROUPS)) {
    for (const hero of positions) {
      if (hero === 'UTG') continue;
      const key = group === 'BB' ? 'vsLimp:BB' : `vsLimp:${group}`;
      spots.push({ chartKey: key, kind: 'vsLimp', hero, villain: earlier(hero)[0] ?? null, third: null, limpers: 1 });
    }
  }
  spots.push({ chartKey: 'vsLimp:BBvsSB', kind: 'vsLimp', hero: 'BB', villain: 'SB', third: null, limpers: 1 });
  for (const opener of Object.keys(GROUPS)) {
    for (const heroGroup of Object.keys(GROUPS)) {
      const key = `vsOpen:${opener}:${heroGroup}`;
      if (!getChart(key, 100)) continue;
      for (const villain of GROUPS[opener]!) {
        for (const hero of GROUPS[heroGroup]!) {
          if (idx(hero) <= idx(villain)) continue;
          spots.push({ chartKey: key, kind: 'vsOpen', hero, villain, third: null, limpers: 0 });
        }
      }
    }
  }
  for (const group of ['EP', 'MP', 'CO', 'BTN', 'SB']) {
    for (const hero of GROUPS[group]!) {
      for (const villain of later(hero)) {
        spots.push({ chartKey: `vs3bet:${group}`, kind: 'vs3bet', hero, villain, third: null, limpers: 0 });
      }
    }
  }
  for (const hero of ['CO', 'BTN', 'SB', 'BB'] as PositionName[]) {
    const before = earlier(hero);
    if (before.length < 2) continue;
    spots.push({ chartKey: 'cold3bet', kind: 'cold3bet', hero, villain: before[0]!, third: before[before.length - 1]!, limpers: 0 });
  }
  for (const hero of ['CO', 'BTN', 'SB', 'BB'] as PositionName[]) {
    for (const villain of earlier(hero)) {
      spots.push({ chartKey: 'vs4bet', kind: 'vs4bet', hero, villain, third: null, limpers: 0 });
    }
  }
  return spots;
}

/** Hands sorted into the edge of a chart get more weight when practicing close decisions. */
function classWeights(chartKey: string, depth: ChartDepth, focusClose: boolean): Float64Array {
  const chart = getChart(chartKey, depth)!;
  const weights = new Float64Array(NUM_CLASSES);
  const best = (k: number) => {
    const r = chart.raise[k]!;
    const c = chart.call[k]!;
    const f = 1 - r - c;
    return r >= c && r >= f ? 0 : c >= f ? 1 : 2;
  };
  for (let k = 0; k < NUM_CLASSES; k++) {
    const combos = CLASS_KINDS[k] === 'pair' ? 6 : CLASS_KINDS[k] === 'suited' ? 4 : 12;
    if (!focusClose) {
      weights[k] = combos;
      continue;
    }
    const r = chart.raise[k]!;
    const c = chart.call[k]!;
    const f = 1 - r - c;
    const mixed = 1 - Math.max(r, c, f) > 0.05;
    const row = Math.floor(k / 13);
    const col = k % 13;
    let edge = false;
    for (const [dr, dc] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      const rr = row + dr;
      const cc = col + dc;
      if (rr < 0 || rr > 12 || cc < 0 || cc > 12) continue;
      if (best(rr * 13 + cc) !== best(k)) edge = true;
    }
    weights[k] = combos * (mixed ? 1 : edge ? 0.7 : 0.06);
  }
  return weights;
}

function dealClass(k: number, rng: Rng): [Card, Card] {
  const { hi, lo } = classRanks(k);
  const kind = CLASS_KINDS[k];
  if (kind === 'pair') {
    const s1 = rng.int(4);
    let s2 = rng.int(3);
    if (s2 >= s1) s2++;
    return [makeCard(hi, s1), makeCard(hi, s2)];
  }
  if (kind === 'suited') {
    const s = rng.int(4);
    return [makeCard(hi, s), makeCard(lo, s)];
  }
  const s1 = rng.int(4);
  let s2 = rng.int(3);
  if (s2 >= s1) s2++;
  return [makeCard(hi, s1), makeCard(lo, s2)];
}

export function matchingSpots(filter: DrillFilter): Spot[] {
  return allSpots().filter(
    (s) => filter.kinds.includes(s.kind) && (filter.positions.length === 0 || filter.positions.includes(s.hero)),
  );
}

export function makeQuestion(filter: DrillFilter, rng: Rng): DrillQuestion | null {
  const spots = matchingSpots(filter);
  if (spots.length === 0) return null;
  // Pick the kind of spot first so every kind comes up about equally often.
  const kinds = DRILL_KINDS.filter((k) => spots.some((s) => s.kind === k));
  const kind = pick(kinds, rng);
  const spot = pick(
    spots.filter((s) => s.kind === kind),
    rng,
  );
  const depth: ChartDepth = filter.depth === 'mixed' ? (rng.next() < 0.5 ? 100 : 200) : filter.depth;
  const chart = getChart(spot.chartKey, depth)!;
  const weights = classWeights(spot.chartKey, depth, filter.focusClose);
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng.next() * total;
  let handClass = 0;
  for (let k = 0; k < NUM_CLASSES; k++) {
    roll -= weights[k]!;
    if (roll < 0) {
      handClass = k;
      break;
    }
  }
  const canCheck = spot.chartKey === 'vsLimp:BB' || spot.chartKey === 'vsLimp:BBvsSB';
  const raise = chart.raise[handClass]!;
  const call = canCheck ? 1 - raise : chart.call[handClass]!;
  return {
    chartKey: spot.chartKey,
    depth,
    kind: spot.kind,
    heroPosition: spot.hero,
    villainPosition: spot.villain,
    thirdPosition: spot.third,
    limpers: spot.limpers,
    hand: dealClass(handClass, rng),
    handClass,
    freq: { raise, call, fold: Math.max(0, 1 - raise - call) },
    canCheck,
  };
}

export function gradeChoice(question: DrillQuestion, choice: DrillChoice): DrillVerdict {
  const mine = question.freq[choice];
  const best = Math.max(question.freq.fold, question.freq.call, question.freq.raise);
  if (mine >= best - 1e-6) return 'best';
  if (mine >= 0.25) return 'ok';
  if (mine >= 0.05) return 'inaccuracy';
  return 'mistake';
}

export interface DrillRecord {
  answered: number;
  good: number;
}

const STORAGE_KEY = 'poker-practice.drill.v1';

export function loadDrillRecords(): Record<string, DrillRecord> {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return text ? (JSON.parse(text) as Record<string, DrillRecord>) : {};
  } catch {
    return {};
  }
}

export function saveDrillRecords(records: Record<string, DrillRecord>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Not available; records last for this visit only.
  }
}
