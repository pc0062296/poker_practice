import { NUM_CLASSES } from '../eval/handClass';
import { parseRange } from './rangeString';

/**
 * Built-in preflop ranges for 9-max cash games.
 *
 * These are approximations written from publicly known strategy principles. They are
 * NOT solver output. Users can replace any chart with their own (see `setChartOverride`).
 *
 * Each chart lists the hands that raise and the hands that call; everything else folds.
 * When a hand appears in both lists, raising takes priority and calling gets what is left.
 *
 * Chart keys:
 *   rfi:<position>               first to enter the pot
 *   vsLimp:<group>               one or more limpers in front
 *   vsOpen:<opener>:<hero>       facing a single raise (groups)
 *   vs3bet:<group>               opened and got 3-bet
 *   cold3bet                     facing a raise and a 3-bet without money invested
 *   vs4bet                       3-bet and got 4-bet
 *   vs5bet                       facing a 5-bet or more
 */

export interface ChartSpec {
  raise: string;
  call: string;
}

export interface CompiledChart {
  key: string;
  depth: ChartDepth;
  raise: Float32Array;
  call: Float32Array;
}

export type ChartDepth = 100 | 200;

const BASE: Record<string, ChartSpec> = {
  // ---- First in ----
  'rfi:UTG': {
    raise: '77+,66:0.5,ATs+,A5s,A4s:0.5,KTs+,QTs+,JTs,T9s:0.5,AQo+,AJo:0.25,KQo:0.5',
    call: '',
  },
  'rfi:UTG+1': {
    raise: '66+,55:0.5,A9s+,A5s-A4s,A3s:0.5,KTs+,QTs+,JTs,T9s,98s:0.5,AQo+,AJo:0.5,KQo',
    call: '',
  },
  'rfi:UTG+2': {
    raise: '55+,A8s+,A5s-A3s,K9s+,QTs+,JTs,T9s,98s,AJo+,ATo:0.25,KQo',
    call: '',
  },
  'rfi:LJ': {
    raise: '44+,A7s+,A5s-A2s,K9s+,Q9s+,JTs,J9s:0.5,T9s,98s,87s,AJo+,ATo:0.5,KQo,KJo:0.5,QJo:0.25',
    call: '',
  },
  'rfi:HJ': {
    raise: '33+,22:0.5,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,76s,ATo+,KJo+,KTo:0.5,QJo',
    call: '',
  },
  'rfi:CO': {
    raise: '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,76s,65s,54s,A8o+,KTo+,QTo+,JTo',
    call: '',
  },
  'rfi:BTN': {
    raise:
      '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,75s+,64s+,53s+,43s,A2o+,K8o+,Q9o+,J9o+,T8o+,98o,87o:0.5',
    call: '',
  },
  'rfi:SB': {
    raise: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,86s+,75s+,65s,54s,A4o+,A3o:0.5,K9o+,Q9o+,J9o+,T9o',
    call: '',
  },

  // ---- Limpers in front: raise to isolate, or limp behind with hands that play well multiway ----
  'vsLimp:EP': {
    raise: '88+,ATs+,KJs+,QJs,AQo+,AJo:0.5,KQo:0.5,A5s:0.5',
    call: '77-22,A9s-A2s,KTs,QTs,JTs,T9s,98s,87s,76s',
  },
  'vsLimp:MP': {
    raise: '77+,ATs+,A5s,KTs+,QJs,JTs:0.5,AJo+,KQo',
    call: '66-22,A9s-A2s,K9s,QTs,Q9s,JTs,J9s,T9s,98s,87s,76s,65s',
  },
  'vsLimp:CO': {
    raise: '66+,A9s+,A5s-A4s,KTs+,QTs+,JTs,T9s:0.5,ATo+,KJo+,QJo:0.5',
    call: '55-22,A8s-A2s,K9s-K7s,Q9s,J9s,T9s,T8s,98s,97s,87s,76s,65s,54s,KTo:0.5,QTo:0.5,JTo:0.5',
  },
  'vsLimp:BTN': {
    raise: '55+,A7s+,A5s-A2s,K9s+,Q9s+,J9s+,T9s,98s:0.5,ATo+,A9o:0.5,KTo+,QTo+,JTo',
    call:
      '44-22,A6s,K8s-K2s,Q8s-Q5s,J8s-J7s,T8s-T7s,98s,97s-96s,87s-85s,76s-75s,65s-64s,54s,53s,43s,' +
      'A9o-A2o:0.5,K9o,Q9o,J9o,T9o,98o,87o:0.5',
  },
  'vsLimp:SB': {
    raise: '77+,A9s+,A5s,KTs+,QTs+,JTs,AJo+,KQo',
    call:
      '66-22,A8s-A2s,K9s-K2s,Q9s-Q4s,J9s-J6s,T9s-T6s,96s+,85s+,75s+,64s+,53s+,43s,' +
      'ATo-A2o,KJo-K8o,QJo-Q9o,JTo-J8o,T9o-T8o,98o,87o',
  },
  'vsLimp:BB': {
    raise: '88+,ATs+,KJs+,QJs,JTs:0.5,A5s:0.5,AJo+,KQo',
    call: '',
  },
  'vsLimp:BBvsSB': {
    raise:
      '66+,A8s+,A5s-A2s,K9s+,K5s:0.5,Q9s+,Q6s:0.5,J9s+,T8s+,97s+,87s,86s:0.5,76s,75s:0.5,' +
      'ATo+,KTo+,QTo+,JTo',
    call: '',
  },

  // ---- Facing a single raise. Key: vsOpen:<opener group>:<hero group> ----
  'vsOpen:EP:EP': {
    raise: 'KK+,QQ:0.75,AKs,AKo:0.25,A5s:0.25',
    call: 'QQ-TT,99:0.5,AQs,AKo:0.5,KQs:0.5,AJs:0.25',
  },
  'vsOpen:EP:MP': {
    raise: 'QQ+,AKs,AKo:0.5,A5s:0.5,KQs:0.25',
    call: 'JJ-88,77:0.5,AQs,AJs:0.5,KQs,AKo,QJs:0.25,JTs:0.25',
  },
  'vsOpen:EP:CO': {
    raise: 'QQ+,AKs,AKo:0.5,A5s:0.5,A4s:0.25,KQs:0.25',
    call: 'JJ-77,66:0.5,AQs,AJs:0.75,KQs,AKo,QJs:0.5,JTs:0.5,T9s:0.25',
  },
  'vsOpen:EP:BTN': {
    raise: 'QQ+,AKs,AKo:0.5,A5s,A4s:0.5,KJs:0.25',
    call: 'JJ-44,33:0.5,22:0.5,AQs-ATs,KQs,KJs,QJs,JTs,T9s,98s:0.5,AKo,AQo:0.5',
  },
  'vsOpen:EP:SB': {
    raise: 'QQ+,JJ:0.5,AKs,AKo,AQs:0.5,A5s:0.5,KQs:0.25',
    call: 'JJ,TT:0.5,AQs:0.5',
  },
  'vsOpen:EP:BB': {
    raise: 'QQ+,AKs,AKo:0.75,A5s,A4s:0.5,KJs:0.25,76s:0.25',
    call:
      'JJ-22,AQs-A2s,K8s+,Q9s+,J8s+,T8s+,97s+,86s+,75s+,64s+,54s,AKo,AQo,AJo,KQo,' +
      'ATo:0.5,KJo:0.5,QJo:0.25',
  },
  'vsOpen:MP:MP': {
    raise: 'QQ+,JJ:0.5,AKs,AKo:0.75,A5s,A4s:0.5,KQs:0.25',
    call: 'JJ-88,77:0.5,AQs,AJs,KQs,QJs:0.5,JTs:0.5,AKo,AQo:0.25',
  },
  'vsOpen:MP:CO': {
    raise: 'JJ+,TT:0.5,AKs,AQs:0.5,AKo,A5s,A4s,KQs:0.5,KJs:0.25,76s:0.25',
    call: 'TT-66,55:0.5,AQs,AJs,ATs:0.5,KQs,KJs:0.5,QJs:0.5,JTs:0.5,T9s:0.25,AQo:0.25',
  },
  'vsOpen:MP:BTN': {
    raise: 'JJ+,AKs,AKo,AQs:0.5,A5s-A3s,KJs:0.5,K9s:0.25,AQo:0.25,87s:0.25',
    call: 'TT-22,AQs,AJs-A9s,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s:0.5,AQo,KQo:0.5,AJo:0.25',
  },
  'vsOpen:MP:SB': {
    raise: 'TT+,AKs,AQs,AKo,AJs:0.5,A5s,A4s:0.5,KQs,KJs:0.5,AQo:0.5',
    call: 'TT:0.25,99:0.5',
  },
  'vsOpen:MP:BB': {
    raise: 'JJ+,AKs,AKo,AQs:0.5,A5s-A3s,KJs:0.25,K9s:0.25,65s:0.5,54s:0.5',
    call:
      'TT-22,A2s+,K5s+,Q8s+,J8s+,T7s+,96s+,85s+,75s+,64s+,53s+,43s,AQo,AJo,ATo,KQo,KJo,' +
      'KTo:0.5,QJo,QTo:0.5,JTo:0.5',
  },
  'vsOpen:CO:BTN': {
    raise:
      'TT+,AKs,AQs,AKo,AJs:0.5,A5s-A2s,KQs:0.5,KJs:0.5,KTs:0.5,AQo:0.5,QJs:0.25,76s:0.5,65s:0.5,KQo:0.25',
    call: '99-22,AJs,ATs-A6s,KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,87s,AQo,AJo:0.5,KQo:0.5',
  },
  'vsOpen:CO:SB': {
    raise: '99+,88:0.5,ATs+,AKo,AQo,AJo:0.5,A5s-A2s,KTs+,QJs,QTs:0.5,JTs:0.5,KQo:0.5,T9s:0.5',
    call: '',
  },
  'vsOpen:CO:BB': {
    raise:
      'TT+,AQs+,AKo,AQo:0.5,AJs:0.5,A5s-A2s,KQs:0.5,KTs:0.5,K6s:0.25,Q9s:0.25,87s:0.5,76s:0.5,65s:0.5,54s:0.5',
    call:
      '99-22,A2s+,K2s+,Q4s+,J7s+,T7s+,96s+,85s+,74s+,64s+,53s+,43s,A8o+,A5o:0.5,KTo+,K9o:0.5,' +
      'QTo+,Q9o:0.5,JTo,J9o:0.5,T9o,98o:0.5',
  },
  'vsOpen:BTN:SB': {
    raise: '88+,77:0.5,A8s+,A5s-A2s,KTs+,K9s:0.5,QTs+,JTs,T9s:0.5,AJo+,KQo,ATo:0.5,KJo:0.25',
    call: '',
  },
  'vsOpen:BTN:BB': {
    raise:
      '99+,88:0.5,AJs+,AQo+,A5s-A2s,KJs+,KTs:0.5,QJs:0.5,K5s:0.25,Q8s:0.25,J8s:0.25,T8s:0.5,97s:0.5,' +
      '86s:0.5,75s:0.5,64s:0.5,AJo:0.5,KQo:0.5',
    call:
      '22+,A2s+,K2s+,Q2s+,J4s+,T6s+,95s+,85s+,74s+,63s+,53s+,43s,A2o+,K7o+,Q8o+,J8o+,T8o+,97o+,87o,76o:0.5',
  },
  'vsOpen:SB:BB': {
    raise:
      '99+,AJs+,AQo+,A5s-A2s,KJs+,K9s:0.5,QJs:0.5,T9s:0.5,98s:0.5,87s:0.5,76s:0.5,65s:0.5,AJo:0.5,' +
      'KQo:0.5,KJo:0.25',
    call:
      '22+,A2s+,K2s+,Q2s+,J5s+,T6s+,95s+,85s+,74s+,64s+,53s+,43s,A2o+,K8o+,Q9o+,J8o+,T8o+,98o,87o:0.5',
  },

  // ---- Opened and got 3-bet. Key: vs3bet:<hero group> ----
  'vs3bet:EP': {
    raise: 'KK+,QQ:0.25,AKs:0.5,AKo:0.25,A5s:0.25',
    call: 'QQ,JJ,TT:0.75,99:0.5,AKs,AKo:0.5,AQs,KQs:0.5,AJs:0.25',
  },
  'vs3bet:MP': {
    raise: 'KK+,QQ:0.5,AKs:0.5,AKo:0.5,A5s:0.5,A4s:0.25',
    call: 'QQ-88,77:0.5,AKs,AKo,AQs,AJs,KQs,KJs:0.5,QJs,JTs,T9s:0.5,AQo:0.5',
  },
  'vs3bet:CO': {
    raise: 'QQ+,JJ:0.25,AKs:0.5,AKo:0.75,A5s,A4s:0.5',
    call: 'JJ-66,55:0.5,AKs,AKo,AQs,AJs,ATs,A9s:0.5,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s:0.5,AQo,KQo:0.5',
  },
  'vs3bet:BTN': {
    raise: 'QQ+,JJ:0.5,AKs:0.5,AKo,A5s-A3s,AQo:0.25,K5s:0.25',
    call:
      'JJ-44,33:0.5,22:0.5,AKs,AQs-A7s,A6s:0.5,KQs-K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s:0.5,87s,76s,' +
      '65s,54s:0.5,AQo,AJo,ATo:0.25,KQo,KJo:0.5',
  },
  'vs3bet:SB': {
    raise: 'QQ+,JJ:0.5,AKs:0.5,AKo,A5s-A4s,AQo:0.25',
    call:
      'JJ-55,44:0.5,AKs,AQs-A8s,A7s:0.5,KQs-K9s,QJs,QTs,Q9s:0.5,JTs,J9s,T9s,T8s:0.5,98s,87s,76s:0.5,' +
      'AQo,AJo,ATo:0.5,KQo,KJo:0.5',
  },

  // ---- Later raising rounds ----
  cold3bet: {
    raise: 'KK+,QQ:0.25,AKs:0.5',
    call: 'QQ:0.5,AKs:0.5,JJ:0.25',
  },
  vs4bet: {
    raise: 'KK+,QQ:0.25,AKs:0.75,AKo:0.5,A5s:0.25',
    call: 'QQ,JJ:0.5,TT:0.25,AKs,AKo:0.5,AQs:0.25',
  },
  vs5bet: {
    raise: '',
    call: 'KK+,QQ:0.5,AKs',
  },
};

