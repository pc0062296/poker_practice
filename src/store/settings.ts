import {
  DEFAULT_CUSTOM,
  SEAT_PROFILE_IDS,
  type CustomProfileSettings,
  type ProfileId,
  type TablePresetId,
} from '../bots/profiles';
import type { StraddleMode, TableConfig, TopUpMode } from '../engine/session';
import type { LineupOptions } from '../game/lineup';

export const UNITS_PER_BB = 100;

export type BotSpeed = 'fast' | 'normal' | 'slow';
export type DisplayUnit = 'bb' | 'chips';
export type SeatChangeRate = 'off' | 'sometimes' | 'often';

export const SEAT_CHANGE_RATE: Record<SeatChangeRate, number> = { off: 0, sometimes: 0.03, often: 0.08 };

export interface Settings {
  // Table settings: changing these restarts the table.
  numPlayers: number;
  heroBuyInBB: number;
  botBuyInMinBB: number;
  botBuyInMaxBB: number;
  topUp: TopUpMode;
  straddle: StraddleMode;
  rakePercent: number;
  rakeCapBB: number;
  noFlopNoDrop: boolean;
  openSizeBB: number;
  tablePreset: TablePresetId;
  /** Profiles for the eight bot seats when the preset is 'custom'. */
  seatProfiles: ProfileId[];
  customProfile: CustomProfileSettings;
  shortStacks: boolean;
  // Applied without restarting the table.
  showTypes: boolean;
  seatChanges: SeatChangeRate;
  // Display and pace: applied immediately.
  botSpeed: BotSpeed;
  fourColor: boolean;
  unit: DisplayUnit;
  bigBlindAmount: number;
  skipAfterFold: boolean;
  autoNextSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  numPlayers: 9,
  heroBuyInBB: 200,
  botBuyInMinBB: 200,
  botBuyInMaxBB: 250,
  topUp: 'always',
  straddle: 'off',
  rakePercent: 5,
  rakeCapBB: 3,
  noFlopNoDrop: true,
  openSizeBB: 3,
  tablePreset: 'macau',
  seatProfiles: ['tag', 'limper', 'station', 'nit', 'lag', 'population', 'limper', 'tag'],
  customProfile: DEFAULT_CUSTOM,
  shortStacks: true,
  showTypes: true,
  seatChanges: 'sometimes',
  botSpeed: 'normal',
  fourColor: true,
  unit: 'bb',
  bigBlindAmount: 100,
  skipAfterFold: true,
  autoNextSeconds: 0,
};

const TABLE_KEYS: (keyof Settings)[] = [
  'numPlayers',
  'heroBuyInBB',
  'botBuyInMinBB',
  'botBuyInMaxBB',
  'topUp',
  'straddle',
  'rakePercent',
  'rakeCapBB',
  'noFlopNoDrop',
  'openSizeBB',
  'tablePreset',
  'shortStacks',
];

/** True when two settings differ in something that needs a new table. */
function lineupChanged(a: Settings, b: Settings): boolean {
  return (
    JSON.stringify(a.seatProfiles) !== JSON.stringify(b.seatProfiles) ||
    JSON.stringify(a.customProfile) !== JSON.stringify(b.customProfile)
  );
}

/** True when a settings change needs a new table. */
export function needsRestart(a: Settings, b: Settings): boolean {
  return TABLE_KEYS.some((key) => a[key] !== b[key]) || lineupChanged(a, b);
}

