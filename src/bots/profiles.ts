/**
 * Opponent profiles. A profile either uses the baseline strategy or the human-style engine
 * with a set of tendencies. The presets describe common live-game player types; they are
 * assumptions about typical players, not measured data, and every number can be adjusted.
 */

export interface HumanParams {
  /** Width multiplier for every range the player enters the pot with. 1 is a solid regular. */
  looseness: number;
  /** Share of first-in hands that are raised rather than limped (0..1). */
  raiseFirstIn: number;
  /** Share of all hands that 3-bet when facing a single raise. */
  threeBet: number;
  /** Share of the opening range that continues against a 3-bet. */
  continueVs3bet: number;
  /** How much ranges change with position (0 ignores position, 1 fully positional). */
  positionSense: number;
  /** Open-raise size in big blinds (or straddles). */
  openSize: number;
  /** Chance to bet or raise strong hands when checked to. */
  betStrong: number;
  /** Chance to bet medium-strength hands when checked to. */
  betMedium: number;
  /** Chance to bet hands with no showdown value. */
  bluff: number;
  /** Chance to continuation-bet the flop as the preflop raiser without a strong hand. */
  cbet: number;
  /** How light the player calls bets: 0 folds a lot, 1 calls almost anything. */
  sticky: number;
  /** Chance to raise strong hands when facing a bet. */
  raiseStrong: number;
  /** Usual bet size as a fraction of the pot. */
  betSize: number;
}

export type ProfileId =
  | 'baseline'
  | 'tag'
  | 'lag'
  | 'nit'
  | 'station'
  | 'limper'
  | 'maniac'
  | 'population'
  | 'custom';

export interface Profile {
  id: ProfileId;
  engine: 'baseline' | 'human';
  /** Present for the human engine. */
  params?: HumanParams;
}

export const HUMAN_PRESETS: Record<Exclude<ProfileId, 'baseline' | 'custom'>, HumanParams> = {
  tag: {
    looseness: 1.0,
    raiseFirstIn: 0.97,
    threeBet: 0.055,
    continueVs3bet: 0.45,
    positionSense: 0.9,
    openSize: 3,
    betStrong: 0.8,
    betMedium: 0.35,
    bluff: 0.18,
    cbet: 0.6,
    sticky: 0.45,
    raiseStrong: 0.45,
    betSize: 0.6,
  },
  lag: {
    looseness: 1.5,
    raiseFirstIn: 0.95,
    threeBet: 0.1,
    continueVs3bet: 0.55,
    positionSense: 0.8,
    openSize: 3,
    betStrong: 0.85,
    betMedium: 0.5,
    bluff: 0.32,
    cbet: 0.75,
    sticky: 0.5,
    raiseStrong: 0.55,
    betSize: 0.7,
  },
  nit: {
    looseness: 0.6,
    raiseFirstIn: 0.8,
    threeBet: 0.025,
    continueVs3bet: 0.3,
    positionSense: 0.6,
    openSize: 3.5,
    betStrong: 0.65,
    betMedium: 0.15,
    bluff: 0.05,
    cbet: 0.4,
    sticky: 0.15,
    raiseStrong: 0.35,
    betSize: 0.55,
  },
  station: {
    looseness: 2.7,
    raiseFirstIn: 0.35,
    threeBet: 0.025,
    continueVs3bet: 0.7,
    positionSense: 0.3,
    openSize: 4,
    betStrong: 0.55,
    betMedium: 0.2,
    bluff: 0.06,
    cbet: 0.35,
    sticky: 0.92,
    raiseStrong: 0.2,
    betSize: 0.5,
  },
  limper: {
    looseness: 3.1,
    raiseFirstIn: 0.15,
    threeBet: 0.02,
    continueVs3bet: 0.6,
    positionSense: 0.2,
    openSize: 4,
    betStrong: 0.5,
    betMedium: 0.25,
    bluff: 0.1,
    cbet: 0.3,
    sticky: 0.7,
    raiseStrong: 0.25,
    betSize: 0.45,
  },
  maniac: {
    looseness: 2.8,
    raiseFirstIn: 0.9,
    threeBet: 0.2,
    continueVs3bet: 0.8,
    positionSense: 0.3,
    openSize: 5,
    betStrong: 0.9,
    betMedium: 0.7,
    bluff: 0.55,
    cbet: 0.85,
    sticky: 0.65,
    raiseStrong: 0.5,
    betSize: 0.9,
  },
  population: {
    looseness: 2.0,
    raiseFirstIn: 0.55,
    threeBet: 0.04,
    continueVs3bet: 0.55,
    positionSense: 0.5,
    openSize: 3.5,
    betStrong: 0.7,
    betMedium: 0.3,
    bluff: 0.14,
    cbet: 0.55,
    sticky: 0.6,
    raiseStrong: 0.35,
    betSize: 0.55,
  },
};