/** Charts that change when stacks are around 200 big blinds: tighter stack-offs, more calling. */
const DEEP: Record<string, ChartSpec> = {
  'vs3bet:EP': {
    raise: 'KK+,AKs:0.25,A5s:0.25',
    call: 'QQ-88,77:0.5,AKs,AKo:0.75,AQs,AJs:0.5,KQs,QJs:0.5,JTs:0.5',
  },
  'vs3bet:MP': {
    raise: 'KK+,QQ:0.25,AKs:0.25,AKo:0.25,A5s:0.5',
    call: 'QQ-77,66:0.5,AKs,AKo,AQs,AJs,KQs,KJs:0.5,QJs,JTs,T9s:0.5,AQo:0.25',
  },
  'vs3bet:CO': {
    raise: 'KK+,QQ:0.5,AKs:0.25,AKo:0.5,A5s,A4s:0.5',
    call: 'QQ-55,AKs,AKo,AQs-ATs,A9s:0.5,KQs-KTs,QJs,QTs,JTs,T9s,98s,87s:0.5,AQo:0.5,KQo:0.25',
  },
  'vs3bet:BTN': {
    raise: 'KK+,QQ:0.5,AKs:0.25,AKo:0.5,A5s-A3s,K5s:0.25',
    call:
      'QQ-33,22:0.5,AKs,AKo,AQs-A6s,KQs-K9s,K8s:0.5,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,86s:0.5,76s,' +
      '75s:0.5,65s,54s:0.5,AQo,AJo,ATo:0.5,KQo,KJo:0.5,QJo:0.5',
  },
  'vs3bet:SB': {
    raise: 'KK+,QQ:0.5,AKs:0.25,AKo:0.5,A5s-A4s',
    call:
      'QQ-55,44:0.5,AKs,AKo,AQs-A7s,KQs-K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,87s,76s,65s:0.5,' +
      'AQo,AJo,ATo:0.5,KQo,KJo:0.5',
  },
  cold3bet: {
    raise: 'KK+,AKs:0.25',
    call: 'QQ,JJ:0.5,AKs:0.75,AKo:0.25',
  },
  vs4bet: {
    raise: 'AA,KK:0.5,AKs:0.25,A5s:0.25',
    call: 'KK,QQ,JJ,TT:0.5,AKs,AKo:0.75,AQs,KQs:0.5,JTs:0.25',
  },
  vs5bet: {
    raise: '',
    call: 'AA,KK:0.75',
  },
};

