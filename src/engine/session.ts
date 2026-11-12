import { createHand, type CreateHandOptions } from './hand';
import type { Rng } from './rng';
import type { Chips, HandState, RakeConfig } from './types';

export type TopUpMode = 'always' | 'bust';
export type StraddleMode = 'off' | 'always' | 'sometimes';

export interface TableConfig {
  numPlayers: number;
  smallBlind: Chips;
  bigBlind: Chips;
  heroBuyIn: Chips;
  botBuyInMin: Chips;
  botBuyInMax: Chips;
  /** 'always': refill to the buy-in before every hand. 'bust': rebuy only when short. */
  topUp: TopUpMode;
  straddle: StraddleMode;
  rake: RakeConfig;
}

export interface SeatState {
  name: string;
  isHero: boolean;
  stack: Chips;
  /** Target stack used for top-ups and rebuys. */
  buyIn: Chips;
  /** Total chips bought so far, including the first buy-in. */
  invested: Chips;
  /** Opaque label for the strategy this seat plays (set by the game layer). */
  profile: string;
}

export interface Session {
  config: TableConfig;
  seats: SeatState[];
  buttonIndex: number;
  handsDealt: number;
}

/** A player rebuys in 'bust' mode once the stack drops below this fraction of the buy-in. */
const REBUY_FRACTION = 0.25;
const SOMETIMES_STRADDLE_PROBABILITY = 0.3;

/** Pick a bot buy-in on the table's step grid. */
export function drawBuyIn(config: TableConfig, rng: Rng): Chips {
  const step = config.bigBlind * 10;
  const lo = Math.min(config.botBuyInMin, config.botBuyInMax);
  const hi = Math.max(config.botBuyInMin, config.botBuyInMax);
  const steps = Math.floor((hi - lo) / step);
  return lo + rng.int(steps + 1) * step;
}

/**
 * Create a table. The hero always sits at index 0.
 * `profiles` labels each bot seat (index 0 of the list is the first bot).
 */
export function createSession(
  config: TableConfig,
  botNames: readonly string[],
  rng: Rng,
  profiles: readonly string[] = [],
  buyIns: readonly (Chips | undefined)[] = [],
): Session {
  if (config.numPlayers < 2 || config.numPlayers > 9) {
    throw new Error(`Unsupported player count: ${config.numPlayers}`);
  }
  const seats: SeatState[] = [];
  for (let i = 0; i < config.numPlayers; i++) {
    const isHero = i === 0;
    const buyIn = isHero ? config.heroBuyIn : (buyIns[i - 1] ?? drawBuyIn(config, rng));
    seats.push({
      name: isHero ? 'Hero' : (botNames[(i - 1) % Math.max(1, botNames.length)] ?? `Bot ${i}`),
      isHero,
      stack: buyIn,
      buyIn,
      invested: buyIn,
      profile: isHero ? 'hero' : (profiles[i - 1] ?? 'baseline'),
    });
  }
  return { config, seats, buttonIndex: rng.int(config.numPlayers), handsDealt: 0 };
}

/** Top up stacks, move the button, and deal the next hand. */
export function beginHand(
  session: Session,
  rng: Rng,
  overrides: Partial<Pick<CreateHandOptions, 'holeCards' | 'board'>> = {},
): HandState {
  const { config, seats } = session;
  for (const seat of seats) {
    const short =
      config.topUp === 'always' ? seat.stack < seat.buyIn : seat.stack < seat.buyIn * REBUY_FRACTION;
    if (short) {
      seat.invested += seat.buyIn - seat.stack;
      seat.stack = seat.buyIn;
    }
  }
  if (session.handsDealt > 0) session.buttonIndex = (session.buttonIndex + 1) % seats.length;
  session.handsDealt++;

  let straddle = 0;
  if (config.straddle === 'always') straddle = config.bigBlind * 2;
  else if (config.straddle === 'sometimes' && rng.next() < SOMETIMES_STRADDLE_PROBABILITY) {
    straddle = config.bigBlind * 2;
  }

  return createHand({
    handId: session.handsDealt,
    config: {
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      straddle,
      rake: config.rake,
    },
    seats: seats.map((s) => ({ name: s.name, stack: s.stack, isHero: s.isHero })),
    buttonIndex: session.buttonIndex,
    rng,
    ...overrides,
  });
}

/** Make the next hand dealt by `beginHand` have the button at `target`. */
export function placeButton(session: Session, target: number): void {
  const n = session.seats.length;
  session.buttonIndex = session.handsDealt > 0 ? (target - 1 + n) % n : target;
}

/** A new player takes over a bot seat between hands. */
export function replaceSeat(session: Session, index: number, name: string, profile: string, buyIn: Chips): void {
  const seat = session.seats[index];
  if (!seat || seat.isHero) throw new Error(`Cannot replace seat ${index}`);
  session.seats[index] = { name, isHero: false, stack: buyIn, buyIn, invested: buyIn, profile };
}

/** Copy final stacks from a finished hand back to the table. */
export function endHand(session: Session, hand: HandState): void {
  if (!hand.isComplete) throw new Error('Hand is not complete');
  hand.players.forEach((p, i) => {
    session.seats[i]!.stack = p.stack;
  });
}

/** Net result for a seat: current stack minus everything bought in. */
export function seatNet(seat: SeatState): Chips {
  return seat.stack - seat.invested;
}
