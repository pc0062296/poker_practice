import type { Chips, PositionName, PublicView } from '../engine/types';
import { getChart, type ChartDepth, type CompiledChart } from './charts';

/** Summary of the preflop action before a decision. */
export interface PreflopSituation {
  /** Amount needed to enter an unraised pot: the big blind or the straddle. */
  level: Chips;
  /** Number of raises so far. */
  raises: number;
  /** Players who limped before any raise and are still in. */
  limpers: number[];
  /** Players who called the latest raise and are still in. */
  callers: number[];
  /** First raiser, or -1. */
  opener: number;
  /** Latest raiser, or -1. */
  lastRaiser: number;
  /** Total of the latest raise, or the level when unraised. */
  lastRaiseTo: Chips;
  /** Ordinals (1 = open, 2 = 3-bet, ...) of the raises the actor made. */
  actorRaises: number[];
  actorLimped: boolean;
  actorCalledRaise: boolean;
}

export type ScenarioKind =
  | 'rfi'
  | 'vsLimp'
  | 'vsOpen'
  | 'squeeze'
  | 'vs3bet'
  | 'cold3bet'
  | 'vs4bet'
  | 'vs5bet'
  | 'other';

export type PositionGroup = 'EP' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export interface PreflopScenario {
  kind: ScenarioKind;
  situation: PreflopSituation;
  /** Chart key, or null when no chart covers this spot. */
  chartKey: string | null;
  chart: CompiledChart | null;
  /** True when the chart is only a rough match for the situation. */
  approx: boolean;
  depth: ChartDepth;
  /** Effective stack in units of the blind level. */
  depthLevels: number;
  heroPosition: PositionName;
  /** Position of the opener or latest raiser when relevant. */
  villainPosition: PositionName | null;
}

/** Walk the preflop action log and summarize it from the actor's point of view. */
export function analyzePreflop(view: PublicView, actor: number): PreflopSituation {
  const level = view.straddleIndex >= 0 ? view.config.straddle : view.config.bigBlind;
  const sit: PreflopSituation = {
    level,
    raises: 0,
    limpers: [],
    callers: [],
    opener: -1,
    lastRaiser: -1,
    lastRaiseTo: level,
    actorRaises: [],
    actorLimped: false,
    actorCalledRaise: false,
  };
  for (const e of view.events) {
    if (e.kind !== 'action' || e.street !== 'preflop') continue;
    if (e.type === 'raise' || e.type === 'bet') {
      sit.raises++;
      if (sit.opener < 0) sit.opener = e.player;
      sit.lastRaiser = e.player;
      sit.lastRaiseTo = e.to;
      sit.callers = [];
      if (e.player === actor) sit.actorRaises.push(sit.raises);
    } else if (e.type === 'call') {
      if (sit.raises === 0) {
        sit.limpers.push(e.player);
        if (e.player === actor) sit.actorLimped = true;
      } else {
        sit.callers.push(e.player);
        if (e.player === actor) sit.actorCalledRaise = true;
      }
    } else if (e.type === 'fold') {
      sit.limpers = sit.limpers.filter((i) => i !== e.player);
      sit.callers = sit.callers.filter((i) => i !== e.player);
    }
  }
  return sit;
}

export function positionGroup(position: PositionName): PositionGroup {
  switch (position) {
    case 'UTG':
    case 'UTG+1':
    case 'UTG+2':
      return 'EP';
    case 'LJ':
    case 'HJ':
      return 'MP';
    case 'CO':
      return 'CO';
    case 'BTN':
      return 'BTN';
    case 'SB':
      return 'SB';
    default:
      return 'BB';
  }
}

const OPEN_VS: Record<PositionGroup, PositionGroup[]> = {
  EP: ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'],
  MP: ['MP', 'CO', 'BTN', 'SB', 'BB'],
  CO: ['BTN', 'SB', 'BB'],
  BTN: ['SB', 'BB'],
  SB: ['BB'],
  BB: [],
};

/**
 * In a straddled pot the straddler plays the role of the big blind and the blinds act
 * earlier than usual. This maps a position to the chart position that fits best.
 */