const overrides = new Map<string, ChartSpec>();
const cache = new Map<string, CompiledChart | null>();

function compile(key: string, depth: ChartDepth, spec: ChartSpec): CompiledChart {
  const raise = parseRange(spec.raise);
  const callSpec = parseRange(spec.call);
  const call = new Float32Array(NUM_CLASSES);
  for (let k = 0; k < NUM_CLASSES; k++) call[k] = Math.min(callSpec[k]!, 1 - raise[k]!);
  return { key, depth, raise, call };
}

/** Look up a chart. User overrides win over the built-in deep and base sets. */
export function getChart(key: string, depth: ChartDepth): CompiledChart | null {
  const cacheKey = `${depth}|${key}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const spec = overrides.get(cacheKey) ?? (depth === 200 ? DEEP[key] : undefined) ?? BASE[key];
  const compiled = spec ? compile(key, depth, spec) : null;
  cache.set(cacheKey, compiled);
  return compiled;
}

/** Replace a chart with a user-supplied one; pass null to restore the built-in chart. */
export function setChartOverride(key: string, depth: ChartDepth, spec: ChartSpec | null): void {
  const cacheKey = `${depth}|${key}`;
  if (spec) overrides.set(cacheKey, spec);
  else overrides.delete(cacheKey);
  cache.delete(cacheKey);
}

/** Every built-in chart key. */
export function chartKeys(): string[] {
  return Object.keys(BASE);
}

/** The raw text of a built-in chart, for display and export. */
export function builtinChartSpec(key: string, depth: ChartDepth): ChartSpec | null {
  return (depth === 200 ? DEEP[key] : undefined) ?? BASE[key] ?? null;
}
