import { baselinePolicy } from '../bots/baselinePolicy';
import { policyFor } from '../bots/policies';
import {
  DEFAULT_CUSTOM,
  makeProfile,
  TABLE_PRESETS,
  type CustomProfileSettings,
  type ProfileId,
  type TablePresetId,
} from '../bots/profiles';
import type { Policy } from '../bots/types';
import type { Rng } from '../engine/rng';
import { drawBuyIn, replaceSeat, type Session, type TableConfig } from '../engine/session';
import type { Chips } from '../engine/types';

export interface LineupOptions {
  preset: TablePresetId;
  /** Profiles for bot seats when the preset is 'custom' (index 0 = first bot). */
  customSeats: ProfileId[];
  custom: CustomProfileSettings;
  /** Some bots buy in short (40-120 big blinds). */
  shortStacks: boolean;
}

export const DEFAULT_LINEUP: LineupOptions = {
  preset: 'macau',
  customSeats: [],
  custom: DEFAULT_CUSTOM,
  shortStacks: true,
};

const SHORT_STACK_CHANCE = 0.2;

/** Draw a player type from a preset's mix. */
export function drawProfile(preset: TablePresetId, rng: Rng): ProfileId {
  if (preset === 'custom') return 'population';
  const mix = TABLE_PRESETS[preset];
  const entries = Object.entries(mix) as [ProfileId, number][];
  let total = 0;
  for (const [, w] of entries) total += w;
  let roll = rng.next() * total;
  for (const [id, w] of entries) {
    roll -= w;
    if (roll < 0) return id;
  }
  return entries[entries.length - 1]![0];
}

/** Profiles for every bot seat. */
export function assignProfiles(options: LineupOptions, numBots: number, rng: Rng): ProfileId[] {
  const out: ProfileId[] = [];
  for (let i = 0; i < numBots; i++) {
    out.push(options.preset === 'custom' ? (options.customSeats[i] ?? 'population') : drawProfile(options.preset, rng));
  }
  return out;
}

/** A bot buy-in, sometimes short when short stacks are enabled. */
export function drawBotBuyIn(config: TableConfig, options: LineupOptions, rng: Rng): Chips {
  if (options.shortStacks && rng.next() < SHORT_STACK_CHANCE) {
    return config.bigBlind * (40 + 10 * rng.int(9));
  }
  return drawBuyIn(config, rng);
}

/** Strategy for each seat of a session (the hero's entry is the baseline and is not used). */
export function seatPolicies(session: Session, options: LineupOptions): Policy[] {
  return session.seats.map((seat) =>
    seat.isHero ? baselinePolicy : policyFor(makeProfile(seat.profile as ProfileId, options.custom)),
  );
}

/**
 * The strategy everyone assumes the others play. At a table of baseline bots that is the
 * baseline; anywhere else it is a generic live player.
 */
export function observerPolicy(session: Session, options: LineupOptions): Policy {
  const allBaseline = session.seats.every((s) => s.isHero || s.profile === 'baseline');
  return allBaseline ? baselinePolicy : policyFor(makeProfile('population', options.custom));
}

export interface SeatChange {
  seat: number;
  leaving: string;
  joining: string;
}

/**
 * Between hands, a bot may leave and a new player take the seat.
 * `rate` is the chance per hand that someone changes.
 */
export function maybeChangeSeat(
  session: Session,
  options: LineupOptions,
  rate: number,
  namePool: readonly string[],
  rng: Rng,
): SeatChange | null {
  if (rate <= 0 || rng.next() >= rate) return null;
  const bots = session.seats.map((s, i) => (s.isHero ? -1 : i)).filter((i) => i >= 0);
  if (bots.length === 0) return null;
  const seat = bots[rng.int(bots.length)]!;
  const taken = new Set(session.seats.map((s) => s.name));
  const free = namePool.filter((n) => !taken.has(n));
  if (free.length === 0) return null;
  const name = free[rng.int(free.length)]!;
  const leaving = session.seats[seat]!.name;
  const profile = options.preset === 'custom' ? session.seats[seat]!.profile : drawProfile(options.preset, rng);
  replaceSeat(session, seat, name, profile, drawBotBuyIn(session.config, options, rng));
  return { seat, leaving, joining: name };
}
