import { policyFor } from '../bots/policies';
import type { CustomProfileSettings, HumanParams, ProfileId } from '../bots/profiles';
import { seededRng } from '../engine/rng';
import { beginHand, createSession, endHand, type TableConfig } from '../engine/session';
import { HandRunner } from './handRunner';
import { DEFAULT_LINEUP, observerPolicy, seatPolicies, type LineupOptions } from './lineup';
import { addCounts, countHand, emptyCounts, summarize, type StatCounts, type StatSummary } from './stats';

export interface SelfPlayStats extends StatSummary {
  /** Share of hands where a flop was dealt. */
  flopsDealt: number;
  /** Average number of players who saw the flop when one was dealt. */
  playersPerFlop: number;
  avgPotBB: number;
  msPerHand: number;
  byProfile: Record<string, StatSummary>;
}

export const DEFAULT_TABLE: TableConfig = {
  numPlayers: 9,
  smallBlind: 50,
  bigBlind: 100,
  heroBuyIn: 20000,
  botBuyInMin: 20000,
  botBuyInMax: 20000,
  topUp: 'always',
  straddle: 'off',
  rake: { percent: 5, cap: 300, noFlopNoDrop: true },
};

export interface SelfPlayOptions {
  config?: TableConfig;
  /** Profile of every seat (all seats are bots). Defaults to the baseline everywhere. */
  profiles?: ProfileId[];
  custom?: CustomProfileSettings;
  /** Explicit human-engine parameters for some seats, overriding their profile. */
  seatParams?: Record<number, HumanParams>;
}

/** Let bots play each other and collect table statistics. */
export function selfPlay(hands: number, seed: number, options: SelfPlayOptions = {}): SelfPlayStats {
  const config = options.config ?? DEFAULT_TABLE;
  const rng = seededRng(seed);
  const n = config.numPlayers;
  const profiles = options.profiles ?? new Array<ProfileId>(n).fill('baseline');
  // Seat 0 is the session's "hero" seat; it is played by a bot here (heroIndex -1).
  const session = createSession(config, [], rng, profiles.slice(1));
  session.seats[0]!.profile = profiles[0] ?? 'baseline';
  session.seats[0]!.isHero = false;
  const lineup: LineupOptions = { ...DEFAULT_LINEUP, custom: options.custom ?? DEFAULT_LINEUP.custom };
  const policies = seatPolicies(session, lineup);
  for (const [seat, params] of Object.entries(options.seatParams ?? {})) {
    policies[Number(seat)] = policyFor({ id: 'custom', engine: 'human', params });
  }
  const observer = observerPolicy(session, lineup);

  const perSeat: StatCounts[] = [];
  for (let i = 0; i < n; i++) perSeat.push(emptyCounts());
  let flops = 0;
  let playersAtFlop = 0;
  let potSum = 0;
  const start = Date.now();

  for (let h = 0; h < hands; h++) {
    const hand = beginHand(session, rng);
    const runner = new HandRunner(hand, { heroIndex: -1, rng, policies, observer });
    runner.runBots();
    endHand(session, hand);
    const before = perSeat.reduce((s, c) => s + c.sawFlop, 0);
    countHand(hand, perSeat);
    const after = perSeat.reduce((s, c) => s + c.sawFlop, 0);
    if (after > before) {
      flops++;
      playersAtFlop += after - before;
    }
    for (const p of hand.players) potSum += p.totalContributed;
  }

  const total = emptyCounts();
  const byProfileCounts: Record<string, StatCounts> = {};
  session.seats.forEach((seat, i) => {
    addCounts(total, perSeat[i]!);
    const key = seat.profile;
    byProfileCounts[key] ??= emptyCounts();
    addCounts(byProfileCounts[key]!, perSeat[i]!);
  });
  const byProfile: Record<string, StatSummary> = {};
  for (const [key, counts] of Object.entries(byProfileCounts)) byProfile[key] = summarize(counts);

  return {
    ...summarize(total),
    flopsDealt: flops / hands,
    playersPerFlop: flops > 0 ? playersAtFlop / flops : 0,
    avgPotBB: potSum / hands / config.bigBlind,
    msPerHand: (Date.now() - start) / hands,
    byProfile,
  };
}