/** Profiles a seat can be given, in display order. */
export const SEAT_PROFILE_IDS: ProfileId[] = [
  'baseline',
  'tag',
  'lag',
  'nit',
  'station',
  'limper',
  'maniac',
  'population',
  'custom',
];

export type TablePresetId = 'macau' | 'taiwan' | 'baseline' | 'custom';

/** Relative frequency of each player type at a table preset. */
export const TABLE_PRESETS: Record<Exclude<TablePresetId, 'custom'>, Partial<Record<ProfileId, number>>> = {
  macau: { limper: 0.25, station: 0.2, tag: 0.2, nit: 0.15, lag: 0.1, maniac: 0.05, baseline: 0.05 },
  taiwan: { tag: 0.3, lag: 0.15, limper: 0.2, station: 0.15, nit: 0.15, maniac: 0.05 },
  baseline: { baseline: 1 },
};

/** Simple settings for a custom opponent, in terms poker players use. */
export interface CustomProfileSettings {
  /** Voluntarily put money in pot, percent. */
  vpip: number;
  /** Preflop raise, percent (at most vpip). */
  pfr: number;
  /** 3-bet, percent. */
  threeBet: number;
  /** Postflop aggression, 0..100. */
  aggression: number;
  /** Bluffing, 0..100. */
  bluff: number;
  /** Calling stickiness, 0..100. */
  sticky: number;
  /** Open size in big blinds. */
  openSize: number;
}

export const DEFAULT_CUSTOM: CustomProfileSettings = {
  vpip: 30,
  pfr: 15,
  threeBet: 5,
  aggression: 50,
  bluff: 20,
  sticky: 55,
  openSize: 3.5,
};

/**
 * Looseness and the VPIP (percent) it produced in calibration: a seat at a mixed nine-handed
 * table, 5,000 hands per point (see profiles.test.ts for the check). VPIP barely depends on
 * the raise-first-in share, so one curve covers every setting.
 */
const VPIP_CALIBRATION: [number, number][] = [
  [0.4, 7.9],
  [0.6, 11.2],
  [0.8, 14.2],
  [1.0, 17.3],
  [1.3, 22.0],
  [1.6, 27.1],
  [2.0, 32.0],
  [2.5, 38.8],
  [3.0, 45.9],
  [3.6, 52.8],
  [4.4, 60.4],
];

/**
 * In the same calibration PFR / VPIP came out at about 0.25 + 0.45 * raiseFirstIn, so the
 * highest reachable ratio is about 0.7.
 */
const PFR_RATIO_BASE = 0.25;
const PFR_RATIO_SLOPE = 0.45;

function interpolate(points: [number, number][], y: number): number {
  if (y <= points[0]![1]) return points[0]![0];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    if (y <= y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return points[points.length - 1]![0];
}

/** Turn custom settings into engine parameters. */
export function customParams(c: CustomProfileSettings): HumanParams {
  const vpip = Math.max(5, Math.min(60, c.vpip));
  const pfr = Math.max(0, Math.min(vpip, c.pfr));
  const aggression = c.aggression / 100;
  return {
    looseness: interpolate(VPIP_CALIBRATION, vpip),
    raiseFirstIn: Math.max(0.05, Math.min(1, (pfr / vpip - PFR_RATIO_BASE) / PFR_RATIO_SLOPE)),
    threeBet: Math.max(0, Math.min(0.3, c.threeBet / 100)),
    continueVs3bet: 0.35 + 0.4 * (c.sticky / 100),
    positionSense: Math.max(0.2, 1 - vpip / 80),
    openSize: Math.max(2, Math.min(8, c.openSize)),
    betStrong: 0.45 + 0.5 * aggression,
    betMedium: 0.1 + 0.6 * aggression,
    bluff: (c.bluff / 100) * 0.7,
    cbet: 0.3 + 0.6 * aggression,
    sticky: c.sticky / 100,
    raiseStrong: 0.15 + 0.5 * aggression,
    betSize: 0.45 + 0.45 * aggression,
  };
}

export function makeProfile(id: ProfileId, custom: CustomProfileSettings = DEFAULT_CUSTOM): Profile {
  if (id === 'baseline') return { id, engine: 'baseline' };
  if (id === 'custom') return { id, engine: 'human', params: customParams(custom) };
  return { id, engine: 'human', params: HUMAN_PRESETS[id] };
}