function effectivePosition(view: PublicView, index: number): { position: PositionName; shifted: boolean } {
  const position = view.players[index]!.position;
  if (view.straddleIndex < 0) return { position, shifted: false };
  if (index === view.straddleIndex) return { position: 'BB', shifted: true };
  if (position === 'BB') return { position: 'SB', shifted: true };
  if (position === 'SB') return { position: 'SB', shifted: true };
  return { position, shifted: false };
}

/** Effective stack of the actor against the deepest opponent still in the hand. */
function effectiveStack(view: PublicView, actor: number): Chips {
  const me = view.players[actor]!;
  const mine = me.stack + me.totalContributed;
  let deepest = 0;
  for (const p of view.players) {
    if (p.index === actor || p.folded) continue;
    deepest = Math.max(deepest, p.stack + p.totalContributed);
  }
  return Math.min(mine, deepest);
}

/** Classify the preflop spot the actor is in and find the chart that covers it. */
export function classifyPreflop(view: PublicView, actor: number): PreflopScenario {
  const situation = analyzePreflop(view, actor);
  const hero = effectivePosition(view, actor);
  const heroGroup = positionGroup(hero.position);
  const depthLevels = effectiveStack(view, actor) / situation.level;
  const depth: ChartDepth = depthLevels >= 150 ? 200 : 100;
  let approx = hero.shifted || depthLevels < 40;

  let kind: ScenarioKind = 'other';
  let chartKey: string | null = null;
  let villain = -1;
  const { raises, limpers, callers, opener, lastRaiser, actorRaises, actorLimped, actorCalledRaise } = situation;
  const actorActed = actorRaises.length > 0 || actorLimped || actorCalledRaise;

  if (raises === 0) {
    if (limpers.length === 0) {
      kind = 'rfi';
      if (view.players.length === 2) {
        chartKey = 'rfi:BTN';
        approx = true;
      } else if (hero.position === 'BB') {
        // Only reachable in a straddled pot.
        chartKey = 'rfi:SB';
        approx = true;
      } else {
        chartKey = `rfi:${hero.position}`;
      }
    } else if (!actorActed) {
      kind = 'vsLimp';
      if (heroGroup === 'BB') {
        const onlySmallBlind = limpers.length === 1 && limpers[0] === view.sbIndex && view.straddleIndex < 0;
        chartKey = onlySmallBlind ? 'vsLimp:BBvsSB' : 'vsLimp:BB';
      } else {
        chartKey = `vsLimp:${heroGroup}`;
      }
    }
  } else if (raises === 1) {
    villain = opener;
    if (!actorActed) {
      kind = callers.length > 0 ? 'squeeze' : 'vsOpen';
      const openerGroup = positionGroup(effectivePosition(view, opener).position);
      // Clamp to a chart that exists when positions were shifted by a straddle.
      const options = OPEN_VS[openerGroup];
      const group = options.includes(heroGroup) ? heroGroup : options[options.length - 1];
      if (group) {
        chartKey = `vsOpen:${openerGroup}:${group}`;
        if (group !== heroGroup || callers.length > 0 || limpers.length > 0) approx = true;
      }
    }
  } else if (raises === 2) {
    villain = lastRaiser;
    if (actorRaises.includes(1)) {
      kind = 'vs3bet';
      chartKey = `vs3bet:${heroGroup === 'BB' ? 'SB' : heroGroup}`;
      if (callers.length > 0) approx = true;
    } else {
      kind = 'cold3bet';
      chartKey = 'cold3bet';
      if (actorActed) approx = true;
    }
  } else if (raises === 3) {
    villain = lastRaiser;
    if (actorRaises.includes(2)) {
      kind = 'vs4bet';
      chartKey = 'vs4bet';
    } else {
      kind = 'vs5bet';
      chartKey = 'vs5bet';
      approx = true;
    }
  } else {
    villain = lastRaiser;
    kind = 'vs5bet';
    chartKey = 'vs5bet';
  }

  const chart = chartKey ? getChart(chartKey, depth) : null;
  return {
    kind,
    situation,
    chartKey: chart ? chartKey : null,
    chart,
    approx,
    depth,
    depthLevels,
    heroPosition: view.players[actor]!.position,
    villainPosition: villain >= 0 ? view.players[villain]!.position : null,
  };
}