const STORAGE_KEY = 'poker-practice.settings.v1';

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Make sure settings read from storage are complete and within range. */
export function sanitizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const d = DEFAULT_SETTINGS;
  const r = raw ?? {};
  const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const heroBuyInBB = Math.round(clamp(r.heroBuyInBB, 20, 1000, d.heroBuyInBB));
  const minBB = Math.round(clamp(r.botBuyInMinBB, 20, 1000, d.botBuyInMinBB));
  const maxBB = Math.round(clamp(r.botBuyInMaxBB, 20, 1000, d.botBuyInMaxBB));
  return {
    numPlayers: Math.round(clamp(r.numPlayers, 2, 9, d.numPlayers)),
    heroBuyInBB,
    botBuyInMinBB: Math.min(minBB, maxBB),
    botBuyInMaxBB: Math.max(minBB, maxBB),
    topUp: pick(r.topUp, ['always', 'bust'] as const, d.topUp),
    straddle: pick(r.straddle, ['off', 'always', 'sometimes'] as const, d.straddle),
    rakePercent: clamp(r.rakePercent, 0, 20, d.rakePercent),
    rakeCapBB: clamp(r.rakeCapBB, 0, 100, d.rakeCapBB),
    noFlopNoDrop: typeof r.noFlopNoDrop === 'boolean' ? r.noFlopNoDrop : d.noFlopNoDrop,
    openSizeBB: clamp(r.openSizeBB, 2, 6, d.openSizeBB),
    tablePreset: pick(r.tablePreset, ['macau', 'taiwan', 'baseline', 'custom'] as const, d.tablePreset),
    seatProfiles: d.seatProfiles.map((fallback, i) => pick(r.seatProfiles?.[i], SEAT_PROFILE_IDS, fallback)),
    customProfile: sanitizeCustom(r.customProfile),
    shortStacks: typeof r.shortStacks === 'boolean' ? r.shortStacks : d.shortStacks,
    showTypes: typeof r.showTypes === 'boolean' ? r.showTypes : d.showTypes,
    seatChanges: pick(r.seatChanges, ['off', 'sometimes', 'often'] as const, d.seatChanges),
    botSpeed: pick(r.botSpeed, ['fast', 'normal', 'slow'] as const, d.botSpeed),
    fourColor: typeof r.fourColor === 'boolean' ? r.fourColor : d.fourColor,
    unit: pick(r.unit, ['bb', 'chips'] as const, d.unit),
    bigBlindAmount: Math.round(clamp(r.bigBlindAmount, 1, 1_000_000, d.bigBlindAmount)),
    skipAfterFold: typeof r.skipAfterFold === 'boolean' ? r.skipAfterFold : d.skipAfterFold,
    autoNextSeconds: Math.round(clamp(r.autoNextSeconds, 0, 30, d.autoNextSeconds)),
  };
}

function sanitizeCustom(raw: Partial<CustomProfileSettings> | undefined): CustomProfileSettings {
  const d = DEFAULT_CUSTOM;
  const r = raw ?? {};
  const vpip = clamp(r.vpip, 5, 60, d.vpip);
  return {
    vpip,
    pfr: Math.min(vpip, clamp(r.pfr, 0, 60, d.pfr)),
    threeBet: clamp(r.threeBet, 0, 30, d.threeBet),
    aggression: clamp(r.aggression, 0, 100, d.aggression),
    bluff: clamp(r.bluff, 0, 100, d.bluff),
    sticky: clamp(r.sticky, 0, 100, d.sticky),
    openSize: clamp(r.openSize, 2, 8, d.openSize),
  };
}

export function loadSettings(): Settings {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return sanitizeSettings(text ? (JSON.parse(text) as Partial<Settings>) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); settings then last for this visit only.
  }
}

/** Convert settings to the engine's table configuration. */
export function toTableConfig(settings: Settings): TableConfig {
  return {
    numPlayers: settings.numPlayers,
    smallBlind: UNITS_PER_BB / 2,
    bigBlind: UNITS_PER_BB,
    heroBuyIn: settings.heroBuyInBB * UNITS_PER_BB,
    botBuyInMin: settings.botBuyInMinBB * UNITS_PER_BB,
    botBuyInMax: settings.botBuyInMaxBB * UNITS_PER_BB,
    topUp: settings.topUp,
    straddle: settings.straddle,
    rake: {
      percent: settings.rakePercent,
      cap: Math.round(settings.rakeCapBB * UNITS_PER_BB),
      noFlopNoDrop: settings.noFlopNoDrop,
    },
  };
}

export function toLineup(settings: Settings): LineupOptions {
  return {
    preset: settings.tablePreset,
    customSeats: settings.seatProfiles,
    custom: settings.customProfile,
    shortStacks: settings.shortStacks,
  };
}
